import * as SQLite from 'expo-sqlite';
import {
  Case,
  CaseStatus,
  Evidence,
  Finding,
  TimelineEvent,
  ActivityLog,
  CaseStatistics,
  VerificationStatus,
  BackupStatus,
} from '../types';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export const getDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('evidencevault.db');
    await initSchema(dbInstance);
  }
  return dbInstance;
};

const initSchema = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  try {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  } catch (e) {
    console.warn('Foreign keys pragma notice:', e);
  }

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      incident_date TEXT NOT NULL,
      incident_time TEXT,
      platform TEXT NOT NULL,
      suspect_info TEXT,
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'active',
      is_demo INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      mime_type TEXT,
      sha256_hash TEXT NOT NULL,
      processing_status TEXT NOT NULL,
      extracted_text TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      is_verified INTEGER DEFAULT 0,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      finding_type TEXT NOT NULL,
      finding_value TEXT NOT NULL,
      label TEXT NOT NULL,
      context_snippet TEXT,
      confidence REAL DEFAULT 1.0,
      verification_status TEXT DEFAULT 'needs_verification',
      verified_at TEXT,
      user_notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      evidence_id TEXT,
      finding_id TEXT,
      event_date TEXT NOT NULL,
      event_time TEXT,
      title TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL,
      is_verified INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      case_id TEXT,
      action_type TEXT NOT NULL,
      description TEXT NOT NULL,
      details_json TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence(sha256_hash);
    CREATE INDEX IF NOT EXISTS idx_findings_case ON findings(case_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_case ON timeline_events(case_id, event_date);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON activity_logs(timestamp DESC);
  `);

  await migrateBackupColumns(db);
};

const tableHasColumn = async (
  db: SQLite.SQLiteDatabase,
  table: 'cases' | 'evidence',
  column: string
): Promise<boolean> => {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  return columns.some((entry) => entry.name === column);
};

const addColumnIfMissing = async (
  db: SQLite.SQLiteDatabase,
  table: 'cases' | 'evidence',
  column: string,
  definition: string
): Promise<void> => {
  if (await tableHasColumn(db, table, column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
};

/**
 * Additive, idempotent migration for installations created before encrypted
 * cloud backup existed. No local evidence bytes are rewritten and no
 * passphrase/key material is stored in SQLite.
 */
const migrateBackupColumns = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  try {
    await addColumnIfMissing(db, 'cases', 'cloud_case_id', 'TEXT');
    await addColumnIfMissing(db, 'evidence', 'cloud_evidence_id', 'TEXT');
    await addColumnIfMissing(db, 'evidence', 'cloud_case_id', 'TEXT');
    await addColumnIfMissing(
      db,
      'evidence',
      'backup_status',
      "TEXT NOT NULL DEFAULT 'not_backed_up'"
    );
    await addColumnIfMissing(db, 'evidence', 'backup_last_at', 'TEXT');
    await addColumnIfMissing(db, 'evidence', 'backup_error', 'TEXT');
    await addColumnIfMissing(db, 'evidence', 'backup_storage_path', 'TEXT');
    await addColumnIfMissing(db, 'evidence', 'backup_bytes', 'INTEGER');
    await addColumnIfMissing(
      db,
      'evidence',
      'backup_ciphertext_sha256',
      'TEXT'
    );

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_cases_cloud ON cases(cloud_case_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_cloud ON evidence(cloud_evidence_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_backup_status ON evidence(backup_status);
    `);
  } catch (err) {
    // The schema upgrade must never prevent the local vault from opening.
    console.error('Backup column migration notice:', err);
  }
};

// ======================== CASE REPOSITORY ========================

export const getAllCases = async (): Promise<Case[]> => {
  const db = await getDatabase();
  return await db.getAllAsync<Case>(
    'SELECT * FROM cases ORDER BY created_at DESC'
  );
};

export const getCaseById = async (id: string): Promise<Case | null> => {
  const db = await getDatabase();
  return await db.getFirstAsync<Case>(
    'SELECT * FROM cases WHERE id = ?',
    [id]
  );
};

const insertCaseRow = async (caseData: Case): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO cases (
      id, title, category, description, incident_date, incident_time,
      platform, suspect_info, severity, status, is_demo, created_at, updated_at,
      cloud_case_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      caseData.id,
      caseData.title,
      caseData.category,
      caseData.description,
      caseData.incident_date,
      caseData.incident_time,
      caseData.platform,
      caseData.suspect_info,
      caseData.severity,
      caseData.status,
      caseData.is_demo,
      caseData.created_at,
      caseData.updated_at,
      caseData.cloud_case_id ?? null,
    ]
  );
};

export const insertCase = async (caseData: Case): Promise<void> => {
  await insertCaseRow(caseData);

  await logActivity(
    'case_created',
    `Created incident case: "${caseData.title}" (${caseData.category})`,
    caseData.id
  );
};

/**
 * Import a case that already exists in the signed-in user's Supabase account.
 * Existing local rows are never updated by this path; the caller checks the
 * cloud_case_id mapping first.
 */
export const insertCaseFromCloud = async (caseData: Case): Promise<void> => {
  await insertCaseRow(caseData);

  await logActivity(
    'case_synced_from_cloud',
    `Loaded case from your account: "${caseData.title}"`,
    caseData.id
  );
};

export const updateCase = async (caseData: Case): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE cases SET
      title = ?, category = ?, description = ?, incident_date = ?, incident_time = ?,
      platform = ?, suspect_info = ?, severity = ?, status = ?, updated_at = ?
    WHERE id = ?`,
    [
      caseData.title,
      caseData.category,
      caseData.description,
      caseData.incident_date,
      caseData.incident_time,
      caseData.platform,
      caseData.suspect_info,
      caseData.severity,
      caseData.status,
      caseData.updated_at,
      caseData.id,
    ]
  );

  await logActivity(
    'case_updated',
    `Updated incident case: "${caseData.title}"`,
    caseData.id
  );
};

export const updateCaseStatus = async (
  id: string,
  status: CaseStatus,
  updatedAt: string = new Date().toISOString()
): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE cases SET status = ?, updated_at = ? WHERE id = ?',
    [status, updatedAt, id]
  );

  await logActivity(
    'case_status_updated',
    `Changed case status to ${status}`,
    id
  );
};

export const deleteCase = async (id: string): Promise<void> => {
  const db = await getDatabase();
  const caseItem = await getCaseById(id);
  await db.runAsync('DELETE FROM cases WHERE id = ?', [id]);
  await logActivity(
    'case_deleted',
    `Deleted incident case: "${caseItem?.title || id}"`,
    id
  );
};

// ======================== EVIDENCE REPOSITORY ========================

export const getEvidenceByCase = async (caseId: string): Promise<Evidence[]> => {
  const db = await getDatabase();
  return await db.getAllAsync<Evidence>(
    'SELECT * FROM evidence WHERE case_id = ? ORDER BY created_at DESC',
    [caseId]
  );
};

export const getAllEvidence = async (): Promise<Evidence[]> => {
  const db = await getDatabase();
  return await db.getAllAsync<Evidence>(
    'SELECT * FROM evidence ORDER BY created_at DESC'
  );
};

export const getEvidenceById = async (id: string): Promise<Evidence | null> => {
  const db = await getDatabase();
  return await db.getFirstAsync<Evidence>(
    'SELECT * FROM evidence WHERE id = ?',
    [id]
  );
};

export const insertEvidence = async (evidence: Evidence): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO evidence (
      id, case_id, filename, original_filename, file_path, file_size,
      file_type, mime_type, sha256_hash, processing_status,
      extracted_text, metadata_json, created_at, is_verified,
      cloud_evidence_id, cloud_case_id, backup_status, backup_last_at,
      backup_error, backup_storage_path, backup_bytes,
      backup_ciphertext_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evidence.id,
      evidence.case_id,
      evidence.filename,
      evidence.original_filename,
      evidence.file_path,
      evidence.file_size,
      evidence.file_type,
      evidence.mime_type,
      evidence.sha256_hash,
      evidence.processing_status,
      evidence.extracted_text,
      evidence.metadata_json,
      evidence.created_at,
      evidence.is_verified,
      evidence.cloud_evidence_id ?? null,
      evidence.cloud_case_id ?? null,
      evidence.backup_status ?? 'not_backed_up',
      evidence.backup_last_at ?? null,
      evidence.backup_error ?? null,
      evidence.backup_storage_path ?? null,
      evidence.backup_bytes ?? null,
      evidence.backup_ciphertext_sha256 ?? null,
    ]
  );

  await logActivity(
    'evidence_added',
    `Preserved evidence file: "${evidence.original_filename}" (SHA-256: ${evidence.sha256_hash.slice(0, 10)}...)`,
    evidence.case_id,
    JSON.stringify({ fileId: evidence.id, hash: evidence.sha256_hash })
  );
};

export const updateEvidenceProcessing = async (
  id: string,
  status: Evidence['processing_status'],
  extractedText: string | null,
  metadataJson: string | null
): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE evidence SET
      processing_status = ?, extracted_text = ?, metadata_json = ?
    WHERE id = ?`,
    [status, extractedText, metadataJson, id]
  );
};

export const updateEvidenceVerification = async (
  id: string,
  isVerified: number
): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE evidence SET is_verified = ? WHERE id = ?',
    [isVerified, id]
  );
};

export const deleteEvidence = async (id: string): Promise<void> => {
  const db = await getDatabase();
  const ev = await getEvidenceById(id);
  await db.runAsync('DELETE FROM evidence WHERE id = ?', [id]);
  if (ev) {
    await logActivity(
      'evidence_deleted',
      `Removed evidence file: "${ev.original_filename}"`,
      ev.case_id
    );
  }
};

// ======================== CLOUD BACKUP MAPPING ========================

export const getCaseByCloudCaseId = async (
  cloudCaseId: string
): Promise<Case | null> => {
  const db = await getDatabase();
  return db.getFirstAsync<Case>(
    'SELECT * FROM cases WHERE cloud_case_id = ? LIMIT 1',
    [cloudCaseId]
  );
};

export const getEvidenceByCloudEvidenceId = async (
  cloudEvidenceId: string
): Promise<Evidence | null> => {
  const db = await getDatabase();
  return db.getFirstAsync<Evidence>(
    'SELECT * FROM evidence WHERE cloud_evidence_id = ? LIMIT 1',
    [cloudEvidenceId]
  );
};

export const setCaseCloudId = async (
  caseId: string,
  cloudCaseId: string
): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync('UPDATE cases SET cloud_case_id = ? WHERE id = ?', [
    cloudCaseId,
    caseId,
  ]);
};

export interface EvidenceBackupPatch {
  status?: BackupStatus;
  lastAt?: string | null;
  error?: string | null;
  storagePath?: string | null;
  bytes?: number | null;
  ciphertextSha256?: string | null;
  cloudCaseId?: string | null;
  cloudEvidenceId?: string | null;
}

/**
 * Update only local backup metadata. The plaintext file and its hash are not
 * touched. Column names are fixed literals, so the dynamic SET list is safe.
 */
export const updateEvidenceBackup = async (
  id: string,
  patch: EvidenceBackupPatch
): Promise<void> => {
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];

  const assign = (column: string, value: string | number | null | undefined) => {
    if (value === undefined) return;
    assignments.push(`${column} = ?`);
    values.push(value);
  };

  assign('backup_status', patch.status);
  assign('backup_last_at', patch.lastAt);
  assign('backup_error', patch.error);
  assign('backup_storage_path', patch.storagePath);
  assign('backup_bytes', patch.bytes);
  assign('backup_ciphertext_sha256', patch.ciphertextSha256);
  assign('cloud_case_id', patch.cloudCaseId);
  assign('cloud_evidence_id', patch.cloudEvidenceId);

  if (assignments.length === 0) return;

  values.push(id);
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE evidence SET ${assignments.join(', ')} WHERE id = ?`,
    values
  );
};

export const updateEvidenceAfterRestore = async (
  id: string,
  filePath: string,
  fileSize: number,
  sha256Hash: string
): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE evidence SET file_path = ?, file_size = ?, sha256_hash = ?
     WHERE id = ?`,
    [filePath, fileSize, sha256Hash, id]
  );
};

export const findDuplicateHash = async (
  hash: string,
  excludeId?: string
): Promise<Evidence | null> => {
  const db = await getDatabase();
  if (excludeId) {
    return await db.getFirstAsync<Evidence>(
      'SELECT * FROM evidence WHERE sha256_hash = ? AND id != ? LIMIT 1',
      [hash, excludeId]
    );
  }
  return await db.getFirstAsync<Evidence>(
    'SELECT * FROM evidence WHERE sha256_hash = ? LIMIT 1',
    [hash]
  );
};

// ======================== FINDINGS REPOSITORY ========================

export const getFindingsByCase = async (caseId: string): Promise<Finding[]> => {
  const db = await getDatabase();
  return await db.getAllAsync<Finding>(
    'SELECT * FROM findings WHERE case_id = ? ORDER BY created_at DESC',
    [caseId]
  );
};

export const getFindingsByEvidence = async (evidenceId: string): Promise<Finding[]> => {
  const db = await getDatabase();
  return await db.getAllAsync<Finding>(
    'SELECT * FROM findings WHERE evidence_id = ? ORDER BY created_at DESC',
    [evidenceId]
  );
};

export const insertFinding = async (finding: Finding): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO findings (
      id, case_id, evidence_id, finding_type, finding_value, label,
      context_snippet, confidence, verification_status, verified_at, user_notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      finding.id,
      finding.case_id,
      finding.evidence_id,
      finding.finding_type,
      finding.finding_value,
      finding.label,
      finding.context_snippet,
      finding.confidence,
      finding.verification_status,
      finding.verified_at,
      finding.user_notes,
      finding.created_at,
    ]
  );
};

export const updateFindingStatus = async (
  id: string,
  status: VerificationStatus,
  userNotes?: string | null
): Promise<void> => {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE findings SET
      verification_status = ?, verified_at = ?, user_notes = COALESCE(?, user_notes)
    WHERE id = ?`,
    [status, now, userNotes ?? null, id]
  );

  await logActivity(
    'finding_verified',
    `Marked finding as ${status}: ID ${id.slice(0, 8)}`,
    undefined,
    JSON.stringify({ findingId: id, status, notes: userNotes })
  );
};

export const deleteFinding = async (id: string): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM findings WHERE id = ?', [id]);
};

// ======================== TIMELINE REPOSITORY ========================

export const getEventsByCase = async (caseId: string): Promise<TimelineEvent[]> => {
  const db = await getDatabase();
  return await db.getAllAsync<TimelineEvent>(
    `SELECT * FROM timeline_events 
     WHERE case_id = ? 
     ORDER BY event_date ASC, COALESCE(event_time, '00:00') ASC, created_at ASC`,
    [caseId]
  );
};

export const insertEvent = async (event: TimelineEvent): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO timeline_events (
      id, case_id, evidence_id, finding_id, event_date, event_time,
      title, description, source, is_verified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.case_id,
      event.evidence_id,
      event.finding_id,
      event.event_date,
      event.event_time,
      event.title,
      event.description,
      event.source,
      event.is_verified,
      event.created_at,
    ]
  );

  await logActivity(
    'event_created',
    `Added timeline event: "${event.title}" (${event.event_date})`,
    event.case_id
  );
};

export const updateEvent = async (event: TimelineEvent): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE timeline_events SET
      event_date = ?, event_time = ?, title = ?, description = ?,
      evidence_id = ?, is_verified = ?
    WHERE id = ?`,
    [
      event.event_date,
      event.event_time,
      event.title,
      event.description,
      event.evidence_id,
      event.is_verified,
      event.id,
    ]
  );
};

export const deleteEvent = async (id: string): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM timeline_events WHERE id = ?', [id]);
};

export const toggleEventVerification = async (
  id: string,
  isVerified: number
): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE timeline_events SET is_verified = ? WHERE id = ?',
    [isVerified, id]
  );
};

// ======================== ACTIVITY LOGS ========================

export const logActivity = async (
  actionType: string,
  description: string,
  caseId?: string,
  detailsJson?: string
): Promise<void> => {
  try {
    const db = await getDatabase();
    const id = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const timestamp = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO activity_logs (id, case_id, action_type, description, details_json, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, caseId || null, actionType, description, detailsJson || null, timestamp]
    );
  } catch (err) {
    console.error('Failed to write activity log:', err);
  }
};

export const getRecentActivity = async (limit: number = 20): Promise<ActivityLog[]> => {
  const db = await getDatabase();
  return await db.getAllAsync<ActivityLog>(
    'SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?',
    [limit]
  );
};

// ======================== STATISTICS & AUDIT ========================

export const getDashboardStats = async (): Promise<CaseStatistics> => {
  const db = await getDatabase();
  
  const casesCountRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM cases'
  );
  const evidenceCountRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM evidence'
  );
  const verifiedFindingsRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM findings WHERE verification_status = 'verified'"
  );
  const pendingFindingsRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM findings WHERE verification_status = 'needs_verification'"
  );
  const timelineCountRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM timeline_events'
  );

  return {
    totalCases: casesCountRow?.count || 0,
    totalEvidence: evidenceCountRow?.count || 0,
    verifiedFindings: verifiedFindingsRow?.count || 0,
    pendingFindings: pendingFindingsRow?.count || 0,
    totalTimelineEvents: timelineCountRow?.count || 0,
  };
};

export const exportAllDatabaseJson = async (): Promise<string> => {
  const db = await getDatabase();
  const cases = await db.getAllAsync('SELECT * FROM cases');
  const evidence = await db.getAllAsync('SELECT * FROM evidence');
  const findings = await db.getAllAsync('SELECT * FROM findings');
  const timeline = await db.getAllAsync('SELECT * FROM timeline_events');
  const logs = await db.getAllAsync('SELECT * FROM activity_logs');

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      vaultVersion: '1.0.0',
      data: { cases, evidence, findings, timeline, logs },
    },
    null,
    2
  );
};

export const wipeAllDatabaseData = async (): Promise<void> => {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM findings;
    DELETE FROM timeline_events;
    DELETE FROM evidence;
    DELETE FROM cases;
    DELETE FROM activity_logs;
  `);
  await logActivity('vault_wiped', 'All vault database records purged by user');
};
