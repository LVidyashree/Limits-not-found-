import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { isSupabaseConfigured } from '../services/supabase';
import { authService } from '../services/authService';
import type {
  AuthSessionSummary,
  AuthUserSummary,
  SignUpResult,
} from '../services/authServiceCore';
import { lockVault } from '../services/security';

interface AuthContextValue {
  session: AuthSessionSummary | null;
  user: AuthUserSummary | null;
  initializing: boolean;
  configError: string | null;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  completeRecovery: (
    email: string,
    input: string,
    newPassword: string
  ) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<AuthSessionSummary | null>(null);
  const [initializing, setInitializing] = useState(isSupabaseConfigured);
  const [configError] = useState<string | null>(
    isSupabaseConfigured
      ? null
      : 'Supabase Auth is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart Expo.'
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    let active = true;

    // Subscribe first so no auth event is missed, then restore the
    // persisted session from SecureStore.
    const { unsubscribe } = authService.onAuthStateChange((nextSession) => {
      if (active) setSession(nextSession);
    });

    const restore = async () => {
      try {
        const restored = await authService.getSession();
        if (active) setSession(restored);
      } catch (err) {
        console.warn('Could not restore Supabase session:', err);
      } finally {
        if (active) setInitializing(false);
      }
    };

    restore();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const result = await authService.signUp(email, password);
    if (result.session) setSession(result.session);
    return result;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authService.signIn(email, password);
    setSession(result.session);
  }, []);

  const signOut = useCallback(async () => {
    await authService.signOut();
    setSession(null);
    try {
      // Lock the local vault but never delete local evidence or the local
      // vault passphrase when signing out of the cloud account.
      await lockVault();
    } catch (err) {
      console.warn('Vault lock after sign out failed:', err);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await authService.requestPasswordReset(email);
  }, []);

  const completeRecovery = useCallback(
    async (email: string, input: string, newPassword: string) => {
      await authService.completeRecovery(email, input, newPassword);
      // completeRecovery clears the short-lived recovery session.
      setSession(null);
    },
    []
  );

  const updatePassword = useCallback(async (newPassword: string) => {
    await authService.updatePassword(newPassword);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      configError,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      completeRecovery,
      updatePassword,
    }),
    [
      session,
      initializing,
      configError,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      completeRecovery,
      updatePassword,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
};
