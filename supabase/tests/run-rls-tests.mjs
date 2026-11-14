#!/usr/bin/env node
// ============================================================
// EvidenceVault RLS test harness.
//
// Runs a disposable PostgreSQL container, applies the real migration
// files, and exercises the policies as anon / authenticated users.
//
// It also simulates an upgrade from the earlier draft schema and checks
// that the draft is archived and locked down.
//
// Requirements: Docker. No npm dependencies.
//
//   node supabase/tests/run-rls-tests.mjs
// ============================================================

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const supabaseDir = resolve(here, '..');
const migrationsDir = join(supabaseDir, 'migrations');
const fixturesDir = join(here, 'fixtures');

const container = `ev-rls-${process.pid}`;
const image = process.env.EV_PG_IMAGE || 'postgres:17-alpine';
const freshDb = 'evfresh';
const upgradeDb = 'evupgrade';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const CASE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CASE_A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const EV_A = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EV_B = 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EV_A2 = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const REP_A = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REP_B = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REP_A2 = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const AUDIT_A = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUDIT_B = 'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AUDIT_A2 = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const AUDIT_OLD = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
const HASH = 'a'.repeat(64);

let passed = 0;
let failed = 0;

function record(ok, label, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${label}`);
    if (detail) console.error(`        ${String(detail).trim().replace(/\n/g, '\n        ')}`);
  }
}

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options });
}

function psql(db, sql) {
  return docker(
    [
      'exec', '-i', container,
      'psql', '-U', 'postgres', '-d', db,
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ],
    { input: sql }
  );
}

function execAs(db, role, sub, sql) {
  let preamble = '';
  if (role) preamble += `set role ${role};\n`;
  if (sub) preamble += `set request.jwt.claim.sub = '${sub}';\n`;
  return psql(db, preamble + sql);
}

function expectOk(label, db, sql, { role, sub } = {}) {
  const result = execAs(db, role, sub, sql);
  if (result.status !== 0) {
    record(false, label, result.stderr);
    return;
  }
  record(true, label);
}

function expectValue(label, db, sql, expected, { role, sub } = {}) {
  const result = execAs(db, role, sub, sql);
  if (result.status !== 0) {
    record(false, label, result.stderr);
    return;
  }
  const actual = result.stdout.trim();
  record(actual === String(expected), label, `expected "${expected}", got "${actual}"`);
}

function expectFail(label, db, sql, pattern, { role, sub } = {}) {
  const result = execAs(db, role, sub, sql);
  if (result.status === 0) {
    record(false, label, `statement unexpectedly succeeded: ${result.stdout.trim()}`);
    return;
  }
  if (pattern && !new RegExp(pattern, 'i').test(result.stderr)) {
    record(false, label, `error did not match /${pattern}/: ${result.stderr}`);
    return;
  }
  record(true, label);
}

function applyFile(db, path) {
  const result = psql(db, readFileSync(path, 'utf8'));
  if (result.status !== 0) {
    throw new Error(`Failed to apply ${path}\n${result.stderr}`);
  }
}

function waitForDatabase() {
  const query = (sql) =>
    docker([
      'exec', container,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-A', '-t', '-c', sql,
    ]);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const first = query('select 1');
    if (first.status === 0 && first.stdout.trim() === '1') {
      // The image's entrypoint briefly serves connections from a
      // temporary init server. Require a second successful query after
      // a pause so we are talking to the final server, not that one.
      spawnSync('sleep', ['2']);
      const second = query('select 1');
      if (second.status === 0 && second.stdout.trim() === '1') return true;
    }
    spawnSync('sleep', ['1']);
  }
  return false;
}

function ensureDatabases() {
  const sql = `
    select 'create database ${freshDb}'
     where not exists (select 1 from pg_database where datname = '${freshDb}')\\gexec
    select 'create database ${upgradeDb}'
     where not exists (select 1 from pg_database where datname = '${upgradeDb}')\\gexec
  `;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const created = psql('postgres', sql);
    const check = psql(
      'postgres',
      `select count(*) from pg_database
        where datname in ('${freshDb}', '${upgradeDb}')`
    );
    if (
      check.status === 0 &&
      check.stdout.trim() === '2'
    ) {
      return { ok: true };
    }
    spawnSync('sleep', ['1']);
    if (attempt === 59 && created.status !== 0) {
      return { ok: false, detail: created.stderr };
    }
  }
  return { ok: false, detail: 'timed out waiting for test databases' };
}

function checkUpgrade() {
  expectValue(
    'draft cases archived with rows preserved',
    upgradeDb,
    `select count(*) from public.cases_legacy_20261114`,
    '1'
  );
  expectValue(
    'draft evidence archived with rows preserved',
    upgradeDb,
    `select count(*) from public.evidence_legacy_20261114`,
    '1'
  );
  expectValue(
    'reviewed cases table exists and starts empty',
    upgradeDb,
    `select count(*) from public.cases`,
    '0'
  );
  expectValue(
    'draft profiles backfilled into the reviewed table',
    upgradeDb,
    `select display_name from public.profiles where id = '${A}'`,
    'Legacy User A'
  );
  expectValue(
    'draft profiles table removed after backfill',
    upgradeDb,
    `select to_regclass('public.profiles_legacy_20261114') is null`,
    't'
  );
  expectValue(
    'authenticated has no privilege on archived cases',
    upgradeDb,
    `select has_table_privilege('authenticated', 'public.cases_legacy_20261114', 'SELECT')`,
    'f'
  );
  expectValue(
    'all policies removed from archived tables',
    upgradeDb,
    `select count(*) from pg_policies where schemaname = 'public' and tablename like '%_legacy_20261114'`,
    '0'
  );
  expectFail(
    'authenticated cannot read archived draft rows',
    upgradeDb,
    `select count(*) from public.cases_legacy_20261114`,
    'permission denied',
    { role: 'authenticated', sub: A }
  );

  // The signup trigger must now write to the reviewed profiles table.
  expectOk(
    'new signup after upgrade succeeds',
    upgradeDb,
    `insert into auth.users (id, email, raw_user_meta_data)
     values ('${C}', 'c@example.test', '{"display_name":"User C"}')`
  );
  expectValue(
    'new signup is written to the reviewed profiles table',
    upgradeDb,
    `select display_name from public.profiles where id = '${C}'`,
    'User C'
  );
  expectOk(
    'signup test user cleaned up',
    upgradeDb,
    `delete from auth.users where id = '${C}'`
  );
}

function checkStructure() {
  expectValue(
    'RLS is enabled on all five user-owned tables',
    freshDb,
    `select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('profiles','cases','evidence','incident_reports','audit_events')
        and c.relrowsecurity`,
    '5'
  );
  expectValue(
    'exactly the reviewed owner-only policies exist',
    freshDb,
    `select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('profiles','cases','evidence','incident_reports','audit_events')`,
    '17'
  );
  expectValue(
    'audit_events has no UPDATE or DELETE policy',
    freshDb,
    `select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'audit_events'
        and cmd in ('UPDATE','DELETE')`,
    '0'
  );
  expectValue(
    'anon has no table privileges',
    freshDb,
    `select count(*) from (values ('profiles'),('cases'),('evidence'),('incident_reports'),('audit_events')) t(name)
      where has_table_privilege('anon', 'public.' || t.name, 'SELECT')
         or has_table_privilege('anon', 'public.' || t.name, 'INSERT')
         or has_table_privilege('anon', 'public.' || t.name, 'UPDATE')
         or has_table_privilege('anon', 'public.' || t.name, 'DELETE')`,
    '0'
  );
  expectValue(
    'authenticated cannot UPDATE or DELETE audit_events',
    freshDb,
    `select has_table_privilege('authenticated', 'public.audit_events', 'UPDATE')
         or has_table_privilege('authenticated', 'public.audit_events', 'DELETE')`,
    'f'
  );
  expectValue(
    'authenticated cannot TRUNCATE audit_events',
    freshDb,
    `select has_table_privilege('authenticated', 'public.audit_events', 'TRUNCATE')`,
    'f'
  );
  expectValue(
    'both ownership-safe case foreign keys exist',
    freshDb,
    `select count(*) from pg_constraint
      where conname in ('evidence_case_owner_fk', 'incident_reports_case_owner_fk')`,
    '2'
  );
  expectValue(
    'all reviewed triggers are installed',
    freshDb,
    `select count(*) from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal
        and n.nspname in ('public', 'auth')
        and t.tgname in (
          'profiles_immutable_columns', 'cases_touch_updated_at',
          'cases_immutable_columns', 'evidence_immutable_columns',
          'incident_reports_touch_updated_at', 'incident_reports_immutable_columns',
          'audit_events_validate', 'audit_events_block_mutation',
          'on_auth_user_created'
        )`,
    '9'
  );
  expectValue(
    'no password/key/file-content columns exist',
    freshDb,
    `select count(*) from information_schema.columns
      where table_schema = 'public'
        and table_name in ('profiles','cases','evidence','incident_reports','audit_events')
        and column_name in (
          'password','passphrase','secret','token','access_token','refresh_token',
          'encryption_key','vault_key','private_key','file_data','file_blob',
          'file_content','plaintext','api_key'
        )`,
    '0'
  );
}

function seedFresh() {
  expectOk(
    'auth users created and profiles auto-generated',
    freshDb,
    `insert into auth.users (id, email, raw_user_meta_data) values
       ('${A}', 'a@example.test', '{"display_name":"User A"}'),
       ('${B}', 'b@example.test', '{"display_name":"User B"}')`
  );
  expectValue(
    'signup trigger wrote the profile display name',
    freshDb,
    `select display_name from public.profiles where id = '${A}'`,
    'User A'
  );
  expectOk(
    'user A creates case A',
    freshDb,
    `insert into public.cases
       (id, title, incident_type, incident_description, incident_date, incident_platform, status)
     values ('${CASE_A}', 'Case A', 'fraud', 'case A', '2026-01-10', 'web', 'active')`,
    { role: 'authenticated', sub: A }
  );
  expectOk(
    'user B creates case B',
    freshDb,
    `insert into public.cases
       (id, title, incident_type, incident_description, incident_date, incident_platform, status)
     values ('${CASE_B}', 'Case B', 'harassment', 'case B', '2026-01-11', 'mobile', 'active')`,
    { role: 'authenticated', sub: B }
  );
  expectOk(
    'user A adds evidence A',
    freshDb,
    `insert into public.evidence
       (id, case_id, original_filename, mime_type, file_size, storage_path, sha256_hash, encryption_version)
     values ('${EV_A}', '${CASE_A}', 'a.pdf', 'application/pdf', 123,
             '${A}/${CASE_A}/a.pdf', '${HASH}', 1)`,
    { role: 'authenticated', sub: A }
  );
  expectOk(
    'user B adds evidence B',
    freshDb,
    `insert into public.evidence
       (id, case_id, original_filename, mime_type, file_size, storage_path, sha256_hash, encryption_version)
     values ('${EV_B}', '${CASE_B}', 'b.pdf', 'application/pdf', 456,
             '${B}/${CASE_B}/b.pdf', '${HASH}', 1)`,
    { role: 'authenticated', sub: B }
  );
  expectOk(
    'user A adds report A',
    freshDb,
    `insert into public.incident_reports (id, case_id, report_content, report_version)
     values ('${REP_A}', '${CASE_A}', 'draft report A', 1)`,
    { role: 'authenticated', sub: A }
  );
  expectOk(
    'user B adds report B',
    freshDb,
    `insert into public.incident_reports (id, case_id, report_content, report_version)
     values ('${REP_B}', '${CASE_B}', 'draft report B', 1)`,
    { role: 'authenticated', sub: B }
  );
  expectOk(
    'user A adds audit event A',
    freshDb,
    `insert into public.audit_events (id, case_id, evidence_id, event_type, event_metadata)
     values ('${AUDIT_A}', '${CASE_A}', '${EV_A}', 'evidence.uploaded', '{"source":"mobile"}')`,
    { role: 'authenticated', sub: A }
  );
  expectOk(
    'user B adds audit event B',
    freshDb,
    `insert into public.audit_events (id, case_id, evidence_id, event_type, event_metadata)
     values ('${AUDIT_B}', '${CASE_B}', '${EV_B}', 'evidence.uploaded', '{"source":"web"}')`,
    { role: 'authenticated', sub: B }
  );
}

function checkIsolation() {
  expectValue('A sees only their own profile', freshDb,
    `select count(*) from public.profiles`, '1', { role: 'authenticated', sub: A });
  expectValue('A profile is their own id', freshDb,
    `select id from public.profiles`, A, { role: 'authenticated', sub: A });
  expectValue('A sees only their own case', freshDb,
    `select id from public.cases`, CASE_A, { role: 'authenticated', sub: A });
  expectValue('A cannot select B case by id', freshDb,
    `select count(*) from public.cases where id = '${CASE_B}'`, '0', { role: 'authenticated', sub: A });
  expectValue('A sees only their own evidence', freshDb,
    `select id from public.evidence`, EV_A, { role: 'authenticated', sub: A });
  expectValue('A sees only their own report', freshDb,
    `select id from public.incident_reports`, REP_A, { role: 'authenticated', sub: A });
  expectValue('A sees only their own audit events', freshDb,
    `select id from public.audit_events`, AUDIT_A, { role: 'authenticated', sub: A });

  expectValue('B sees only their own case', freshDb,
    `select id from public.cases`, CASE_B, { role: 'authenticated', sub: B });
  expectValue('B sees only their own evidence', freshDb,
    `select id from public.evidence`, EV_B, { role: 'authenticated', sub: B });
  expectValue('B sees only their own report', freshDb,
    `select id from public.incident_reports`, REP_B, { role: 'authenticated', sub: B });
  expectValue('B sees only their own audit events', freshDb,
    `select id from public.audit_events`, AUDIT_B, { role: 'authenticated', sub: B });
}

function checkOwnershipWrites() {
  // Defaults and cross-user inserts.
  expectValue(
    'user_id defaults to auth.uid()',
    freshDb,
    `with inserted as (
       insert into public.cases
         (id, title, incident_type, incident_date, status)
       values ('${CASE_A2}', 'Case A2', 'fraud', '2026-02-01', 'active')
       returning user_id
     )
     select user_id from inserted`,
    A,
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot insert a case owned by another user',
    freshDb,
    `insert into public.cases (title, incident_type, incident_date, user_id)
     values ('Forged', 'fraud', '2026-02-01', '${B}')`,
    'row-level security',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot move a case to another user',
    freshDb,
    `update public.cases set user_id = '${B}' where id = '${CASE_A}'`,
    'immutable',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot backdate created_at',
    freshDb,
    `update public.cases set created_at = now() - interval '1 day' where id = '${CASE_A}'`,
    'immutable',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'cannot update another user case',
    freshDb,
    `update public.cases set title = 'hijacked' where id = '${CASE_B}' returning id`,
    '',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'cannot delete another user case',
    freshDb,
    `delete from public.cases where id = '${CASE_B}' returning id`,
    '',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'other user case still exists after attempted delete',
    freshDb,
    `select count(*) from public.cases where id = '${CASE_B}'`,
    '1'
  );

  // Evidence.
  expectOk(
    'A adds evidence to their own new case',
    freshDb,
    `insert into public.evidence
       (id, case_id, original_filename, file_size, storage_path, sha256_hash)
     values ('${EV_A2}', '${CASE_A2}', 'a2.pdf', 789,
             '${A}/${CASE_A2}/a2.pdf', '${HASH}')`,
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot attach evidence to another user case',
    freshDb,
    `insert into public.evidence
       (id, case_id, original_filename, file_size, storage_path, sha256_hash)
     values ('${'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'}', '${CASE_B}', 'x.pdf', 1,
             '${A}/${CASE_B}/x.pdf', '${HASH}')`,
    'foreign key',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot insert evidence owned by another user',
    freshDb,
    `insert into public.evidence
       (id, case_id, original_filename, file_size, storage_path, sha256_hash, user_id)
     values ('${'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'}', '${CASE_A2}', 'y.pdf', 1,
             '${A}/${CASE_A2}/y.pdf', '${HASH}', '${B}')`,
    'row-level security',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot change evidence ownership',
    freshDb,
    `update public.evidence set user_id = '${B}' where id = '${EV_A2}'`,
    'immutable',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot reparent evidence to another case',
    freshDb,
    `update public.evidence set case_id = '${CASE_B}' where id = '${EV_A2}'`,
    'immutable',
    { role: 'authenticated', sub: A }
  );
  expectOk(
    'can update non-identity evidence metadata',
    freshDb,
    `update public.evidence set original_filename = 'renamed.pdf' where id = '${EV_A2}'`,
    { role: 'authenticated', sub: A }
  );

  // Reports.
  expectOk(
    'A adds a report to their own new case',
    freshDb,
    `insert into public.incident_reports (id, case_id, report_content, report_version)
     values ('${REP_A2}', '${CASE_A2}', 'draft report A2', 1)`,
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot attach a report to another user case',
    freshDb,
    // report_version 2 avoids colliding with B's version 1, so the
    // ownership-safe (case_id, user_id) foreign key is what rejects it.
    `insert into public.incident_reports (case_id, report_content, report_version)
     values ('${CASE_B}', 'forged', 2)`,
    'foreign key',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot change report ownership',
    freshDb,
    `update public.incident_reports set user_id = '${B}' where id = '${REP_A2}'`,
    'immutable',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'duplicate report version is rejected',
    freshDb,
    `insert into public.incident_reports (case_id, report_content, report_version)
     values ('${CASE_A2}', 'duplicate', 1)`,
    'duplicate key|unique',
    { role: 'authenticated', sub: A }
  );

  // Profiles.
  expectOk(
    'user can update their own display name',
    freshDb,
    `update public.profiles set display_name = 'User A Updated' where id = '${A}'`,
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'cannot update another user profile',
    freshDb,
    `update public.profiles set display_name = 'hijacked' where id = '${B}' returning id`,
    '',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'cannot change a profile id',
    freshDb,
    `update public.profiles set id = '${B}' where id = '${A}'`,
    'immutable|row-level security',
    { role: 'authenticated', sub: A }
  );
}

function checkStorageBackupPolicies() {
  expectValue(
    'evidence-backups bucket exists and is private',
    freshDb,
    `select public from storage.buckets where id = 'evidence-backups'`,
    'f'
  );
  expectValue(
    'evidence-backups bucket enforces a 100 MiB ciphertext limit',
    freshDb,
    `select file_size_limit from storage.buckets where id = 'evidence-backups'`,
    '104857600'
  );
  expectValue(
    'evidence-backups bucket only allows octet-stream',
    freshDb,
    `select allowed_mime_types::text from storage.buckets where id = 'evidence-backups'`,
    '{application/octet-stream}'
  );
  expectValue(
    'four storage policies target the backup bucket',
    freshDb,
    `select count(*) from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname in (
          'evidence_backup_select_own', 'evidence_backup_insert_own',
          'evidence_backup_update_own', 'evidence_backup_delete_own'
        )`,
    '4'
  );
  expectValue(
    'evidence backup status defaults to not_backed_up',
    freshDb,
    `select backup_status from public.evidence where id = '${EV_A2}'`,
    'not_backed_up'
  );
  expectValue(
    'evidence backup metadata columns exist',
    freshDb,
    `select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'evidence'
        and column_name in (
          'backup_status', 'backup_last_success_at', 'backup_error',
          'backup_bytes', 'backup_ciphertext_sha256'
        )`,
    '5'
  );

  // A second bucket proves the policies are scoped to evidence-backups.
  expectOk(
    'test-only decoy bucket created',
    freshDb,
    `insert into storage.buckets (id, name, public)
     values ('decoy-bucket', 'decoy-bucket', false)`
  );

  // Seed B's object as the server so A has something to try to read.
  expectOk(
    'user B object seeded',
    freshDb,
    `insert into storage.objects (bucket_id, name, owner)
     values ('evidence-backups', '${B}/${CASE_B}/${EV_B}.evb', '${B}')`
  );

  expectOk(
    'A uploads their own encrypted envelope',
    freshDb,
    `insert into storage.objects (bucket_id, name, owner)
     values ('evidence-backups', '${A}/${CASE_A2}/${EV_A2}.evb', '${A}')`,
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'A sees only their own storage object',
    freshDb,
    `select count(*) from storage.objects where bucket_id = 'evidence-backups'`,
    '1',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'A cannot select B storage object by name',
    freshDb,
    `select count(*) from storage.objects
      where name = '${B}/${CASE_B}/${EV_B}.evb'`,
    '0',
    { role: 'authenticated', sub: A }
  );

  expectFail(
    'A cannot upload under another user id',
    freshDb,
    `insert into storage.objects (bucket_id, name, owner)
     values ('evidence-backups', '${B}/${CASE_B}/forged.evb', '${A}')`,
    'row-level security',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'A cannot upload under another user case',
    freshDb,
    `insert into storage.objects (bucket_id, name, owner)
     values ('evidence-backups', '${A}/${CASE_B}/forged.evb', '${A}')`,
    'row-level security',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'A cannot upload a plaintext-looking filename',
    freshDb,
    `insert into storage.objects (bucket_id, name, owner)
     values ('evidence-backups', '${A}/${CASE_A2}/plain.pdf', '${A}')`,
    'row-level security',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'A cannot upload into the decoy bucket',
    freshDb,
    `insert into storage.objects (bucket_id, name, owner)
     values ('decoy-bucket', '${A}/${CASE_A2}/${EV_A2}.evb', '${A}')`,
    'row-level security',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'A cannot move their object under another case',
    freshDb,
    `update storage.objects
        set name = '${A}/${CASE_B}/moved.evb'
      where name = '${A}/${CASE_A2}/${EV_A2}.evb'`,
    'row-level security',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'A cannot update B object',
    freshDb,
    `update storage.objects
        set metadata = '{"tampered":true}'::jsonb
      where name = '${B}/${CASE_B}/${EV_B}.evb'
      returning id`,
    '',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'A cannot delete B object',
    freshDb,
    `delete from storage.objects
      where name = '${B}/${CASE_B}/${EV_B}.evb'
      returning id`,
    '',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'B object survived A delete attempt',
    freshDb,
    `select count(*) from storage.objects
      where name = '${B}/${CASE_B}/${EV_B}.evb'`,
    '1'
  );
  expectOk(
    'A can update their own object metadata',
    freshDb,
    `update storage.objects
        set metadata = '{"verified":true}'::jsonb
      where name = '${A}/${CASE_A2}/${EV_A2}.evb'`,
    { role: 'authenticated', sub: A }
  );
  expectOk(
    'A can delete their own object',
    freshDb,
    `delete from storage.objects
      where name = '${A}/${CASE_A2}/${EV_A2}.evb'`,
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'anon sees no storage objects',
    freshDb,
    `select count(*) from storage.objects`,
    '0',
    { role: 'anon' }
  );
  expectFail(
    'anon cannot insert storage objects',
    freshDb,
    `insert into storage.objects (bucket_id, name)
     values ('evidence-backups', '${A}/${CASE_A2}/anon.evb')`,
    'row-level security',
    { role: 'anon' }
  );

  expectFail(
    'invalid backup status is rejected',
    freshDb,
    `insert into public.evidence
       (case_id, original_filename, file_size, storage_path, sha256_hash, backup_status)
     values ('${CASE_A2}', 'bad-status.evb', 1,
             '${A}/${CASE_A2}/bad-status.evb', '${HASH}', 'bogus')`,
    'evidence_backup_status_valid|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'encrypted backup hash must be lowercase sha256',
    freshDb,
    `update public.evidence
        set backup_ciphertext_sha256 = '${'A'.repeat(64)}'
      where id = '${EV_A2}'`,
    'evidence_backup_ciphertext_sha256_format|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'encrypted backup size cannot be negative',
    freshDb,
    `update public.evidence set backup_bytes = -1 where id = '${EV_A2}'`,
    'evidence_backup_bytes_nonneg|check constraint',
    { role: 'authenticated', sub: A }
  );
}

function checkAudit() {
  expectOk(
    'A appends an audit event for their own case and evidence',
    freshDb,
    `insert into public.audit_events (id, case_id, evidence_id, event_type, event_metadata)
     values ('${AUDIT_A2}', '${CASE_A2}', '${EV_A2}', 'report.generated', '{"format":"pdf"}')`,
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'audit event cannot reference another user case',
    freshDb,
    `insert into public.audit_events (case_id, event_type)
     values ('${CASE_B}', 'forged.event')`,
    'not owned',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'audit event cannot reference another user evidence',
    freshDb,
    `insert into public.audit_events (evidence_id, event_type)
     values ('${EV_B}', 'forged.event')`,
    'not owned',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'audit event cannot be assigned to another user',
    freshDb,
    `insert into public.audit_events (event_type, user_id)
     values ('forged.event', '${B}')`,
    'row-level security',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'audit events cannot be updated by an API user',
    freshDb,
    `update public.audit_events set event_type = 'tampered' where id = '${AUDIT_A2}'`,
    'permission denied|append-only',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'audit events cannot be deleted by an API user',
    freshDb,
    `delete from public.audit_events where id = '${AUDIT_A2}'`,
    'permission denied|append-only',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'audit metadata rejects password-like keys',
    freshDb,
    `insert into public.audit_events (event_type, event_metadata)
     values ('forged.event', '{"password":"hunter2"}')`,
    'audit_events_metadata_safe|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'audit metadata is capped at 2 KB',
    freshDb,
    `insert into public.audit_events (event_type, event_metadata)
     values ('forged.event', jsonb_build_object('note', repeat('x', 3000)))`,
    'audit_events_metadata_safe|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectOk(
    'client-supplied audit timestamps are accepted but overwritten',
    freshDb,
    `insert into public.audit_events (id, event_type, created_at)
     values ('${AUDIT_OLD}', 'test.timestamp', '2000-01-01T00:00:00Z')`,
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'audit timestamp is server-side, not backdated',
    freshDb,
    `select extract(year from created_at) >= 2026 from public.audit_events where id = '${AUDIT_OLD}'`,
    't',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'A sees exactly their own audit rows',
    freshDb,
    `select count(*) from public.audit_events`,
    '3',
    { role: 'authenticated', sub: A }
  );
}

function checkConstraints() {
  expectFail(
    'case status must be a known value',
    freshDb,
    `insert into public.cases (title, incident_type, incident_date, status)
     values ('Bad', 'fraud', '2026-01-01', 'bogus')`,
    'cases_status_valid|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'sha256 must be 64 lowercase hex characters',
    freshDb,
    `insert into public.evidence
       (case_id, original_filename, file_size, storage_path, sha256_hash)
     values ('${CASE_A2}', 'bad.pdf', 1, '${A}/${CASE_A2}/bad.pdf', '${'A'.repeat(64)}')`,
    'evidence_sha256_format|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'file size cannot be negative',
    freshDb,
    `insert into public.evidence
       (case_id, original_filename, file_size, storage_path, sha256_hash)
     values ('${CASE_A2}', 'neg.pdf', -1, '${A}/${CASE_A2}/neg.pdf', '${HASH}')`,
    'evidence_file_size_nonneg|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'storage path cannot traverse directories',
    freshDb,
    `insert into public.evidence
       (case_id, original_filename, file_size, storage_path, sha256_hash)
     values ('${CASE_A2}', 'trav.pdf', 1, '../escape.pdf', '${HASH}')`,
    'evidence_storage_path_relative|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectFail(
    'audit event type cannot be empty',
    freshDb,
    `insert into public.audit_events (event_type) values ('   ')`,
    'audit_events_type_len|check constraint',
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'updated_at advances on update',
    freshDb,
    `with updated as (
       update public.cases set title = 'Case A2 renamed' where id = '${CASE_A2}'
       returning updated_at, created_at
     )
     select updated_at > created_at from updated`,
    't',
    { role: 'authenticated', sub: A }
  );
}

function checkAnonAndCascade() {
  expectFail(
    'anon cannot read cases',
    freshDb,
    `select count(*) from public.cases`,
    'permission denied',
    { role: 'anon' }
  );
  expectFail(
    'anon cannot insert cases',
    freshDb,
    `insert into public.cases (title, incident_type, incident_date)
     values ('anon', 'fraud', '2026-01-01')`,
    'permission denied',
    { role: 'anon' }
  );
  expectFail(
    'anon cannot read audit events',
    freshDb,
    `select count(*) from public.audit_events`,
    'permission denied',
    { role: 'anon' }
  );

  // Deleting a case cascades to evidence/reports, but audit history survives.
  expectValue(
    'A deletes their own case',
    freshDb,
    `delete from public.cases where id = '${CASE_A}' returning id`,
    CASE_A,
    { role: 'authenticated', sub: A }
  );
  expectValue(
    'case delete cascaded to evidence',
    freshDb,
    `select count(*) from public.evidence where case_id = '${CASE_A}'`,
    '0'
  );
  expectValue(
    'case delete cascaded to reports',
    freshDb,
    `select count(*) from public.incident_reports where case_id = '${CASE_A}'`,
    '0'
  );
  expectValue(
    'audit event survives case deletion',
    freshDb,
    `select count(*) from public.audit_events where id = '${AUDIT_A}'`,
    '1'
  );
  expectValue(
    'audit event keeps the deleted case reference',
    freshDb,
    `select case_id from public.audit_events where id = '${AUDIT_A}'`,
    CASE_A
  );
  expectValue(
    'remaining own evidence is unaffected',
    freshDb,
    `select count(*) from public.evidence`,
    '1',
    { role: 'authenticated', sub: A }
  );

  // Server-side account deletion must still be able to remove audit rows.
  expectOk(
    'server-side user deletion succeeds',
    freshDb,
    `delete from auth.users where id = '${B}'`
  );
  expectValue(
    'user deletion cascaded to cases',
    freshDb,
    `select count(*) from public.cases where user_id = '${B}'`,
    '0'
  );
  expectValue(
    'user deletion cascaded to evidence',
    freshDb,
    `select count(*) from public.evidence where user_id = '${B}'`,
    '0'
  );
  expectValue(
    'user deletion cascaded to reports',
    freshDb,
    `select count(*) from public.incident_reports where user_id = '${B}'`,
    '0'
  );
  expectValue(
    'user deletion cascaded to audit events',
    freshDb,
    `select count(*) from public.audit_events where user_id = '${B}'`,
    '0'
  );
  expectValue(
    'user deletion cascaded to the profile',
    freshDb,
    `select count(*) from public.profiles where id = '${B}'`,
    '0'
  );
  expectValue(
    'user A audit history is still intact',
    freshDb,
    `select count(*) from public.audit_events where user_id = '${A}'`,
    '3'
  );
}

function main() {
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${migrationsDir}`);
  }

  console.log(`Starting ${image} ...`);
  const started = docker([
    'run', '--rm', '-d',
    '--name', container,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_DB=postgres',
    image,
  ]);
  if (started.status !== 0) {
    throw new Error(`Could not start Docker container:\n${started.stderr}`);
  }
  if (!waitForDatabase()) {
    throw new Error('PostgreSQL did not become ready in time');
  }

  const prepared = ensureDatabases();
  record(prepared.ok, 'test databases created', prepared.detail);

  applyFile(freshDb, join(here, '00_supabase_stubs.sql'));
  applyFile(upgradeDb, join(here, '00_supabase_stubs.sql'));

  console.log('\nUpgrade scenario: seeding the old draft schema');
  applyFile(upgradeDb, join(fixturesDir, 'legacy_draft.sql'));
  expectOk(
    'legacy draft rows seeded',
    upgradeDb,
    `insert into auth.users (id, email, raw_user_meta_data)
       values ('${A}', 'a@example.test', '{"display_name":"Legacy User A"}');
     insert into public.cases
       (id, user_id, title, category, description, incident_date, platform, status, created_at, updated_at)
     values ('legacy-case-1', '${A}', 'Legacy case', 'fraud', 'legacy', '2026-01-01', 'web',
             'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
     insert into public.evidence
       (id, user_id, case_id, filename, original_filename, file_path, file_size, file_type, sha256_hash, created_at)
     values ('legacy-evidence-1', '${A}', 'legacy-case-1', 'a.pdf', 'a.pdf', '/local/a.pdf', 10,
             'pdf', '${HASH}', '2026-01-01T00:00:00Z');`
  );

  console.log('\nApplying migrations');
  for (const file of migrations) {
    applyFile(freshDb, join(migrationsDir, file));
    applyFile(upgradeDb, join(migrationsDir, file));
    console.log(`  applied ${file}`);
  }

  console.log('\nUpgrade from draft schema');
  checkUpgrade();

  console.log('\nFresh schema: structure and privileges');
  checkStructure();

  console.log('\nFresh schema: seeding user data');
  seedFresh();

  console.log('\nFresh schema: cross-user isolation');
  checkIsolation();

  console.log('\nFresh schema: ownership writes');
  checkOwnershipWrites();

  console.log('\nFresh schema: audit events');
  checkAudit();

  console.log('\nFresh schema: encrypted backup bucket and storage RLS');
  checkStorageBackupPolicies();

  console.log('\nFresh schema: constraints and timestamps');
  checkConstraints();

  console.log('\nFresh schema: anonymous access and cascades');
  checkAnonAndCascade();
}

try {
  main();
} catch (error) {
  failed += 1;
  console.error(`\nFATAL: ${error.message}`);
} finally {
  docker(['rm', '-f', container]);
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
