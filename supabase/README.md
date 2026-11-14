# EvidenceVault database (Supabase / PostgreSQL)

Metadata-only schema for authenticated users. Evidence **files**, encryption keys, passwords
and vault passphrases are never stored in these tables. `evidence.storage_path` is a pointer
to a private object, not the object itself.

## Migrations

Apply in filename order:

| # | File | Purpose |
|---|------|---------|
| 1 | `20261114090000_archive_legacy_draft_tables.sql` | Archives the old draft tables (`*_legacy_20261114`), locks them down. No-op on a fresh project. |
| 2 | `20261114090100_create_evidencevault_tables.sql` | Tables, constraints, triggers, signup profile trigger. |
| 3 | `20261114090200_create_evidencevault_indexes.sql` | Indexes aligned with the RLS access paths. |
| 4 | `20261114090300_enable_evidencevault_rls.sql` | Enables RLS, owner-only policies, privilege hardening. |
| 5 | `20261114090400_enable_encrypted_cloud_backup.sql` | Private `evidence-backups` bucket, Storage RLS, backup metadata columns. |

### With `psql` (direct connection)

```bash
DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
  node supabase/tests/apply-migrations.mjs
```

### With the Supabase SQL editor

Open each file in order and run it. Do not run the deprecated root files
`supabase_schema.sql` / `supabase_rls_policies.sql`.

### With the Supabase CLI

```bash
supabase link --project-ref <ref>
supabase db push
```

## Tables

All ids are `uuid` (`gen_random_uuid()`). All timestamps are `timestamptz` defaulting to
`now()`. Ownership columns default to `auth.uid()`.

### `profiles`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | FK → `auth.users(id)` `on delete cascade` |
| `display_name` | text | 1–80 chars or null |
| `created_at` | timestamptz | `default now()` |

Created automatically by the `on_auth_user_created` trigger. No email or other PII is copied.

### `cases`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid | `default auth.uid()`, FK → `auth.users` |
| `title` | text | 1–200 chars |
| `incident_type` | text | 1–100 chars |
| `incident_description` | text | ≤ 20,000 chars |
| `incident_date` | date | |
| `incident_platform` | text | ≤ 100 chars |
| `status` | text | `active` \| `closed` \| `archived` |
| `created_at`, `updated_at` | timestamptz | `updated_at` maintained by trigger |

`unique (id, user_id)` exists as the target for ownership-safe foreign keys.

### `evidence`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `case_id` | uuid | composite FK → `cases(id, user_id)` |
| `user_id` | uuid | `default auth.uid()`, FK → `auth.users` |
| `original_filename` | text | 1–255 chars |
| `mime_type` | text | ≤ 255 chars, default `application/octet-stream` |
| `file_size` | bigint | ≥ 0 |
| `storage_path` | text | unique, ≤ 1024, relative, no `..` segments |
| `sha256_hash` | text | exactly 64 lowercase hex chars |
| `encryption_version` | smallint | ≥ 1 |
| `uploaded_at` | timestamptz | |
| `processing_status` | text | `pending` \| `processing` \| `completed` \| `error` |
| `backup_status` | text | `not_backed_up` \| `uploading` \| `backed_up` \| `failed` |
| `backup_last_success_at` | timestamptz | server-confirmed successful upload time |
| `backup_error` | text | short non-sensitive failure reason, ≤ 500 chars |
| `backup_bytes` | bigint | ciphertext size in Storage, ≥ 0 |
| `backup_ciphertext_sha256` | text | 64 lowercase hex chars, nullable |

### `incident_reports`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `case_id` | uuid | composite FK → `cases(id, user_id)` |
| `user_id` | uuid | `default auth.uid()` |
| `report_content` | text | ≤ 1 MB |
| `report_version` | integer | ≥ 1, unique per case |
| `created_at`, `updated_at` | timestamptz | |

### `audit_events`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid | `default auth.uid()` |
| `case_id` | uuid | nullable, **not** an FK so history survives deletion |
| `event_type` | text | 1–100 chars |
| `evidence_id` | uuid | nullable, **not** an FK |
| `event_metadata` | jsonb | object, ≤ 2 KB, secret-bearing keys rejected |
| `created_at` | timestamptz | forced to `now()` by trigger |

Append-only for API roles. Because `case_id`/`evidence_id` are not foreign keys, a trigger
(`ev_validate_audit_event`) checks on insert that any referenced case/evidence belongs to
`user_id`. This keeps the audit trail after a case is deleted while still preventing
cross-user references.

## Case sync (local-first)

The case screens use SQLite as the on-device source of truth and Supabase as an
authenticated mirror. No mock/demo rows are created by the normal workflow.

- **Create.** The case is inserted locally first. When a Supabase session exists, a stable
  UUID is reserved in `cases.cloud_case_id` before the `cases` upsert, so a retry cannot
  create a second cloud record.
- **Read.** Screens paint local rows immediately, then query `cases` under the user's JWT.
  Cloud rows without a local `cloud_case_id` mapping are inserted locally once. Existing
  local rows are **never** overwritten by cloud data, so local-only fields
  (`incident_time`, `suspect_info`, `severity`) are preserved.
- **Update.** Edits and status changes write locally first, then mirror only the schema-backed
  fields (`title`, `incident_type`, `incident_description`, `incident_date`,
  `incident_platform`, `status`).
- **Delete.** A mapped case is deleted from Supabase first. The local row is removed only
  after Supabase confirms the delete (or reports the row already gone), so a deleted cloud
  case cannot reappear during the next merge.
- **RLS.** Every query runs as the signed-in user; `user_id` is never sent by the app and
  defaults to `auth.uid()` server-side. No `service_role` key is used.

## Encrypted cloud backup (optional)

Cloud backup is opt-in. Evidence files are still stored locally by default.

- **Bucket.** `evidence-backups` is **private**. It accepts `application/octet-stream` only
  and caps each object at 100 MiB. The app's plaintext cap is 95 MiB, leaving room for the
  envelope header and authentication tag.
- **Object path.** `<auth.uid()>/<case uuid>/<evidence uuid>.evb`. A path is unique per
  user, case and evidence row.
- **Storage RLS.** SELECT/INSERT/UPDATE/DELETE are limited to the `authenticated` role.
  The first path segment must equal `auth.uid()`. INSERT/UPDATE also require the second
  segment to be a case owned by that user and the object name to end in `.evb`. A user
  therefore cannot read, modify or delete another user's backup object, even with the
  anon key and a valid JWT.
- **Encryption happens on the device.** The app derives a 256-bit key from the vault
  passphrase with Argon2id, then seals the plaintext with AES-256-GCM using a fresh random
  nonce per backup. The envelope is
  `"EVB1" | uint32 header length | JSON header | ciphertext | 16-byte tag`, and the prefix
  plus header are GCM additional authenticated data. The header binds `userId`, `caseId`
  and `evidenceId`, so an envelope cannot be moved to another row.
- **What Supabase receives.** Only ciphertext plus non-content metadata: file size,
  filename, MIME type, hashes and backup timestamps. The passphrase, raw key and plaintext
  are never sent to Supabase and never written to these tables.
- **Success is server-confirmed.** A local row is marked `backed_up` only after Storage
  confirms the object and its size, and the `evidence` metadata update succeeds. If the
  metadata update fails, the unconfirmed object is removed.
- **Restore verification.** The downloaded ciphertext is checked against
  `backup_ciphertext_sha256` when present, then GCM authenticates the envelope and its
  plaintext SHA-256. The restored file is written locally and the app's recorded
  `evidence.sha256_hash` is recomputed and checked again. A file that fails either check is
  discarded.
- **Recovery key.** The vault passphrase *is* the recovery key. It is never stored or
  escrowed. If it is lost, the vault cannot be unlocked and encrypted backups cannot be
  decrypted. The app requires the user to acknowledge this before vault creation and
  repeats the warning next to the backup controls.
- **Auto-backup is opt-in.** It is off by default, needs an explicit consent action that is
  timestamped, and only runs while a derived key is already cached in memory (for example
  after a manual backup or restore in the same app session). It never prompts for or stores
  a passphrase in the background.
- **No `service_role` in the app.** The client uses only the Supabase URL, anon key and the
  signed-in user's JWT. Storage and table RLS remain the final authority.

## RLS policies

RLS is enabled on all five tables. Every policy targets `to authenticated` and compares the
row owner to `(select auth.uid())`. `anon` has no table privileges at all.

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `profiles` | own row (`id = auth.uid()`) | own row | own row | — |
| `cases` | own rows | own rows | own rows | own rows |
| `evidence` | own rows | own rows | own rows | own rows |
| `incident_reports` | own rows | own rows | own rows | own rows |
| `audit_events` | own rows | own rows | — | — |

`UPDATE` policies use `USING` **and** `WITH CHECK` so a row cannot be handed to another user.
`INSERT` policies use `WITH CHECK` so a row cannot be created for another user.

### Defence in depth (not just RLS)

- **Ownership-safe foreign keys.** `evidence` and `incident_reports` reference
  `cases(id, user_id)`, so even if a policy were wrong, a row cannot be attached to another
  user's case.
- **Immutable columns.** `ev_guard_immutable_columns` triggers reject changes to `id`,
  `user_id`, `created_at`/`uploaded_at`, and `case_id` on update.
- **Audit append-only.** `authenticated` is granted only `SELECT, INSERT` on `audit_events`;
  a trigger also raises on `UPDATE`/`DELETE` from `anon`/`authenticated`. Server-side
  `service_role`/`postgres` can still run retention or account-deletion jobs.
- **Server timestamps.** Audit `created_at` is overwritten with `now()`.
- **Metadata limits.** Audit metadata must be a JSON object ≤ 2 KB and cannot contain keys
  such as `password`, `passphrase`, `token`, `encryption_key`, `file_content`, etc.
- **No secrets stored.** There are no password/passphrase/key/file-bytes columns.

## Verified behaviour

`node supabase/tests/run-rls-tests.mjs` (or `npm run test:rls`) starts a disposable
`postgres:17-alpine` container, applies the real migration files, and runs 122 assertions:

- fresh install: RLS enabled, 17 owner-only policies, no anon privileges, audit append-only
- upgrade path: old draft archived, rows preserved, old policies/privileges removed
- cross-user reads return nothing; cross-user writes are rejected
- ownership fields and `case_id` cannot be changed
- cross-user parent references (evidence/report → case, audit → case/evidence) are rejected
- audit update/delete rejected; metadata secrets/size rejected; timestamps cannot be backdated
- deletes cascade to children, audit history survives, account deletion cascades cleanly
- backup bucket is private, ciphertext-only and size-capped; backup columns are constrained
- Storage RLS rejects cross-user uploads, reads, moves, updates and deletes; anon sees nothing

Run it after any schema change. Do not describe the database as secure on the basis of reading
the policies alone — run the suite.
