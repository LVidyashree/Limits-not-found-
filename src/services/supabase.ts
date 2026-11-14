import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { createChunkedStorage } from './chunkedStorage';

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/**
 * True when both public Supabase values are present. The anon key is
 * public by design; access is enforced by Row Level Security. We never
 * put a service-role key in the app.
 */
export const isSupabaseConfigured =
  supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

// expo-secure-store has a ~2 KB value limit, so the Supabase session is
// chunked before being written to hardware-backed storage.
const secureStorage = createChunkedStorage({
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
});

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: secureStorage,
      storageKey: 'evidencevault-auth',
      persistSession: true,
      autoRefreshToken: true,
      // React Native has no browser URL to inspect. Recovery is handled
      // in-app via verifyOtp (code or pasted link).
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
  }
);
