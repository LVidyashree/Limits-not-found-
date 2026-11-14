# Supabase Auth Setup & Manual Test Guide

Account authentication is an additional gate. The local vault passphrase is still required
after sign-in, and evidence, the SQLite database, and the vault passphrase never leave the
device.

## 1. Environment

`.env.local` (already present, git-ignored) must contain:

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

Restart Expo after changing these. The anon key is public by design — Row Level Security is
what protects data. Never put a `service_role` key in the app.

## 2. Supabase dashboard settings

- **Authentication → Providers → Email**: enabled.
- **Authentication → Sign In / Providers → Email**: if “Confirm email” is on (currently on),
  new accounts must confirm before signing in. The app shows “Check your email…” after
  registration.
- **Authentication → Emails → Reset Password**: include `{{ .Token }}` in the template so the
  user can paste the 6-digit code instead of relying on a deep link:

  ```html
  <p>Your recovery code is: <strong>{{ .Token }}</strong></p>
  <p>Or use this link: <a href="{{ .ConfirmationURL }}">Reset password</a></p>
  ```

  The app accepts either the code, the full recovery link, or a link containing
  `access_token`/`refresh_token`.
- Optional: add your app scheme to **Authentication → URL Configuration → Redirect URLs** if
  you later add deep links. Not required for the paste-the-code flow.

## 3. Database

Apply the versioned migrations in order (SQL editor, one file at a time), or with a direct
database connection:

```bash
DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
  node supabase/tests/apply-migrations.mjs
```

The files in `supabase/migrations/` are the single source of truth. The old
`supabase_schema.sql` and `supabase_rls_policies.sql` are deprecated stubs — do not run them.
See `supabase/README.md` for the schema and policy reference, and
`node supabase/tests/run-rls-tests.mjs` to verify the policies on a disposable PostgreSQL.

Migration 5 also creates the **private** `evidence-backups` Storage bucket. If your project
already has a bucket with that name, the migration forces it back to private, restricts it to
`application/octet-stream`, and caps objects at 100 MiB. No service-role key is needed in the
app; Storage RLS scopes each object to `<user id>/<case id>/<evidence id>.evb`.

## 4. Automated checks

```bash
npm test        # 38 tests: auth fake backend + backup crypto core + case mapping/validation
npx tsc --noEmit
npx eslint App.tsx src/context src/navigation src/services/authService*.ts \
  src/services/caseService*.ts src/services/database.ts src/services/chunkedStorage.ts \
  src/services/supabase.ts src/screens/WelcomeVaultScreen.tsx src/screens/TrustCentreScreen.tsx \
  src/screens/DashboardScreen.tsx src/screens/CaseListScreen.tsx \
  src/screens/CaseDetailScreen.tsx src/screens/CreateIncidentScreen.tsx tests
npx expo export --platform ios --platform android --output-dir /tmp/ev-export
```

## 5. Manual device checklist

1. **Unauthenticated start** — app opens on the welcome screen; no screen besides
   `WelcomeVault` is registered, so deep links/navigation to Dashboard fail.
2. **Registration** — Create Account → valid email + password (≥ 8 chars, different from the
   vault passphrase). Expect “Account created. Check your email…”.
3. **Email confirmation** — open the email, confirm, return to the app.
4. **Login** — sign in. Expect the local vault card to appear with the account email and
   VERIFIED badge. Wrong password shows “Incorrect email or password.”
5. **Vault separation** — unlock/create the vault with a passphrase that differs from the
   account password. Restarting the app keeps the session but still asks for the vault
   passphrase.
6. **Session persistence** — force-quit and reopen: the account session restores from
   SecureStore (no re-login) while the vault stays locked.
7. **Logout** — Sign Out from the welcome screen or Trust Centre. Expect return to the
   welcome screen; local evidence remains; sign-in is required again.
8. **Protected routes** — after logout, the app cannot reach Dashboard/Trust Centre.
9. **Password reset** — Forgot password → enter email → paste code or full link → set a new
   password → sign in with it. The vault passphrase is unchanged.
10. **Offline behavior** — with no network, sign-in shows a network error; an already
    authenticated session restored from storage still opens the vault (account tokens refresh
    when connectivity returns).
11. **Encrypted backup** — sign in, open an evidence item, tap **Back Up Now**, enter the vault
    passphrase. Expect a success alert only after the app confirms the Storage object and the
    `evidence` metadata update. The item shows `BACKED UP` and a last-success timestamp.
12. **Cross-user isolation** — with a second account, confirm the first account's backups are
    not listed and that a direct Storage read/download of the first user's path fails.
13. **Restore** — use Trust Centre → **Encrypted Cloud Backup** → **Restore**, or the evidence
    item's **Restore From Cloud**. Expect both SHA-256 checks to pass and the decrypted file to
    open locally. A wrong passphrase must fail without writing a file.
14. **Auto-backup consent** — auto-backup is off by default. Enabling it requires the explicit
    consent dialog and records a timestamp. With it enabled but no derived key cached, adding
    evidence must not prompt for a passphrase or upload anything.
15. **Create a cloud case** — Report Incident → fill title, category, date and platform → save.
    Expect “Case Saved” only after Supabase confirms the row. Check Table Editor → `cases` for a
    row owned by the signed-in user with the same title/date/platform.
16. **Persistence across restart** — force-quit the app, reopen, sign in if needed, unlock the
    vault. The saved case appears on the dashboard and in My Incidents.
17. **Edit and status** — open the case → Edit Case Details → change the title/description →
    save. The list refreshes on focus and the cloud row reflects the edit. Change status to
    Closed/Archived and confirm the badge and cloud `status` both update.
18. **Delete** — delete the case and confirm the dialog. The cloud row is removed first; the
    local row disappears only after Supabase accepts the delete. Pull-to-refresh must not bring
    the case back.
19. **No duplicate imports** — pull-to-refresh twice and reopen the app. Each cloud case appears
    exactly once locally (matched by `cloud_case_id`), and local-only edits are not overwritten.
20. **Offline case editing** — create/edit a case with the network disabled. The local save
    succeeds with a “Saved Locally” warning; the list still shows the case. When connectivity
    returns, the next explicit save/update mirrors it to the account.
