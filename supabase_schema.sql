-- ============================================================
-- EVIDENCEVAULT — Supabase Schema
-- Run this entire script in Supabase SQL Editor
-- ============================================================

-- 0. Extensions
create extension if not exists "pgcrypto";

-- 1. Profiles table (links Supabase Auth → user metadata)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  vault_created_at timestamptz default now(),
  biometrics_enabled boolean default false,
  updated_at timestamptz default now()
);

-- 2. Cases
create table if not exists cases (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  category text not null,
  description text,
  incident_date text not null,
  incident_time text,
  platform text not null,
  suspect_info text,
  severity text not null default 'medium',
  status text not null default 'active',
  is_demo integer not null default 0,
  created_at text not null,
  updated_at text not null
);

-- 3. Evidence (metadata only — files stay on-device)
create table if not exists evidence (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  case_id text references cases on delete cascade not null,
  filename text not null,
  original_filename text not null,
  file_path text not null,
  file_size integer not null,
  file_type text not null,
  mime_type text,
  sha256_hash text not null,
  processing_status text not null default 'pending',
  extracted_text text,
  metadata_json text,
  created_at text not null,
  is_verified integer not null default 0
);

-- 4. Findings (extracted entities)
create table if not exists findings (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  case_id text references cases on delete cascade not null,
  evidence_id text references evidence on delete cascade not null,
  finding_type text not null,
  finding_value text not null,
  label text not null,
  context_snippet text,
  confidence real not null default 1.0,
  verification_status text not null default 'needs_verification',
  verified_at text,
  user_notes text,
  created_at text not null
);

-- 5. Timeline events
create table if not exists timeline_events (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  case_id text references cases on delete cascade not null,
  evidence_id text references evidence on delete set null,
  finding_id text references findings on delete set null,
  event_date text not null,
  event_time text,
  title text not null,
  description text,
  source text not null,
  is_verified integer not null default 0,
  created_at text not null
);

-- 6. Encrypted cloud backup chunks
create table if not exists encrypted_backups (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  case_id text references cases on delete cascade not null,
  evidence_id text references evidence on delete cascade not null,
  encrypted_chunk bytea,
  chunk_index integer,
  iv bytea not null,
  auth_tag bytea,
  created_at timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_cases_user on cases(user_id);
create index if not exists idx_cases_created on cases(created_at desc);
create index if not exists idx_evidence_case on evidence(case_id);
create index if not exists idx_evidence_user on evidence(user_id);
create index if not exists idx_evidence_hash on evidence(sha256_hash);
create index if not exists idx_findings_case on findings(case_id);
create index if not exists idx_findings_user on findings(user_id);
create index if not exists idx_timeline_case on timeline_events(case_id, event_date);
create index if not exists idx_timeline_user on timeline_events(user_id);
create index if not exists idx_backups_user on encrypted_backups(user_id);
create index if not exists idx_backups_evidence on encrypted_backups(evidence_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table cases enable row level security;
alter table evidence enable row level security;
alter table findings enable row level security;
alter table timeline_events enable row level security;
alter table encrypted_backups enable row level security;

-- Profiles
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Cases
create policy "Users can view own cases"
  on cases for select
  using (auth.uid() = user_id);

create policy "Users can create own cases"
  on cases for insert
  with check (auth.uid() = user_id);

create policy "Users can update own cases"
  on cases for update
  using (auth.uid() = user_id);

create policy "Users can delete own cases"
  on cases for delete
  using (auth.uid() = user_id);

-- Evidence
create policy "Users can view own evidence"
  on evidence for select
  using (auth.uid() = user_id);

create policy "Users can create own evidence"
  on evidence for insert
  with check (auth.uid() = user_id);

create policy "Users can update own evidence"
  on evidence for update
  using (auth.uid() = user_id);

create policy "Users can delete own evidence"
  on evidence for delete
  using (auth.uid() = user_id);

-- Findings
create policy "Users can view own findings"
  on findings for select
  using (auth.uid() = user_id);

create policy "Users can create own findings"
  on findings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own findings"
  on findings for update
  using (auth.uid() = user_id);

create policy "Users can delete own findings"
  on findings for delete
  using (auth.uid() = user_id);

-- Timeline events
create policy "Users can view own timeline"
  on timeline_events for select
  using (auth.uid() = user_id);

create policy "Users can create own timeline"
  on timeline_events for insert
  with check (auth.uid() = user_id);

create policy "Users can update own timeline"
  on timeline_events for update
  using (auth.uid() = user_id);

create policy "Users can delete own timeline"
  on timeline_events for delete
  using (auth.uid() = user_id);

-- Encrypted backups
create policy "Users can view own backups"
  on encrypted_backups for select
  using (auth.uid() = user_id);

create policy "Users can create own backups"
  on encrypted_backups for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own backups"
  on encrypted_backups for delete
  using (auth.uid() = user_id);

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'EvidenceVault User'));
  return new;
end;
$$;

-- Trigger to auto-create profile when user signs up via Supabase Auth
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();