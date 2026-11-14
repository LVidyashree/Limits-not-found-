#!/usr/bin/env node
// ============================================================
// Apply EvidenceVault migrations to a real PostgreSQL database.
//
//   DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
//     node supabase/tests/apply-migrations.mjs
//
// Requires `psql` (PostgreSQL client). Applies every file in
// supabase/migrations/ in filename order with ON_ERROR_STOP=1, so a
// failure aborts immediately.
//
// This is a convenience wrapper. In production prefer the Supabase
// CLI (`supabase db push`) or the SQL editor. Never commit the
// database URL.
// ============================================================

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Example:');
  console.error(
    "  DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \\\n" +
      '    node supabase/tests/apply-migrations.mjs'
  );
  process.exit(1);
}

const check = spawnSync('psql', ['--version'], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('psql was not found on PATH. Install the PostgreSQL client first.');
  process.exit(1);
}

const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (migrations.length === 0) {
  console.error(`No migrations found in ${migrationsDir}`);
  process.exit(1);
}

console.log(`Applying ${migrations.length} migration(s) to the configured database.\n`);

for (const file of migrations) {
  process.stdout.write(`  ${file} ... `);
  const result = spawnSync(
    'psql',
    [databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(migrationsDir, file)],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    console.log('FAILED');
    if (result.stdout.trim()) console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
  console.log('ok');
}

console.log('\nAll migrations applied.');
