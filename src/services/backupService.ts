import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';

import { supabase, isSupabaseConfigured } from './supabase';
import {
  Case,
  CaseStatus,
  Evidence,
  BackupStatus,
} from '../types';
import {
  getCaseById,
  getCaseByCloudCaseId,
  getEvidenceById,
  getEvidenceByCloudEvidenceId,
  insertCase,
  insertEvidence,
  logActivity,
  setCaseCloudId,
  updateEvidenceAfterRestore,
  updateEvidenceBackup,
} from './database';
import {
  deleteFileLocally,
  detectFileType,
  readFileBytes,
  saveRestoredEvidenceFile,
  verifyFileIntegrity,
} from './storage';
import {
  BackupEnvelopeContext,
  ENVELOPE_EXTENSION,
  base64ToBytes,
  bytesToHex,
  deriveBackupKey,
  readEnvelopeHeader,
  sha256Hex,
} from './backupCryptoCore';
import {
  decryptBackupBytes,
  encryptBackupBytes,
  resolveVaultBackupKey,
} from './encryptionService';
import {
  cacheBackupKey,
  getCachedBackupKey,
  getOrCreateBackupKdfSaltHex,
} from './security';
import {
  hasAutoBackupConsent,
  isAutoBackupEnabled,
} from './backupPreferences';

/**
 * Optional encrypted cloud backup for EvidenceVault.
 *
 * Plaintext evidence never leaves the device. It is sealed with AES-256-GCM
 * using a key derived from the user's vault passphrase with Argon2id, then the
 * envelope is uploaded to the private `evidence-backups` bucket.
 *
 * The app uses only the Supabase anon key plus the signed-in user's JWT.
 * `service_role` is never present in the app. Storage RLS is the final
 * authority on which objects a user may read, write or delete.
 */

export const BACKUP_BUCKET = 'evidence-backups';
export const MAX_BACKUP_PLAINTEXT_BYTES = 95 * 1024 * 1024;
const MAX_BACKUP_CIPHERTEXT_BYTES = 100 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60;

export const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  not_backed_up: 'NOT BACKED UP',
  uploading: 'UPLOADING',
  backed_up: 'BACKED UP',
  failed: 'FAILED',
};

export const backupStatusBadgeType = (
  status: BackupStatus
): 'teal' | 'info' | 'success' | 'danger' => {
  switch (status) {
    case 'uploading':
      return 'info';
    case 'backed_up':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'teal';
  }
};

interface CloudCaseRow {
  id: string;
  title: string;
  incident_type: string;
  incident_description: string;
  incident_date: string;
  incident_platform: string;
  status: string;
}

interface CloudEvidenceRow {
  id: string;
  case_id: string;
  original_filename: string;
  mime_type: string | null;
  file_size: number;
  storage_path: string;
  sha256_hash: string;
  backup_status: BackupStatus;
  backup_last_success_at: string | null;
  backup_error: string | null;
  backup_bytes: number | null;
  backup_ciphertext_sha256: string | null;
  uploaded_at: string;
}

export interface BackupOutcome {
  status: 'backed_up';
  backedUpAt: string;
  storagePath: string;
  ciphertextBytes: number;
  ciphertextSha256: string;
  plaintextSha256: string;
}

export interface AutoBackupResult {
  attempted: boolean;
  reason?: string;
  outcome?: BackupOutcome;
}

export interface RestoreOutcome {
  localEvidenceId: string;
  localCaseId: string;
  localPath: string;
  /** SHA-256 of the raw decrypted bytes, checked by the envelope itself. */
  plaintextSha256: string;
  /** The app's recorded per-file SHA-256, re-checked on disk after restore. */
  legacySha256: string;
}

export interface CloudBackupRecord {
  cloudEvidenceId: string;
  cloudCaseId: string;
  caseTitle: string;
  originalFilename: string;
  mimeType: string;
  plaintextBytes: number;
  ciphertextBytes: number | null;
  status: BackupStatus;
  lastSuccessAt: string | null;
  error: string | null;
  storagePath: string;
  uploadedAt: string;
  isLocal: boolean;
  localEvidenceId: string | null;
  localCaseId: string | null;
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  // Copy so the uploaded buffer is a plain ArrayBuffer. Supabase Storage in
  // React Native is documented to prefer ArrayBuffer over Blob/File/FormData.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
};

const safeErrorMessage = (error: unknown): string => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Cloud backup failed';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 400) || 'Cloud backup failed';
};

const requireConfigured = (): void => {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Encrypted cloud backup is not configured on this build. Add the Supabase URL and anon key first.'
    );
  }
};

const requireUser = async (): Promise<{ id: string }> => {
  requireConfigured();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) {
    throw new Error('Sign in to use encrypted cloud backup.');
  }
  return { id: data.user.id };
};

const normalizeCaseStatus = (status: string | null | undefined): CaseStatus => {
  if (status === 'closed' || status === 'archived') return status;
  return 'active';
};

const sanitizeIncidentDate = (value: string | null | undefined): string => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return new Date().toISOString().slice(0, 10);
};

const safeFilename = (value: string | null | undefined): string => {
  const trimmed = (value ?? '').trim();
  return (trimmed || 'evidence').slice(0, 255);
};

const backupPath = (
  userId: string,
  cloudCaseId: string,
  cloudEvidenceId: string
): string => `${userId}/${cloudCaseId}/${cloudEvidenceId}${ENVELOPE_EXTENSION}`;

/**
 * Resolve stable cloud UUIDs for a local case/evidence pair.
 *
 * Existing local mappings are re-checked against Supabase first. If the cloud
 * row is gone (or belongs to a different signed-in account and is therefore
 * hidden by RLS), fresh UUIDs are generated instead of trying to hijack the
 * old row.
 */
const ensureCloudCaseId = async (
  caseItem: Case,
  userId: string
): Promise<string> => {
  if (caseItem.cloud_case_id) {
    const { data, error } = await supabase
      .from('cases')
      .select('id')
      .eq('id', caseItem.cloud_case_id)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not verify cloud case: ${error.message}`);
    }
    if (data?.id) {
      return data.id as string;
    }
  }

  const cloudCaseId = Crypto.randomUUID();
  const { error } = await supabase.from('cases').upsert(
    {
      id: cloudCaseId,
      title: (caseItem.title || 'Untitled case').trim().slice(0, 200),
      incident_type: (caseItem.category || 'other').trim().slice(0, 100),
      incident_description: (caseItem.description ?? '').slice(0, 20000),
      incident_date: sanitizeIncidentDate(caseItem.incident_date),
      incident_platform: (caseItem.platform ?? '').slice(0, 100),
      status: normalizeCaseStatus(caseItem.status),
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(`Could not prepare cloud case: ${error.message}`);
  }

  await setCaseCloudId(caseItem.id, cloudCaseId);
  return cloudCaseId;
};

const ensureCloudEvidenceId = async (
  evidence: Evidence,
  cloudCaseId: string,
  userId: string
): Promise<string> => {
  if (evidence.cloud_evidence_id) {
    const { data, error } = await supabase
      .from('evidence')
      .select('id,case_id')
      .eq('id', evidence.cloud_evidence_id)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not verify cloud evidence: ${error.message}`);
    }
    // Reuse the row only when it still belongs to the expected cloud case.
    // Otherwise the envelope's authenticated case context would not match the
    // cloud row during a later restore.
    if (data?.id && data.case_id === cloudCaseId) {
      return data.id as string;
    }
  }

  const cloudEvidenceId = Crypto.randomUUID();
  const path = backupPath(userId, cloudCaseId, cloudEvidenceId);

  const { error } = await supabase.from('evidence').upsert(
    {
      id: cloudEvidenceId,
      case_id: cloudCaseId,
      original_filename: safeFilename(evidence.original_filename),
      mime_type: (evidence.mime_type || 'application/octet-stream').slice(0, 255),
      file_size: Math.max(0, Math.trunc(evidence.file_size)),
      storage_path: path,
      sha256_hash: evidence.sha256_hash.toLowerCase(),
      encryption_version: 1,
      processing_status: 'completed',
      backup_status: 'uploading',
      backup_last_success_at: evidence.backup_last_at ?? null,
      backup_error: null,
      backup_bytes: evidence.backup_bytes ?? null,
      backup_ciphertext_sha256: evidence.backup_ciphertext_sha256 ?? null,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(`Could not prepare cloud evidence metadata: ${error.message}`);
  }

  return cloudEvidenceId;
};

const markCloudRowUploading = async (cloudEvidenceId: string): Promise<void> => {
  const { error } = await supabase
    .from('evidence')
    .update({ backup_status: 'uploading', backup_error: null })
    .eq('id', cloudEvidenceId);

  if (error) {
    throw new Error(`Could not mark backup as uploading: ${error.message}`);
  }
};

/**
 * Encrypt and upload one evidence file.
 *
 * The local status becomes `backed_up` only after Supabase confirms both the
 * object upload (server-side size check) and the metadata update.
 */
export const backupEvidenceToCloud = async (
  evidenceId: string,
  passphrase?: string
): Promise<BackupOutcome> => {
  const evidence = await getEvidenceById(evidenceId);
  if (!evidence) {
    throw new Error('Evidence record was not found on this device.');
  }

  const caseItem = await getCaseById(evidence.case_id);
  if (!caseItem) {
    throw new Error('The case for this evidence was not found on this device.');
  }

  await updateEvidenceBackup(evidence.id, {
    status: 'uploading',
    error: null,
  });

  let cloudCaseId: string | null = evidence.cloud_case_id ?? null;
  let cloudEvidenceId: string | null = evidence.cloud_evidence_id ?? null;

  try {
    const user = await requireUser();
    cloudCaseId = await ensureCloudCaseId(caseItem, user.id);
    cloudEvidenceId = await ensureCloudEvidenceId(
      evidence,
      cloudCaseId,
      user.id
    );

    await updateEvidenceBackup(evidence.id, {
      cloudCaseId,
      cloudEvidenceId,
    });
    await markCloudRowUploading(cloudEvidenceId);

    const storagePath = backupPath(user.id, cloudCaseId, cloudEvidenceId);
    const keyMaterial = await resolveVaultBackupKey(passphrase);
    const plaintext = await readFileBytes(evidence.file_path);

    if (plaintext.length === 0) {
      throw new Error('This evidence file is empty, so there is nothing to back up.');
    }
    if (plaintext.length > MAX_BACKUP_PLAINTEXT_BYTES) {
      throw new Error(
        'This file is larger than the 95 MB encrypted-backup limit.'
      );
    }

    const context: BackupEnvelopeContext = {
      userId: user.id,
      caseId: cloudCaseId,
      evidenceId: cloudEvidenceId,
    };

    const envelope = await encryptBackupBytes({
      plaintext,
      keyMaterial,
      context,
    });

    if (envelope.length > MAX_BACKUP_CIPHERTEXT_BYTES) {
      throw new Error(
        'The encrypted file exceeds the 100 MB bucket limit. Nothing was uploaded.'
      );
    }

    const ciphertextSha256 = sha256Hex(envelope);
    const plaintextSha256 = sha256Hex(plaintext);

    const { error: uploadError } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(storagePath, toArrayBuffer(envelope), {
        contentType: 'application/octet-stream',
        upsert: true,
        cacheControl: '0',
      });

    if (uploadError) {
      throw new Error(`Supabase rejected the upload: ${uploadError.message}`);
    }

    // Ask Storage for the stored object size. This is the server-side
    // confirmation that the ciphertext actually landed.
    const { data: stored, error: infoError } = await supabase.storage
      .from(BACKUP_BUCKET)
      .info(storagePath);

    if (infoError || !stored) {
      throw new Error(
        `Could not confirm the upload with Supabase: ${
          infoError?.message ?? 'object not found'
        }`
      );
    }
    if (typeof stored.size === 'number' && stored.size !== envelope.length) {
      throw new Error('Supabase confirmed a different ciphertext size than was sent.');
    }

    const backedUpAt = new Date().toISOString();

    const { data: updated, error: metadataError } = await supabase
      .from('evidence')
      .update({
        backup_status: 'backed_up',
        backup_last_success_at: backedUpAt,
        backup_error: null,
        backup_bytes: envelope.length,
        backup_ciphertext_sha256: ciphertextSha256,
        file_size: plaintext.length,
        sha256_hash: evidence.sha256_hash.toLowerCase(),
      })
      .eq('id', cloudEvidenceId)
      .select('id')
      .maybeSingle();

    if (metadataError || !updated?.id) {
      // The bytes are in Storage but the cloud metadata did not confirm. Do not
      // claim success; remove the unconfirmed object and let the user retry.
      await supabase.storage.from(BACKUP_BUCKET).remove([storagePath]);
      throw new Error(
        `Supabase did not confirm the backup metadata update: ${
          metadataError?.message ?? 'no row returned'
        }`
      );
    }

    await updateEvidenceBackup(evidence.id, {
      status: 'backed_up',
      lastAt: backedUpAt,
      error: null,
      storagePath,
      bytes: envelope.length,
      ciphertextSha256,
      cloudCaseId,
      cloudEvidenceId,
    });

    await logActivity(
      'backup_uploaded',
      `Uploaded encrypted backup for "${evidence.original_filename}"`,
      evidence.case_id,
      JSON.stringify({
        evidenceId: evidence.id,
        cloudEvidenceId,
        ciphertextBytes: envelope.length,
      })
    );

    return {
      status: 'backed_up',
      backedUpAt,
      storagePath,
      ciphertextBytes: envelope.length,
      ciphertextSha256,
      plaintextSha256,
    };
  } catch (error) {
    const message = safeErrorMessage(error);

    await updateEvidenceBackup(evidence.id, {
      status: 'failed',
      error: message,
      cloudCaseId,
      cloudEvidenceId,
    });

    if (cloudEvidenceId) {
      // Best effort: keep cloud metadata honest without masking the original
      // error. Last-success timestamp is intentionally left untouched.
      await supabase
        .from('evidence')
        .update({ backup_status: 'failed', backup_error: message.slice(0, 500) })
        .eq('id', cloudEvidenceId);
    }

    await logActivity(
      'backup_failed',
      `Encrypted backup failed for "${evidence.original_filename}": ${message}`,
      evidence.case_id,
      JSON.stringify({ evidenceId: evidence.id })
    );

    throw error;
  }
};

const hasUsableCachedKey = async (): Promise<boolean> => {
  const saltHex = await getOrCreateBackupKdfSaltHex();
  return getCachedBackupKey(saltHex) !== null;
};

/**
 * Auto-backup runs only when the user has explicitly consented, the setting is
 * on, and a derived key is already cached in memory. It never prompts for a
 * passphrase and never writes one anywhere.
 */
export const maybeAutoBackupEvidence = async (
  evidenceId: string
): Promise<AutoBackupResult> => {
  if (!(await isAutoBackupEnabled())) {
    return { attempted: false, reason: 'disabled' };
  }
  if (!(await hasAutoBackupConsent())) {
    return { attempted: false, reason: 'no_consent' };
  }
  if (!(await hasUsableCachedKey())) {
    return { attempted: false, reason: 'vault_key_not_cached' };
  }

  try {
    const outcome = await backupEvidenceToCloud(evidenceId);
    return { attempted: true, outcome };
  } catch (error) {
    console.warn('Automatic encrypted backup failed:', safeErrorMessage(error));
    return { attempted: true, reason: safeErrorMessage(error) };
  }
};

const downloadEnvelope = async (storagePath: string): Promise<Uint8Array> => {
  const { data, error } = await supabase.storage
    .from(BACKUP_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(
      `Could not create a download link for this backup: ${
        error?.message ?? 'no signed URL returned'
      }`
    );
  }

  const destination = new File(
    Paths.cache,
    `evb_restore_${Date.now()}_${Crypto.randomUUID()}.evb`
  );

  let downloaded: File | null = null;
  try {
    downloaded = await File.downloadFileAsync(data.signedUrl, destination, {
      idempotent: true,
    });
    return await downloaded.bytes();
  } catch (error) {
    throw new Error(`Could not download the encrypted backup: ${safeErrorMessage(error)}`);
  } finally {
    try {
      downloaded?.delete();
    } catch {
      // Cache cleanup is best effort.
    }
  }
};

const ensureLocalCase = async (
  cloudCaseId: string,
  cloudCase: CloudCaseRow
): Promise<Case> => {
  const existing = await getCaseByCloudCaseId(cloudCaseId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const localCase: Case = {
    id: `case_restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: (cloudCase.title || 'Restored case').slice(0, 200),
    category: (cloudCase.incident_type || 'other').slice(0, 100),
    description: cloudCase.incident_description ?? '',
    incident_date: sanitizeIncidentDate(cloudCase.incident_date),
    incident_time: '',
    platform: cloudCase.incident_platform ?? '',
    suspect_info: '',
    severity: 'medium',
    status: normalizeCaseStatus(cloudCase.status),
    is_demo: 0,
    created_at: now,
    updated_at: now,
    cloud_case_id: cloudCaseId,
  };

  await insertCase(localCase);
  return localCase;
};

/**
 * Download, authenticate, decrypt and verify one encrypted backup.
 *
 * Two independent checks must pass before the file is kept:
 *   1. AES-GCM authentication plus the raw SHA-256 stored in the envelope.
 *   2. The app's recorded per-file SHA-256 computed again from the restored
 *      local file.
 */
export const restoreCloudBackup = async (
  cloudEvidenceId: string,
  passphrase: string
): Promise<RestoreOutcome> => {
  if (!passphrase) {
    throw new Error('Enter your vault passphrase to restore this backup.');
  }

  const user = await requireUser();

  const { data: cloudRow, error: rowError } = await supabase
    .from('evidence')
    .select(
      'id,case_id,original_filename,mime_type,file_size,storage_path,sha256_hash,backup_status,backup_last_success_at,backup_error,backup_bytes,backup_ciphertext_sha256,uploaded_at'
    )
    .eq('id', cloudEvidenceId)
    .maybeSingle<CloudEvidenceRow>();

  if (rowError) {
    throw new Error(`Could not load the cloud backup: ${rowError.message}`);
  }
  if (!cloudRow) {
    throw new Error('That encrypted backup was not found for this account.');
  }
  if (!cloudRow.storage_path) {
    throw new Error('This evidence record has no encrypted backup to restore.');
  }

  const { data: cloudCase, error: caseError } = await supabase
    .from('cases')
    .select(
      'id,title,incident_type,incident_description,incident_date,incident_platform,status'
    )
    .eq('id', cloudRow.case_id)
    .maybeSingle<CloudCaseRow>();

  if (caseError) {
    throw new Error(`Could not load the backup's case details: ${caseError.message}`);
  }
  if (!cloudCase) {
    throw new Error('The case for this backup is not available to this account.');
  }

  const envelope = await downloadEnvelope(cloudRow.storage_path);

  // If Supabase recorded a ciphertext digest, check the downloaded bytes
  // against it before spending time on decryption.
  if (cloudRow.backup_ciphertext_sha256) {
    const downloadedSha256 = sha256Hex(envelope);
    if (downloadedSha256 !== cloudRow.backup_ciphertext_sha256.toLowerCase()) {
      throw new Error(
        'The downloaded backup failed its ciphertext SHA-256 check and was not decrypted.'
      );
    }
  }

  const header = readEnvelopeHeader(envelope);

  const expectedContext: BackupEnvelopeContext = {
    userId: user.id,
    caseId: cloudRow.case_id,
    evidenceId: cloudRow.id,
  };

  const key = await deriveBackupKey(
    passphrase,
    base64ToBytes(header.kdf.salt),
    {
      m: header.kdf.m,
      t: header.kdf.t,
      p: header.kdf.p,
      dkLen: header.kdf.dkLen,
    }
  );

  const { plaintext } = await decryptBackupBytes({
    envelope,
    key,
    expectedContext,
  });

  // Successful decryption proves the passphrase was correct. Cache the key so
  // further restores in this session do not re-run Argon2id.
  cacheBackupKey(bytesToHex(base64ToBytes(header.kdf.salt)), key);

  const saved = await saveRestoredEvidenceFile(
    cloudRow.original_filename,
    plaintext
  );

  const integrity = await verifyFileIntegrity(saved.localPath, cloudRow.sha256_hash);
  if (!integrity.isValid || !integrity.fileExists) {
    await deleteFileLocally(saved.localPath);
    throw new Error(
      'Restored file failed the recorded SHA-256 check and was discarded.'
    );
  }

  const localCase = await ensureLocalCase(cloudRow.case_id, cloudCase);
  const existing = await getEvidenceByCloudEvidenceId(cloudRow.id);

  let localEvidenceId: string;
  let oldLocalPath: string | null = null;

  if (existing) {
    localEvidenceId = existing.id;
    oldLocalPath = existing.file_path;

    await updateEvidenceAfterRestore(
      existing.id,
      saved.localPath,
      saved.size,
      cloudRow.sha256_hash
    );
    await updateEvidenceBackup(existing.id, {
      status: 'backed_up',
      lastAt: cloudRow.backup_last_success_at ?? new Date().toISOString(),
      error: null,
      storagePath: cloudRow.storage_path,
      bytes: cloudRow.backup_bytes,
      ciphertextSha256: cloudRow.backup_ciphertext_sha256,
      cloudCaseId: cloudRow.case_id,
      cloudEvidenceId: cloudRow.id,
    });
  } else {
    const now = new Date().toISOString();
    localEvidenceId = `ev_restore_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const newEvidence: Evidence = {
      id: localEvidenceId,
      case_id: localCase.id,
      filename: saved.filename,
      original_filename: cloudRow.original_filename,
      file_path: saved.localPath,
      file_size: saved.size,
      file_type: detectFileType(
        cloudRow.original_filename,
        cloudRow.mime_type ?? undefined
      ),
      mime_type: cloudRow.mime_type || 'application/octet-stream',
      sha256_hash: cloudRow.sha256_hash,
      processing_status: 'completed',
      extracted_text: null,
      metadata_json: JSON.stringify({
        restoredAt: now,
        restoredFromEncryptedBackup: true,
        cloudEvidenceId: cloudRow.id,
      }),
      created_at: now,
      is_verified: 1,
      cloud_evidence_id: cloudRow.id,
      cloud_case_id: cloudRow.case_id,
      backup_status: 'backed_up',
      backup_last_at: cloudRow.backup_last_success_at ?? now,
      backup_error: null,
      backup_storage_path: cloudRow.storage_path,
      backup_bytes: cloudRow.backup_bytes,
      backup_ciphertext_sha256: cloudRow.backup_ciphertext_sha256,
    };

    await insertEvidence(newEvidence);
  }

  if (oldLocalPath && oldLocalPath !== saved.localPath) {
    // The verified restored copy replaces the old local copy of the same
    // evidence row.
    await deleteFileLocally(oldLocalPath);
  }

  await logActivity(
    'backup_restored',
    `Restored and verified encrypted backup for "${cloudRow.original_filename}"`,
    localCase.id,
    JSON.stringify({
      cloudEvidenceId: cloudRow.id,
      localEvidenceId,
      plaintextSha256: header.plaintext.sha256,
    })
  );

  return {
    localEvidenceId,
    localCaseId: localCase.id,
    localPath: saved.localPath,
    plaintextSha256: header.plaintext.sha256,
    legacySha256: integrity.currentHash,
  };
};

/**
 * Delete the encrypted object and clear the cloud/local backup state. The
 * cloud evidence metadata row is kept so the case history remains intact.
 */
export const deleteCloudBackup = async (evidenceId: string): Promise<void> => {
  const evidence = await getEvidenceById(evidenceId);
  if (!evidence) {
    throw new Error('Evidence record was not found on this device.');
  }
  if (!evidence.cloud_evidence_id) {
    throw new Error('This evidence item has no encrypted cloud backup.');
  }

  const cloudEvidenceId = evidence.cloud_evidence_id;
  let storagePath = evidence.backup_storage_path;

  if (!storagePath) {
    const { data, error } = await supabase
      .from('evidence')
      .select('storage_path')
      .eq('id', cloudEvidenceId)
      .maybeSingle<{ storage_path: string }>();

    if (error) {
      throw new Error(`Could not load the backup location: ${error.message}`);
    }
    storagePath = data?.storage_path ?? null;
  }

  if (storagePath) {
    const { error: removeError } = await supabase.storage
      .from(BACKUP_BUCKET)
      .remove([storagePath]);

    if (removeError) {
      throw new Error(`Supabase did not delete the backup: ${removeError.message}`);
    }
  }

  const { data: updated, error: metadataError } = await supabase
    .from('evidence')
    .update({
      backup_status: 'not_backed_up',
      backup_last_success_at: null,
      backup_error: null,
      backup_bytes: null,
      backup_ciphertext_sha256: null,
    })
    .eq('id', cloudEvidenceId)
    .select('id')
    .maybeSingle();

  if (metadataError || !updated?.id) {
    await updateEvidenceBackup(evidence.id, {
      status: 'failed',
      error: `Backup file was removed, but Supabase did not confirm the metadata update: ${
        metadataError?.message ?? 'no row returned'
      }`,
    });
    throw new Error(
      'The encrypted file was removed, but the backup status could not be updated. Try again to finish cleanup.'
    );
  }

  await updateEvidenceBackup(evidence.id, {
    status: 'not_backed_up',
    lastAt: null,
    error: null,
    storagePath: null,
    bytes: null,
    ciphertextSha256: null,
  });

  await logActivity(
    'backup_deleted',
    `Deleted encrypted cloud backup for "${evidence.original_filename}"`,
    evidence.case_id,
    JSON.stringify({ evidenceId: evidence.id, cloudEvidenceId })
  );
};

/**
 * List the signed-in user's cloud backups. Storage RLS also protects the
 * objects; this query only returns rows visible under the evidence table RLS.
 */
export const listCloudBackups = async (): Promise<CloudBackupRecord[]> => {
  await requireUser();

  const { data: rows, error } = await supabase
    .from('evidence')
    .select(
      'id,case_id,original_filename,mime_type,file_size,storage_path,sha256_hash,backup_status,backup_last_success_at,backup_error,backup_bytes,backup_ciphertext_sha256,uploaded_at'
    )
    .order('uploaded_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Could not list cloud backups: ${error.message}`);
  }

  const evidenceRows = (rows ?? []) as CloudEvidenceRow[];
  if (evidenceRows.length === 0) return [];

  const caseIds = Array.from(new Set(evidenceRows.map((row) => row.case_id)));
  const { data: caseRows, error: caseError } = await supabase
    .from('cases')
    .select('id,title')
    .in('id', caseIds);

  if (caseError) {
    throw new Error(`Could not list backup cases: ${caseError.message}`);
  }

  const caseTitles = new Map<string, string>();
  for (const row of (caseRows ?? []) as { id: string; title: string }[]) {
    caseTitles.set(row.id, row.title);
  }

  return Promise.all(
    evidenceRows.map(async (row) => {
      const [localEvidence, localCase] = await Promise.all([
        getEvidenceByCloudEvidenceId(row.id),
        getCaseByCloudCaseId(row.case_id),
      ]);

      return {
        cloudEvidenceId: row.id,
        cloudCaseId: row.case_id,
        caseTitle: caseTitles.get(row.case_id) ?? 'Cloud case',
        originalFilename: row.original_filename,
        mimeType: row.mime_type ?? 'application/octet-stream',
        plaintextBytes: row.file_size,
        ciphertextBytes: row.backup_bytes,
        status: row.backup_status,
        lastSuccessAt: row.backup_last_success_at,
        error: row.backup_error,
        storagePath: row.storage_path,
        uploadedAt: row.uploaded_at,
        isLocal: Boolean(localEvidence),
        localEvidenceId: localEvidence?.id ?? null,
        localCaseId: localCase?.id ?? localEvidence?.case_id ?? null,
      } satisfies CloudBackupRecord;
    })
  );
};
