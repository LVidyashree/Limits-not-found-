// Framework-agnostic Supabase Auth logic.
//
// This module deliberately has no React Native or Supabase imports so it
// can be unit-tested in Node with a fake auth backend. The real client is
// injected from `authService.ts`.

export interface AuthUserSummary {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
}

export interface AuthSessionSummary {
  user: AuthUserSummary;
  expiresAt: number | null;
}

export interface SignUpResult {
  session: AuthSessionSummary | null;
  needsEmailConfirmation: boolean;
}

export interface SignInResult {
  session: AuthSessionSummary;
}

export interface RawAuthUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}

export interface RawAuthSession {
  user: RawAuthUser;
  expires_at?: number | null;
}

export interface RawAuthError {
  message: string;
  status?: number;
  code?: string;
}

export interface AuthResponseLike {
  data: {
    user?: RawAuthUser | null;
    session?: RawAuthSession | null;
  };
  error: RawAuthError | null;
}

export interface RecoveryOtpParams {
  email?: string;
  token?: string;
  token_hash?: string;
  type: 'recovery';
}

export interface SupabaseAuthLike {
  signUp(credentials: { email: string; password: string }): Promise<AuthResponseLike>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<AuthResponseLike>;
  signOut(options?: {
    scope?: 'global' | 'local' | 'others';
  }): Promise<{ error: RawAuthError | null }>;
  getSession(): Promise<{
    data: { session: RawAuthSession | null };
    error: RawAuthError | null;
  }>;
  resetPasswordForEmail(
    email: string,
    options?: { redirectTo?: string }
  ): Promise<{ data: unknown; error: RawAuthError | null }>;
  verifyOtp(params: RecoveryOtpParams): Promise<AuthResponseLike>;
  updateUser(attributes: {
    password: string;
  }): Promise<{ data: unknown; error: RawAuthError | null }>;
  setSession(tokens: {
    access_token: string;
    refresh_token: string;
  }): Promise<AuthResponseLike>;
  onAuthStateChange(
    callback: (event: string, session: RawAuthSession | null) => void
  ): { data: { subscription: { unsubscribe: () => void } } };
}

export class AuthServiceError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, raw?: RawAuthError) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = raw?.code;
    this.status = raw?.status;
  }
}

export const toSessionSummary = (
  session: RawAuthSession | null | undefined
): AuthSessionSummary | null => {
  if (!session?.user?.id) return null;

  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
      emailConfirmed: Boolean(
        session.user.email_confirmed_at || session.user.confirmed_at
      ),
    },
    expiresAt: session.expires_at ?? null,
  };
};

const FRIENDLY_ERRORS: { test: RegExp; message: string }[] = [
  {
    test: /invalid login credentials/i,
    message: 'Incorrect email or password. Please try again.',
  },
  {
    test: /email not confirmed/i,
    message:
      'Please confirm your email address before signing in. Check your inbox for the confirmation link.',
  },
  {
    test: /user already registered|already been registered/i,
    message: 'An account with this email already exists. Sign in instead.',
  },
  {
    test: /password should be at least|signup requires a valid password|weak password/i,
    message: 'Please use a stronger password (at least 8 characters).',
  },
  {
    test: /invalid format|unable to validate email|invalid email/i,
    message: 'Please enter a valid email address.',
  },
  {
    test: /rate limit|too many requests|email rate limit/i,
    message: 'Too many attempts. Please wait a moment and try again.',
  },
  {
    test: /security purposes.*after/i,
    message: 'Please wait before requesting another email.',
  },
  {
    test: /new password should be different/i,
    message: 'Choose a new password that is different from your previous one.',
  },
  {
    test: /auth session missing|session.*expired|jwt expired|refresh token.*not found/i,
    message: 'Your session has expired. Please sign in again.',
  },
  {
    test: /failed to fetch|network request failed|networkerror|network error/i,
    message: 'Network error. Check your internet connection and try again.',
  },
  {
    test: /token has expired|invalid.*token|otp.*expired|invalid otp/i,
    message: 'That recovery code is invalid or has expired. Request a new email.',
  },
  {
    test: /signups not allowed|signup.*disabled|email signups? (are|is) disabled/i,
    message:
      'New account registration is currently disabled. Contact the app administrator.',
  },
];

export const getAuthErrorMessage = (error: unknown): string => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Something went wrong. Please try again.';

  for (const { test, message } of FRIENDLY_ERRORS) {
    if (test.test(rawMessage)) return message;
  }
  return rawMessage;
};

export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export interface ParsedRecoveryInput {
  token?: string;
  tokenHash?: string;
  accessToken?: string;
  refreshToken?: string;
}

const getParam = (source: string, key: string): string | undefined => {
  const match = new RegExp(`[?&#]${key}=([^&#]+)`).exec(source);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

/**
 * Accepts either:
 *  - a 6-10 digit recovery OTP
 *  - a raw token_hash
 *  - a Supabase recovery URL containing token_hash / token
 *  - an implicit-flow redirect URL containing access_token + refresh_token
 */
export const parseRecoveryInput = (raw: string): ParsedRecoveryInput => {
  const value = raw.trim();
  if (!value) return {};

  if (/^\d{6,10}$/.test(value)) return { token: value };

  const tokenHashParam = getParam(value, 'token_hash');
  const tokenParam = getParam(value, 'token');
  const accessToken = getParam(value, 'access_token');
  const refreshToken = getParam(value, 'refresh_token');

  let token: string | undefined;
  let tokenHash: string | undefined = tokenHashParam;

  if (tokenParam) {
    if (/^\d{6,10}$/.test(tokenParam)) {
      token = tokenParam;
    } else if (!tokenHash) {
      tokenHash = tokenParam;
    }
  }

  if (token || tokenHash || accessToken || refreshToken) {
    return { token, tokenHash, accessToken, refreshToken };
  }

  if (/^[A-Za-z0-9_-]{16,}$/.test(value)) {
    return { tokenHash: value };
  }

  return {};
};

export const createAuthService = (auth: SupabaseAuthLike) => {
  const unwrap = <T extends { error: RawAuthError | null }>(result: T): T => {
    if (result.error) {
      throw new AuthServiceError(result.error.message, result.error);
    }
    return result;
  };

  const signUp = async (email: string, password: string): Promise<SignUpResult> => {
    const result = unwrap(await auth.signUp({ email: email.trim(), password }));
    const session = toSessionSummary(result.data.session);

    return {
      session,
      needsEmailConfirmation: !session && Boolean(result.data.user),
    };
  };

  const signIn = async (email: string, password: string): Promise<SignInResult> => {
    const result = unwrap(
      await auth.signInWithPassword({ email: email.trim(), password })
    );
    const session = toSessionSummary(result.data.session);

    if (!session) {
      throw new AuthServiceError('Sign in succeeded but no session was returned.');
    }
    return { session };
  };

  const signOut = async (): Promise<void> => {
    const result = await auth.signOut();

    if (result.error) {
      // Always clear the local session, even if the server call failed.
      const localResult = await auth.signOut({ scope: 'local' });
      if (localResult.error) {
        throw new AuthServiceError(localResult.error.message, localResult.error);
      }
    }
  };

  const getSession = async (): Promise<AuthSessionSummary | null> => {
    const result = await auth.getSession();
    if (result.error) return null;
    return toSessionSummary(result.data.session);
  };

  const requestPasswordReset = async (email: string): Promise<void> => {
    unwrap(await auth.resetPasswordForEmail(email.trim()));
  };

  const verifyRecovery = async (
    email: string,
    input: string
  ): Promise<AuthSessionSummary> => {
    const parsed = parseRecoveryInput(input);
    let result: AuthResponseLike;

    if (parsed.accessToken && parsed.refreshToken) {
      result = unwrap(
        await auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        })
      );
    } else if (parsed.tokenHash) {
      result = unwrap(
        await auth.verifyOtp({ token_hash: parsed.tokenHash, type: 'recovery' })
      );
    } else if (parsed.token) {
      result = unwrap(
        await auth.verifyOtp({
          email: email.trim(),
          token: parsed.token,
          type: 'recovery',
        })
      );
    } else {
      throw new AuthServiceError(
        'Enter the recovery code from the email, or paste the full recovery link.'
      );
    }

    const session = toSessionSummary(result.data.session);
    if (!session) {
      throw new AuthServiceError(
        'Recovery succeeded but no session was returned. Please request a new email.'
      );
    }
    return session;
  };

  const completeRecovery = async (
    email: string,
    input: string,
    newPassword: string
  ): Promise<void> => {
    await verifyRecovery(email, input);
    unwrap(await auth.updateUser({ password: newPassword }));

    // Clear the short-lived recovery session so the user signs in with the
    // new password. This also removes the session from SecureStore.
    const localResult = await auth.signOut({ scope: 'local' });
    if (localResult.error) {
      throw new AuthServiceError(localResult.error.message, localResult.error);
    }
  };

  const updatePassword = async (newPassword: string): Promise<void> => {
    unwrap(await auth.updateUser({ password: newPassword }));
  };

  const onAuthStateChange = (
    callback: (session: AuthSessionSummary | null, event: string) => void
  ): { unsubscribe: () => void } => {
    const { data } = auth.onAuthStateChange((event, session) => {
      callback(toSessionSummary(session), event);
    });
    return { unsubscribe: () => data.subscription.unsubscribe() };
  };

  return {
    signUp,
    signIn,
    signOut,
    getSession,
    requestPasswordReset,
    verifyRecovery,
    completeRecovery,
    updatePassword,
    onAuthStateChange,
  };
};

export type AuthService = ReturnType<typeof createAuthService>;
