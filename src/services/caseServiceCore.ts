import type { Case, CaseStatus, SeverityLevel } from '../types';

/**
 * Pure helpers for the local <-> Supabase case mapping.
 *
 * Keeping this module free of Expo/Supabase imports means the mapping and
 * input validation rules can be unit-tested directly with Node.
 */

export interface CloudCaseRow {
  id: string;
  title: string;
  incident_type: string;
  incident_description: string;
  incident_date: string;
  incident_platform: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CaseDraft {
  title: string;
  category: string;
  description: string;
  incident_date: string;
  incident_time: string;
  platform: string;
  suspect_info: string;
  severity: SeverityLevel;
}

export interface CloudCasePayload {
  id: string;
  title: string;
  incident_type: string;
  incident_description: string;
  incident_date: string;
  incident_platform: string;
  status: CaseStatus;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isValidIncidentDate = (value: string): boolean => {
  const match = DATE_RE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const normalizeCaseStatus = (
  status: string | null | undefined
): CaseStatus => {
  if (status === 'closed' || status === 'archived') return status;
  return 'active';
};

export const normalizeIncidentDate = (
  value: string | null | undefined
): string => {
  const trimmed = (value ?? '').trim();
  if (!isValidIncidentDate(trimmed)) {
    throw new Error(
      'Incident date must be a real calendar date in YYYY-MM-DD format.'
    );
  }
  return trimmed;
};

/**
 * Trim and validate user input before it reaches either SQLite or Supabase.
 * The limits mirror the CHECK constraints in the cloud schema.
 */
export const validateCaseDraft = (draft: CaseDraft): CaseDraft => {
  const title = (draft.title ?? '').trim();
  const category = (draft.category ?? '').trim();
  const platform = (draft.platform ?? '').trim();
  const description = (draft.description ?? '').trim();

  if (!title) {
    throw new Error('Please provide an incident title.');
  }
  if (title.length > 200) {
    throw new Error('Incident title must be 200 characters or fewer.');
  }
  if (!category) {
    throw new Error('Please choose an incident category.');
  }
  if (category.length > 100) {
    throw new Error('Incident category must be 100 characters or fewer.');
  }
  if (description.length > 20000) {
    throw new Error('Incident description must be 20,000 characters or fewer.');
  }
  if (platform.length > 100) {
    throw new Error('Platform must be 100 characters or fewer.');
  }

  return {
    title,
    category,
    description,
    incident_date: normalizeIncidentDate(draft.incident_date),
    incident_time: (draft.incident_time ?? '').trim(),
    platform,
    suspect_info: (draft.suspect_info ?? '').trim(),
    severity: draft.severity,
  };
};

/**
 * Convert a row returned by Supabase into a local Case. Cloud-only fields
 * (time, suspect, severity) keep safe local defaults; they are never guessed
 * from cloud data because the cloud schema does not store them.
 */
export const mapCloudCaseToLocal = (row: CloudCaseRow): Case => {
  const createdAt = row.created_at || new Date().toISOString();
  const updatedAt = row.updated_at || createdAt;

  return {
    id: `case_cloud_${row.id}`,
    title: (row.title || 'Untitled case').trim().slice(0, 200) || 'Untitled case',
    category:
      (row.incident_type || 'Other Digital Incident').trim().slice(0, 100) ||
      'Other Digital Incident',
    description: (row.incident_description ?? '').slice(0, 20000),
    incident_date: isValidIncidentDate(row.incident_date)
      ? row.incident_date
      : createdAt.slice(0, 10),
    incident_time: '',
    platform: (row.incident_platform ?? '').trim().slice(0, 100),
    suspect_info: '',
    severity: 'medium',
    status: normalizeCaseStatus(row.status),
    is_demo: 0,
    created_at: createdAt,
    updated_at: updatedAt,
    cloud_case_id: row.id,
  };
};

/**
 * Build the minimal cloud row. `user_id` is deliberately omitted so the
 * database default `auth.uid()` binds the row to the signed-in account.
 */
export const buildCloudCasePayload = (
  caseItem: Case,
  cloudCaseId: string
): CloudCasePayload => {
  const title = (caseItem.title ?? '').trim();
  if (!title) {
    throw new Error('Please provide an incident title.');
  }

  return {
    id: cloudCaseId,
    title: title.slice(0, 200),
    incident_type:
      (caseItem.category || 'Other Digital Incident').trim().slice(0, 100) ||
      'Other Digital Incident',
    incident_description: (caseItem.description ?? '').slice(0, 20000),
    incident_date: normalizeIncidentDate(caseItem.incident_date),
    incident_platform: (caseItem.platform ?? '').trim().slice(0, 100),
    status: normalizeCaseStatus(caseItem.status),
  };
};
