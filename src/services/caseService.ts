import * as Crypto from 'expo-crypto';

import type { Case, CaseStatus } from '../types';
import { supabase, isSupabaseConfigured } from './supabase';
import {
  deleteCase,
  getAllCases,
  getCaseById,
  insertCase,
  insertCaseFromCloud,
  setCaseCloudId,
  updateCase,
  updateCaseStatus,
} from './database';
import {
  CaseDraft,
  CloudCaseRow,
  buildCloudCasePayload,
  mapCloudCaseToLocal,
  normalizeCaseStatus,
  validateCaseDraft,
} from './caseServiceCore';

/**
 * Authenticated case synchronisation.
 *
 * SQLite remains the source of truth on this device. Supabase is an
 * authenticated mirror:
 *   * creating/editing a case writes locally first, then upserts the same
 *     stable cloud UUID (`cloud_case_id`) when the user is signed in;
 *   * opening the app merges cloud-only cases into SQLite;
 *   * an existing local row is never overwritten by a cloud row;
 *   * deleting a synced case requires the cloud delete to succeed first so
 *     the row cannot reappear on the next merge.
 *
 * All Supabase access uses the signed-in user's JWT, so RLS remains the
 * authority. No service-role key is used anywhere.
 */

const CLOUD_CASE_COLUMNS =
  'id,title,incident_type,incident_description,incident_date,incident_platform,status,created_at,updated_at';
const CLOUD_CASE_LIMIT = 500;

export interface CaseCloudResult {
  localCase: Case;
  cloudSynced: boolean;
  cloudError: string | null;
}

export interface CaseSyncResult {
  imported: number;
  cloudError: string | null;
  cloudUsed: boolean;
}

export interface CaseDeleteResult {
  cloudDeleted: boolean;
}

const describeError = (error: unknown): string => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Cloud sync failed';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 400) || 'Cloud sync failed';
};

const getAuthenticatedUserId = async (): Promise<string | null> => {
  if (!isSupabaseConfigured) return null;

  try {
    // getSession reads the persisted session and refreshes it if needed. The
    // actual queries below still go through RLS with the user's JWT.
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user?.id) return null;
    return data.session.user.id;
  } catch {
    return null;
  }
};

const fetchCloudCases = async (): Promise<CloudCaseRow[]> => {
  const { data, error } = await supabase
    .from('cases')
    .select(CLOUD_CASE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(CLOUD_CASE_LIMIT);

  if (error) {
    throw new Error(`Could not load cases from your account: ${error.message}`);
  }

  return (data ?? []) as CloudCaseRow[];
};

const upsertCloudCase = async (
  caseItem: Case,
  cloudCaseId: string
): Promise<void> => {
  const payload = buildCloudCasePayload(caseItem, cloudCaseId);

  const { data, error } = await supabase
    .from('cases')
    .upsert(payload, { onConflict: 'id' })
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`Could not save this case to your account: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Supabase did not confirm that the case was saved.');
  }
};

/**
 * Fetch the signed-in user's cloud cases and insert any that are missing
 * locally. Existing local rows (matched by cloud_case_id) are left untouched.
 */
export const syncCloudCasesIntoLocal = async (
  localCases?: Case[]
): Promise<CaseSyncResult> => {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { imported: 0, cloudError: null, cloudUsed: false };
  }

  let cloudRows: CloudCaseRow[];
  try {
    cloudRows = await fetchCloudCases();
  } catch (error) {
    return {
      imported: 0,
      cloudError: describeError(error),
      cloudUsed: false,
    };
  }

  const local = localCases ?? (await getAllCases());
  const byCloudId = new Map<string, Case>();
  const byLocalId = new Map<string, Case>();

  for (const item of local) {
    byLocalId.set(item.id, item);
    if (item.cloud_case_id) byCloudId.set(item.cloud_case_id, item);
  }

  let imported = 0;
  let importError: string | null = null;

  for (const row of cloudRows) {
    if (byCloudId.has(row.id)) continue;

    try {
      const mapped = mapCloudCaseToLocal(row);
      const collision = byLocalId.get(mapped.id);

      // The deterministic local id can already exist if a previous import
      // completed but the cloud mapping was lost. Link it instead of
      // inserting a duplicate row.
      if (collision) {
        if (!collision.cloud_case_id) {
          await setCaseCloudId(collision.id, row.id);
          byCloudId.set(row.id, { ...collision, cloud_case_id: row.id });
        }
        continue;
      }

      await insertCaseFromCloud(mapped);
      byCloudId.set(row.id, mapped);
      byLocalId.set(mapped.id, mapped);
      imported += 1;
    } catch (error) {
      importError = importError ?? describeError(error);
    }
  }

  return {
    imported,
    cloudError: importError,
    cloudUsed: true,
  };
};

/**
 * Create a case locally first. When signed in, reserve a stable cloud UUID on
 * the local row before the upload request so a retry cannot create a second
 * cloud record.
 */
export const createCaseWithCloud = async (
  draft: CaseDraft
): Promise<CaseCloudResult> => {
  const valid = validateCaseDraft(draft);
  const userId = await getAuthenticatedUserId();
  const cloudCaseId = userId ? Crypto.randomUUID() : null;
  const now = new Date().toISOString();

  const localCase: Case = {
    ...valid,
    id: `case_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'active',
    is_demo: 0,
    created_at: now,
    updated_at: now,
    cloud_case_id: cloudCaseId,
  };

  await insertCase(localCase);

  if (!userId || !cloudCaseId) {
    return { localCase, cloudSynced: false, cloudError: null };
  }

  try {
    await upsertCloudCase(localCase, cloudCaseId);
    return { localCase, cloudSynced: true, cloudError: null };
  } catch (error) {
    return {
      localCase,
      cloudSynced: false,
      cloudError: describeError(error),
    };
  }
};

/**
 * Update an existing case locally, then mirror it to Supabase. A legacy local
 * case without a cloud mapping is given a new stable UUID and upserted.
 */
export const updateCaseWithCloud = async (
  caseItem: Case
): Promise<CaseCloudResult> => {
  const valid = validateCaseDraft({
    title: caseItem.title,
    category: caseItem.category,
    description: caseItem.description,
    incident_date: caseItem.incident_date,
    incident_time: caseItem.incident_time,
    platform: caseItem.platform,
    suspect_info: caseItem.suspect_info,
    severity: caseItem.severity,
  });

  const updated: Case = {
    ...caseItem,
    ...valid,
    updated_at: new Date().toISOString(),
  };

  // Local write happens before any network call so the edit is never lost.
  await updateCase(updated);

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { localCase: updated, cloudSynced: false, cloudError: null };
  }

  let cloudCaseId = caseItem.cloud_case_id ?? null;

  try {
    if (!cloudCaseId) {
      const newCloudId = Crypto.randomUUID();
      await setCaseCloudId(updated.id, newCloudId);
      cloudCaseId = newCloudId;
    }

    await upsertCloudCase(
      { ...updated, cloud_case_id: cloudCaseId },
      cloudCaseId
    );

    return {
      localCase: { ...updated, cloud_case_id: cloudCaseId },
      cloudSynced: true,
      cloudError: null,
    };
  } catch (error) {
    return {
      localCase: { ...updated, cloud_case_id: cloudCaseId },
      cloudSynced: false,
      cloudError: describeError(error),
    };
  }
};

/**
 * Update only the status. The cloud write uses a targeted UPDATE so unrelated
 * cloud fields (and any locally-only fields) are not rewritten.
 */
export const updateCaseStatusWithCloud = async (
  caseId: string,
  status: CaseStatus
): Promise<CaseCloudResult> => {
  const existing = await getCaseById(caseId);
  if (!existing) {
    throw new Error('That case is no longer available on this device.');
  }

  if (existing.status === status) {
    return { localCase: existing, cloudSynced: Boolean(existing.cloud_case_id), cloudError: null };
  }

  const now = new Date().toISOString();
  await updateCaseStatus(caseId, status, now);
  const updated: Case = { ...existing, status, updated_at: now };

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { localCase: updated, cloudSynced: false, cloudError: null };
  }

  let cloudCaseId = existing.cloud_case_id ?? null;

  try {
    if (!cloudCaseId) {
      const newCloudId = Crypto.randomUUID();
      await setCaseCloudId(caseId, newCloudId);
      cloudCaseId = newCloudId;
      await upsertCloudCase(
        { ...updated, cloud_case_id: cloudCaseId },
        cloudCaseId
      );
    } else {
      const { data, error } = await supabase
        .from('cases')
        .update({ status: normalizeCaseStatus(status) })
        .eq('id', cloudCaseId)
        .select('id')
        .maybeSingle<{ id: string }>();

      if (error) {
        throw new Error(
          `Could not update the case status in your account: ${error.message}`
        );
      }
      if (!data?.id) {
        throw new Error(
          'The cloud copy of this case is no longer available, so its status was not changed online.'
        );
      }
    }

    return {
      localCase: { ...updated, cloud_case_id: cloudCaseId },
      cloudSynced: true,
      cloudError: null,
    };
  } catch (error) {
    return {
      localCase: updated,
      cloudSynced: false,
      cloudError: describeError(error),
    };
  }
};

/**
 * Delete the cloud row first (when mapped), confirm Supabase accepted it, then
 * remove the local row. If the cloud delete fails, nothing local is removed,
 * so the user can retry and the case cannot silently reappear.
 */
export const deleteCaseWithCloud = async (
  caseId: string
): Promise<CaseDeleteResult> => {
  const existing = await getCaseById(caseId);
  if (!existing) {
    await deleteCase(caseId);
    return { cloudDeleted: false };
  }

  const userId = await getAuthenticatedUserId();
  let cloudDeleted = false;

  if (userId && existing.cloud_case_id) {
    const { error } = await supabase
      .from('cases')
      .delete()
      .eq('id', existing.cloud_case_id)
      .select('id');

    if (error) {
      throw new Error(
        `Could not delete this case from your account: ${error.message}`
      );
    }

    // No rows also means the cloud row was already gone; deleting the local
    // copy is still safe and prevents it from being re-imported.
    cloudDeleted = true;
  }

  await deleteCase(caseId);
  return { cloudDeleted };
};
