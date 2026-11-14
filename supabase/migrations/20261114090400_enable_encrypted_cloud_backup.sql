-- ============================================================
-- 20261114090400_enable_encrypted_cloud_backup.sql
--
-- Optional encrypted cloud backup.
--
-- Guarantees:
--   * `evidence-backups` is a PRIVATE bucket.
--   * Object paths are `<auth.uid()>/<case uuid>/<evidence uuid>.evb`.
--   * Storage RLS only lets a user read/write objects whose first path
--     segment is their own auth.uid() AND whose second segment is a case
--     they own.
--   * Only ciphertext is uploaded. Keys and passphrases are never stored
--     in Postgres, Storage metadata or bucket policies.
--   * Backup status is recorded on public.evidence. A row is not marked
--     `backed_up` until Storage confirms the upload and the metadata update
--     succeeds.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Backup metadata on the evidence table
-- ------------------------------------------------------------
alter table public.evidence
  add column if not exists backup_status text not null default 'not_backed_up',
  add column if not exists backup_last_success_at timestamptz,
  add column if not exists backup_error text,
  add column if not exists backup_bytes bigint,
  add column if not exists backup_ciphertext_sha256 text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'evidence_backup_status_valid'
      and conrelid = 'public.evidence'::regclass
  ) then
    alter table public.evidence
      add constraint evidence_backup_status_valid
      check (backup_status in ('not_backed_up', 'uploading', 'backed_up', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'evidence_backup_error_len'
      and conrelid = 'public.evidence'::regclass
  ) then
    alter table public.evidence
      add constraint evidence_backup_error_len
      check (backup_error is null or char_length(backup_error) <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'evidence_backup_bytes_nonneg'
      and conrelid = 'public.evidence'::regclass
  ) then
    alter table public.evidence
      add constraint evidence_backup_bytes_nonneg
      check (backup_bytes is null or backup_bytes >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'evidence_backup_ciphertext_sha256_format'
      and conrelid = 'public.evidence'::regclass
  ) then
    alter table public.evidence
      add constraint evidence_backup_ciphertext_sha256_format
      check (
        backup_ciphertext_sha256 is null
        or backup_ciphertext_sha256 ~ '^[0-9a-f]{64}$'
      );
  end if;
end;
$$;

comment on column public.evidence.backup_status is
  'Client-visible backup state: not_backed_up, uploading, backed_up or failed.';
comment on column public.evidence.backup_last_success_at is
  'Server-confirmed timestamp of the last successful encrypted upload.';
comment on column public.evidence.backup_error is
  'Short, non-sensitive failure reason. Never contains keys or passphrases.';
comment on column public.evidence.backup_bytes is
  'Size of the encrypted envelope in Storage, not the plaintext size.';
comment on column public.evidence.backup_ciphertext_sha256 is
  'SHA-256 of the encrypted envelope, used to check downloads before decryption.';
comment on column public.evidence.storage_path is
  'Private object path: <user uuid>/<case uuid>/<evidence uuid>.evb.';

create index if not exists evidence_backup_status_idx
  on public.evidence (user_id, backup_status);

create index if not exists evidence_backup_last_success_idx
  on public.evidence (user_id, backup_last_success_at desc);

-- ------------------------------------------------------------
-- 2. Private bucket
--
-- If the bucket already exists, force it back to private and apply the
-- ciphertext-only content type and size limit.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence-backups',
  'evidence-backups',
  false,
  104857600, -- 100 MiB per encrypted envelope
  array['application/octet-stream']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

comment on table storage.buckets is
  'Supabase-managed bucket registry. evidence-backups must remain private.';

-- ------------------------------------------------------------
-- 3. Storage RLS
--
-- Supabase enables RLS on storage.objects. These policies are additive for
-- this bucket only; no other bucket is affected.
-- ------------------------------------------------------------
drop policy if exists evidence_backup_select_own on storage.objects;
drop policy if exists evidence_backup_insert_own on storage.objects;
drop policy if exists evidence_backup_update_own on storage.objects;
drop policy if exists evidence_backup_delete_own on storage.objects;

create policy evidence_backup_select_own
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'evidence-backups'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy evidence_backup_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'evidence-backups'
    and name like '%.evb'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.cases c
      where c.id::text = (storage.foldername(name))[2]
        and c.user_id = (select auth.uid())
    )
  );

create policy evidence_backup_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'evidence-backups'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'evidence-backups'
    and name like '%.evb'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.cases c
      where c.id::text = (storage.foldername(name))[2]
        and c.user_id = (select auth.uid())
    )
  );

create policy evidence_backup_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'evidence-backups'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ------------------------------------------------------------
-- 4. Refresh PostgREST/Storage schema caches
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

commit;
