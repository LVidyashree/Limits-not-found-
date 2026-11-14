-- ============================================================
-- 20261114090100_create_evidencevault_tables.sql
--
-- Reviewed EvidenceVault schema. Metadata only: no evidence file
-- bytes, no encryption keys, no passwords or vault passphrases are
-- stored in these tables. `evidence.storage_path` is a pointer to a
-- private object; it is not the file itself.
--
-- Ownership model:
--   * every user-owned row carries user_id = auth.uid()
--   * evidence / incident_reports reference cases through the
--     composite key (case_id, user_id), so a row can never be attached
--     to another user's case
--   * id, user_id, created_at/uploaded_at and case_id are immutable
--     after insert (enforced by triggers, not just RLS)
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Helper: reject obvious secrets in audit metadata and cap its size.
-- This is defence in depth; callers must still send only minimal,
-- non-sensitive metadata.
-- ------------------------------------------------------------
create or replace function public.ev_audit_metadata_is_safe(metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(metadata) <> 'object' then false
    when octet_length(metadata::text) > 2048 then false
    else not exists (
      select 1
      from jsonb_object_keys(metadata) as key
      where lower(key) in (
        'password', 'passphrase', 'secret', 'token', 'access_token',
        'refresh_token', 'api_key', 'apikey', 'encryption_key', 'vault_key',
        'private_key', 'file_content', 'evidence_content', 'plaintext'
      )
    )
  end;
$$;

comment on function public.ev_audit_metadata_is_safe(jsonb) is
  'Caps audit metadata at 2 KB and rejects obvious secret-bearing keys.';

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  constraint profiles_display_name_len check (
    display_name is null
    or char_length(btrim(display_name)) between 1 and 80
  )
);

comment on table public.profiles is
  'Minimal public profile. No email, phone, address, password or key material is stored here.';

-- Carry over display names from the archived draft profiles, then remove
-- the draft table: created_at replaces vault_created_at and the draft
-- biometrics flag does not belong in the cloud database.
do $$
declare
  created_expr text := 'now()';
begin
  if to_regclass('public.profiles_legacy_20261114') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles_legacy_20261114'
        and column_name = 'vault_created_at'
    ) then
      created_expr := 'coalesce(vault_created_at, now())';
    end if;

    execute format(
      'insert into public.profiles (id, display_name, created_at)
       select p.id, p.display_name, %s
       from public.profiles_legacy_20261114 p
       on conflict (id) do nothing',
      created_expr
    );

    drop table public.profiles_legacy_20261114;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- cases
-- ------------------------------------------------------------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  title text not null,
  incident_type text not null,
  incident_description text not null default '',
  incident_date date not null,
  incident_platform text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cases_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint cases_incident_type_len check (
    char_length(btrim(incident_type)) between 1 and 100
  ),
  constraint cases_description_len check (char_length(incident_description) <= 20000),
  constraint cases_platform_len check (char_length(incident_platform) <= 100),
  constraint cases_status_valid check (status in ('active', 'closed', 'archived')),
  -- Target for the (case_id, user_id) foreign keys below.
  constraint cases_id_user_unique unique (id, user_id)
);

comment on table public.cases is
  'One incident case per row, owned by exactly one authenticated user.';

-- ------------------------------------------------------------
-- evidence
-- ------------------------------------------------------------
create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  original_filename text not null,
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null,
  storage_path text not null,
  sha256_hash text not null,
  encryption_version smallint not null default 1,
  uploaded_at timestamptz not null default now(),
  processing_status text not null default 'pending',
  -- Ownership-safe parent reference: the case must belong to the same user.
  constraint evidence_case_owner_fk foreign key (case_id, user_id)
    references public.cases (id, user_id) on delete cascade,
  constraint evidence_filename_len check (
    char_length(btrim(original_filename)) between 1 and 255
  ),
  constraint evidence_mime_len check (char_length(mime_type) between 1 and 255),
  constraint evidence_file_size_nonneg check (file_size >= 0),
  constraint evidence_storage_path_len check (
    char_length(storage_path) between 1 and 1024
  ),
  constraint evidence_storage_path_relative check (
    storage_path !~ '(^|/)\.\.(/|$)' and storage_path !~ '^/'
  ),
  constraint evidence_sha256_format check (sha256_hash ~ '^[0-9a-f]{64}$'),
  constraint evidence_encryption_version check (encryption_version >= 1),
  constraint evidence_processing_status check (
    processing_status in ('pending', 'processing', 'completed', 'error')
  ),
  constraint evidence_storage_path_unique unique (storage_path)
);

comment on table public.evidence is
  'Evidence metadata only. File bytes live in private object storage as ciphertext; encryption keys are never stored here.';

-- ------------------------------------------------------------
-- incident_reports
-- ------------------------------------------------------------
create table public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  report_content text not null default '',
  report_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incident_reports_case_owner_fk foreign key (case_id, user_id)
    references public.cases (id, user_id) on delete cascade,
  constraint incident_reports_content_len check (
    char_length(report_content) <= 1048576
  ),
  constraint incident_reports_version_positive check (report_version >= 1),
  constraint incident_reports_case_version_unique unique (case_id, report_version)
);

comment on table public.incident_reports is
  'Editable AI-assisted report text. Versioned per case; never stores model keys or evidence bytes.';

-- ------------------------------------------------------------
-- audit_events
--
-- case_id and evidence_id are deliberately NOT foreign keys: audit
-- history must survive deletion of the case or evidence it refers to.
-- Ownership is validated by a trigger on insert, and rows are
-- append-only for API roles.
-- ------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  case_id uuid,
  event_type text not null,
  evidence_id uuid,
  event_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_type_len check (
    char_length(btrim(event_type)) between 1 and 100
  ),
  constraint audit_events_metadata_object check (
    jsonb_typeof(event_metadata) = 'object'
  ),
  constraint audit_events_metadata_safe check (
    public.ev_audit_metadata_is_safe(event_metadata)
  )
);

comment on table public.audit_events is
  'Append-only activity log. Metadata is limited to 2 KB and must never contain passwords, passphrases, tokens, keys or file content.';

-- ------------------------------------------------------------
-- updated_at maintenance
-- ------------------------------------------------------------
create or replace function public.ev_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Immutable columns
--
-- Trigger arguments are column names that may not change after insert.
-- This prevents a user from re-pointing a row at another user or case
-- even if a future policy is written incorrectly.
-- ------------------------------------------------------------
create or replace function public.ev_guard_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  column_name text;
begin
  foreach column_name in array tg_argv loop
    if (to_jsonb(new) -> column_name) is distinct from (to_jsonb(old) -> column_name) then
      raise exception 'column % is immutable on %', column_name, tg_table_name
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Audit-event ownership validation
-- Runs as the table owner so it can check the parent rows without
-- depending on the caller's RLS visibility, but it explicitly compares
-- user_id against the parent rows.
-- ------------------------------------------------------------
create or replace function public.ev_validate_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Server-side timestamp: clients cannot backdate audit events.
  new.created_at := now();

  if new.case_id is not null and not exists (
    select 1 from public.cases c
    where c.id = new.case_id and c.user_id = new.user_id
  ) then
    raise exception 'audit event references a case not owned by the user'
      using errcode = '42501';
  end if;

  if new.evidence_id is not null and not exists (
    select 1 from public.evidence e
    where e.id = new.evidence_id and e.user_id = new.user_id
  ) then
    raise exception 'audit event references evidence not owned by the user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- Audit immutability
-- API roles can never update or delete audit rows. Server-side
-- maintenance (service_role / postgres) remains possible for retention
-- and account deletion.
-- ------------------------------------------------------------
create or replace function public.ev_block_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'audit_events are append-only'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Signup: create the minimal profile row
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------
create trigger profiles_immutable_columns
  before update on public.profiles
  for each row execute function public.ev_guard_immutable_columns('id', 'created_at');

create trigger cases_touch_updated_at
  before update on public.cases
  for each row execute function public.ev_touch_updated_at();

create trigger cases_immutable_columns
  before update on public.cases
  for each row execute function public.ev_guard_immutable_columns(
    'id', 'user_id', 'created_at'
  );

create trigger evidence_immutable_columns
  before update on public.evidence
  for each row execute function public.ev_guard_immutable_columns(
    'id', 'case_id', 'user_id', 'uploaded_at'
  );

create trigger incident_reports_touch_updated_at
  before update on public.incident_reports
  for each row execute function public.ev_touch_updated_at();

create trigger incident_reports_immutable_columns
  before update on public.incident_reports
  for each row execute function public.ev_guard_immutable_columns(
    'id', 'case_id', 'user_id', 'created_at'
  );

create trigger audit_events_validate
  before insert on public.audit_events
  for each row execute function public.ev_validate_audit_event();

create trigger audit_events_block_mutation
  before update or delete on public.audit_events
  for each row execute function public.ev_block_audit_mutation();

commit;
