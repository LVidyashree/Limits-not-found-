import { supabase } from './supabase';
import {
  createAuthService,
  SupabaseAuthLike,
} from './authServiceCore';

/**
 * Real Supabase Auth service. Types are narrowed to the small surface the
 * app uses so the same logic can be exercised with a fake backend in tests.
 */
export const authService = createAuthService(
  supabase.auth as unknown as SupabaseAuthLike
);
