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

## 4. Automated checks

```bash
npm test        # 14 fake-backend tests: registration, login, logout, restore, recovery, routes
npx tsc --noEmit
npx eslint App.tsx src/context src/navigation src/services/authService*.ts \
  src/services/chunkedStorage.ts src/services/supabase.ts \
  src/screens/WelcomeVaultScreen.tsx src/screens/TrustCentreScreen.tsx tests
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
