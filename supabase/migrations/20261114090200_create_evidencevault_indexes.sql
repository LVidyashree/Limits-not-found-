-- ============================================================
-- 20261114090200_create_evidencevault_indexes.sql
--
-- Indexes follow the RLS access paths: every policy filters on
-- user_id, and most reads are scoped to a case or ordered by time.
-- ============================================================

begin;

-- cases
create index cases_user_created_idx
  on public.cases (user_id, created_at desc);
create index cases_user_status_idx
  on public.cases (user_id, status);

-- evidence
create index evidence_case_uploaded_idx
  on public.evidence (case_id, uploaded_at desc);
create index evidence_user_uploaded_idx
  on public.evidence (user_id, uploaded_at desc);
create index evidence_user_hash_idx
  on public.evidence (user_id, sha256_hash);

-- incident_reports
create index incident_reports_case_version_idx
  on public.incident_reports (case_id, report_version desc);
create index incident_reports_user_created_idx
  on public.incident_reports (user_id, created_at desc);

-- audit_events
create index audit_events_user_created_idx
  on public.audit_events (user_id, created_at desc);
create index audit_events_case_created_idx
  on public.audit_events (case_id, created_at desc)
  where case_id is not null;
create index audit_events_evidence_idx
  on public.audit_events (evidence_id)
  where evidence_id is not null;

commit;
