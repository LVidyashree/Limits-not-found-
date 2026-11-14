/**
 * Qwen AI API Client — EvidenceVault
 * ====================================
 * TypeScript service for communicating with the local Qwen inference backend.
 *
 * All calls go to the local backend (no cloud AI services).
 * Every response includes model status so the UI can display it accurately.
 */

// ─── Backend Configuration ─────────────────────────────────────────────────────

// Update this to match your local backend address when running on a physical device.
// For emulators: Android uses 10.0.2.2, iOS simulator uses localhost.
const BACKEND_BASE_URL = 'http://localhost:8000/api/v1';

// ─── Type Definitions ──────────────────────────────────────────────────────────

export type QwenModelStatus =
  | 'MODEL_NOT_FOUND'
  | 'MODEL_AVAILABLE'
  | 'MODEL_LOADED'
  | 'INFERENCE_ERROR';

export interface QwenStatusResponse {
  status: QwenModelStatus;
  model_path: string;
  message: string;
  file_size_mb?: number;
}

export interface QwenCapabilityResult {
  capability: string;
  model_status: QwenModelStatus;
  error?: string | null;
  result?: Record<string, unknown> | null;
  raw_model_output?: string | null;
  human_review_required: boolean;
  timestamp: string;
}

export interface QwenAnalyzeAllResult {
  case_id: string;
  case_title: string;
  analysis_timestamp: string;
  model_status: QwenModelStatus;
  results: {
    classification?: QwenCapabilityResult;
    entities?: QwenCapabilityResult;
    events?: QwenCapabilityResult;
    timeline?: QwenCapabilityResult;
    conflicts?: QwenCapabilityResult;
    missing_info?: QwenCapabilityResult;
    report?: QwenReportResult;
  };
  human_review_required: boolean;
}

export interface QwenReportResult {
  capability: string;
  model_status: QwenModelStatus;
  timestamp: string;
  human_review_required: boolean;
  report?: {
    incident_overview: Record<string, unknown>;
    ai_incident_classification?: Record<string, unknown> | null;
    extracted_entities?: Record<string, unknown> | null;
    chronological_timeline?: Record<string, unknown> | null;
    conflict_analysis?: Record<string, unknown> | null;
    missing_information?: Record<string, unknown> | null;
    sub_analysis_statuses: Record<string, string>;
    human_review_notes: string;
    legal_disclaimer: string;
  } | null;
  errors?: Record<string, string | null> | null;
}

// ─── Error helper ─────────────────────────────────────────────────────────────

class QwenApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly modelStatus?: QwenModelStatus
  ) {
    super(message);
    this.name = 'QwenApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new QwenApiError(
      `Backend error ${response.status}: ${errorText}`,
      response.status
    );
  }
  return response.json() as Promise<T>;
}

// ─── API Functions ─────────────────────────────────────────────────────────────

/**
 * Check the Qwen model status without triggering a load.
 */
export async function getQwenModelStatus(): Promise<QwenStatusResponse> {
  const response = await fetch(`${BACKEND_BASE_URL}/qwen/status`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<QwenStatusResponse>(response);
}

/**
 * Classify the incident type for a case.
 */
export async function classifyIncident(caseId: string): Promise<QwenCapabilityResult> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/cases/${caseId}/qwen/classify`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<QwenCapabilityResult>(response);
}

/**
 * Run deep entity extraction (people, orgs, locations, amounts, identifiers).
 */
export async function extractEntities(caseId: string): Promise<QwenCapabilityResult> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/cases/${caseId}/qwen/extract-entities`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<QwenCapabilityResult>(response);
}

/**
 * Extract events from evidence text.
 */
export async function extractEvents(caseId: string): Promise<QwenCapabilityResult> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/cases/${caseId}/qwen/extract-events`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<QwenCapabilityResult>(response);
}

/**
 * Generate a chronological timeline from evidence.
 */
export async function generateTimeline(caseId: string): Promise<QwenCapabilityResult> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/cases/${caseId}/qwen/timeline`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<QwenCapabilityResult>(response);
}

/**
 * Detect potential conflicts/inconsistencies across evidence.
 */
export async function detectConflicts(caseId: string): Promise<QwenCapabilityResult> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/cases/${caseId}/qwen/conflicts`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<QwenCapabilityResult>(response);
}

/**
 * Identify missing information gaps.
 */
export async function detectMissingInfo(caseId: string): Promise<QwenCapabilityResult> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/cases/${caseId}/qwen/missing-info`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<QwenCapabilityResult>(response);
}

/**
 * Generate a full structured AI incident report.
 */
export async function generateQwenReport(caseId: string): Promise<QwenReportResult> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/cases/${caseId}/qwen/report`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<QwenReportResult>(response);
}

/**
 * Run all 7 AI capabilities at once.
 * Returns a combined result — individual failures don't block others.
 */
export async function runFullQwenAnalysis(caseId: string): Promise<QwenAnalyzeAllResult> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/cases/${caseId}/qwen/analyze-all`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<QwenAnalyzeAllResult>(response);
}

// ─── Status display helpers ────────────────────────────────────────────────────

export function getStatusLabel(status: QwenModelStatus): string {
  switch (status) {
    case 'MODEL_LOADED':     return '✅ Qwen AI Ready';
    case 'MODEL_AVAILABLE':  return '📦 Model Found — Not Loaded';
    case 'MODEL_NOT_FOUND':  return '⚠️ Model Not Found';
    case 'INFERENCE_ERROR':  return '❌ Inference Error';
    default:                 return '❓ Unknown Status';
  }
}

export function getStatusColor(status: QwenModelStatus): string {
  switch (status) {
    case 'MODEL_LOADED':     return '#10B981'; // green
    case 'MODEL_AVAILABLE':  return '#F59E0B'; // amber
    case 'MODEL_NOT_FOUND':  return '#EF4444'; // red
    case 'INFERENCE_ERROR':  return '#EF4444'; // red
    default:                 return '#6B7280'; // gray
  }
}

export function isModelReady(status: QwenModelStatus): boolean {
  return status === 'MODEL_LOADED' || status === 'MODEL_AVAILABLE';
}
