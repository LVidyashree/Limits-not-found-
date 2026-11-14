export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';
export type CaseStatus = 'active' | 'archived' | 'closed';

export type FileCategory = 'image' | 'pdf' | 'document' | 'audio' | 'video' | 'text' | 'other';
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'error';

export type FindingType = 'phone' | 'email' | 'url' | 'financial' | 'account' | 'keyword' | 'date' | 'other';
export type VerificationStatus = 'needs_verification' | 'verified' | 'rejected';

export type EventSource = 'extracted' | 'manual';

export type BackupStatus =
  | 'not_backed_up'
  | 'uploading'
  | 'backed_up'
  | 'failed';

export interface Case {
  id: string;
  title: string;
  category: string;
  description: string;
  incident_date: string;
  incident_time: string;
  platform: string;
  suspect_info: string;
  severity: SeverityLevel;
  status: CaseStatus;
  is_demo: number;
  created_at: string;
  updated_at: string;
  /** UUID of the corresponding row in Supabase, when cloud backup is used. */
  cloud_case_id?: string | null;
}

export interface Evidence {
  id: string;
  case_id: string;
  filename: string;
  original_filename: string;
  file_path: string;
  file_size: number;
  file_type: FileCategory;
  mime_type: string;
  sha256_hash: string;
  processing_status: ProcessingStatus;
  extracted_text: string | null;
  metadata_json: string | null;
  created_at: string;
  is_verified: number;
  /** UUID of the corresponding Supabase evidence row, when backed up. */
  cloud_evidence_id?: string | null;
  /** UUID of the Supabase case row used for the backup path. */
  cloud_case_id?: string | null;
  backup_status?: BackupStatus;
  /** Last confirmed successful upload (ISO 8601). */
  backup_last_at?: string | null;
  backup_error?: string | null;
  /** Object path inside the private `evidence-backups` bucket. */
  backup_storage_path?: string | null;
  /** Size of the encrypted envelope on the server. */
  backup_bytes?: number | null;
  /** SHA-256 of the encrypted envelope, used to check downloads. */
  backup_ciphertext_sha256?: string | null;
}

export interface Finding {
  id: string;
  case_id: string;
  evidence_id: string;
  finding_type: FindingType;
  finding_value: string;
  label: string;
  context_snippet: string;
  confidence: number;
  verification_status: VerificationStatus;
  verified_at: string | null;
  user_notes: string | null;
  created_at: string;
}

export interface TimelineEvent {
  id: string;
  case_id: string;
  evidence_id: string | null;
  finding_id: string | null;
  event_date: string;
  event_time: string | null;
  title: string;
  description: string;
  source: EventSource;
  is_verified: number;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  case_id: string | null;
  action_type: string;
  description: string;
  details_json: string | null;
  timestamp: string;
}

export interface CaseStatistics {
  totalCases: number;
  totalEvidence: number;
  verifiedFindings: number;
  pendingFindings: number;
  totalTimelineEvents: number;
}

export interface FileMetadata {
  size: number;
  uri: string;
  mimeType?: string;
  name?: string;
  modificationTime?: number;
  dimensions?: { width: number; height: number };
}

export interface VaultState {
  isInitialized: boolean;
  isUnlocked: boolean;
  biometricsAvailable: boolean;
  biometricsEnabled: boolean;
}

// ─── Qwen AI types ─────────────────────────────────────────────────────────────

export type QwenModelStatus =
  | 'MODEL_NOT_FOUND'
  | 'MODEL_AVAILABLE'
  | 'MODEL_LOADED'
  | 'INFERENCE_ERROR';

export interface QwenStatusInfo {
  status: QwenModelStatus;
  model_path: string;
  message: string;
  file_size_mb?: number;
}

export interface QwenAnalysisResult {
  capability: string;
  model_status: QwenModelStatus;
  error?: string | null;
  result?: Record<string, unknown> | null;
  human_review_required: boolean;
  timestamp: string;
}

export interface QwenFullAnalysis {
  case_id: string;
  case_title: string;
  analysis_timestamp: string;
  model_status: QwenModelStatus;
  results: {
    classification?: QwenAnalysisResult;
    entities?: QwenAnalysisResult;
    events?: QwenAnalysisResult;
    timeline?: QwenAnalysisResult;
    conflicts?: QwenAnalysisResult;
    missing_info?: QwenAnalysisResult;
    report?: Record<string, unknown>;
  };
  human_review_required: boolean;
}

// ─── Navigation ────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  WelcomeVault: undefined;
  Dashboard: undefined;
  CaseList: undefined;
  CaseDetail: { caseId: string };
  CreateIncident: { caseId?: string };
  UploadEvidence: { caseId: string };
  EvidenceDetail: { evidenceId: string; caseId: string };
  Analysis: { caseId: string };
  Timeline: { caseId: string };
  Verification: { caseId: string };
  Report: { caseId: string };
  TrustCentre: undefined;
};

