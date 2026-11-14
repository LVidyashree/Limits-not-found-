import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import { logActivity } from './database';
import { clearAutoBackupPreferences } from './backupPreferences';

const KEY_VAULT_INIT = 'ev_vault_initialized';
const KEY_SALT = 'ev_vault_salt';
const KEY_HASH = 'ev_vault_passphrase_hash';
const KEY_BIOMETRICS = 'ev_vault_biometrics_enabled';
const KEY_BACKUP_KDF_SALT = 'ev_backup_kdf_salt';

let isVaultSessionUnlocked = false;

/**
 * The Argon2id-derived backup key is held only in memory. It is never
 * persisted and is wiped on lock, sign-out, vault reset or passphrase change.
 * The salt is public and stored separately; the passphrase itself is never
 * cached.
 */
let cachedBackupKeys = new Map<string, Uint8Array>();
const MAX_CACHED_BACKUP_KEYS = 4;
let backupSaltRequest: Promise<string> | null = null;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const isValidKdfSaltHex = (value: string): boolean =>
  /^[0-9a-f]{32}$/i.test(value);

export const getBackupKdfSaltHex = async (): Promise<string | null> => {
  try {
    const value = await SecureStore.getItemAsync(KEY_BACKUP_KDF_SALT);
    return value && isValidKdfSaltHex(value) ? value.toLowerCase() : null;
  } catch (err) {
    console.error('Failed to read backup KDF salt:', err);
    return null;
  }
};

/**
 * Creates the per-vault Argon2id salt once and reuses it. The salt is not a
 * secret; it is also embedded in each encrypted envelope so a backup can be
 * restored on a new device.
 */
export const getOrCreateBackupKdfSaltHex = async (): Promise<string> => {
  if (backupSaltRequest) return backupSaltRequest;

  backupSaltRequest = (async () => {
    const existing = await getBackupKdfSaltHex();
    if (existing) return existing;

    const saltHex = bytesToHex(Crypto.getRandomBytes(16));
    await SecureStore.setItemAsync(KEY_BACKUP_KDF_SALT, saltHex);
    return saltHex;
  })();

  try {
    return await backupSaltRequest;
  } finally {
    backupSaltRequest = null;
  }
};

export const cacheBackupKey = (saltHex: string, key: Uint8Array): void => {
  if (!isValidKdfSaltHex(saltHex) || key.length !== 32) {
    throw new Error('Refusing to cache an invalid backup key');
  }
  const normalized = saltHex.toLowerCase();

  if (!cachedBackupKeys.has(normalized) && cachedBackupKeys.size >= MAX_CACHED_BACKUP_KEYS) {
    const oldest = cachedBackupKeys.keys().next().value;
    if (oldest) {
      cachedBackupKeys.get(oldest)?.fill(0);
      cachedBackupKeys.delete(oldest);
    }
  }

  const existing = cachedBackupKeys.get(normalized);
  if (existing) existing.fill(0);
  cachedBackupKeys.set(normalized, new Uint8Array(key));
};

export const getCachedBackupKey = (saltHex: string): Uint8Array | null => {
  if (!isValidKdfSaltHex(saltHex)) return null;
  return cachedBackupKeys.get(saltHex.toLowerCase()) ?? null;
};

export const clearCachedBackupKey = (): void => {
  for (const key of cachedBackupKeys.values()) {
    key.fill(0);
  }
  cachedBackupKeys = new Map();
};

export interface PassphraseValidationResult {
  isValid: boolean;
  score: number; // 0 to 4
  feedback: string[];
}

export const checkPassphraseStrength = (passphrase: string): PassphraseValidationResult => {
  const feedback: string[] = [];
  let score = 0;

  if (passphrase.length < 8) {
    feedback.push('Must be at least 8 characters long');
  } else {
    score += 1;
  }

  if (/[A-Z]/.test(passphrase) && /[a-z]/.test(passphrase)) {
    score += 1;
  } else {
    feedback.push('Include both uppercase and lowercase letters');
  }

  if (/\d/.test(passphrase)) {
    score += 1;
  } else {
    feedback.push('Include at least one number');
  }

  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(passphrase)) {
    score += 1;
  } else {
    feedback.push('Include at least one special character');
  }

  return {
    isValid: score >= 3 && passphrase.length >= 8,
    score,
    feedback,
  };
};

export const isVaultInitialized = async (): Promise<boolean> => {
  try {
    const val = await SecureStore.getItemAsync(KEY_VAULT_INIT);
    return val === 'true';
  } catch (err) {
    return false;
  }
};

export const setupVaultPassphrase = async (
  passphrase: string,
  enableBiometrics: boolean = false
): Promise<boolean> => {
  try {
    // A new passphrase invalidates any previously cached backup key.
    clearCachedBackupKey();

    // Generate 16 bytes random salt
    const randomBytes = Crypto.getRandomBytes(16);
    const salt = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Salted SHA-256 hash
    const saltedHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${passphrase}:${salt}`
    );

    // Save strictly to hardware-backed SecureStore
    await SecureStore.setItemAsync(KEY_SALT, salt);
    await SecureStore.setItemAsync(KEY_HASH, saltedHash);
    await SecureStore.setItemAsync(KEY_VAULT_INIT, 'true');
    await SecureStore.setItemAsync(
      KEY_BIOMETRICS,
      enableBiometrics ? 'true' : 'false'
    );

    // A stable, non-secret Argon2id salt lets the same passphrase derive the
    // same backup key across sessions. The key itself is never stored.
    await getOrCreateBackupKdfSaltHex();

    isVaultSessionUnlocked = true;

    await logActivity(
      'vault_init',
      'Vault initialized with salted SHA-256 passphrase' +
        (enableBiometrics ? ' and biometric unlock enabled' : '')
    );

    return true;
  } catch (error) {
    console.error('Failed to setup vault security:', error);
    return false;
  }
};

/**
 * Side-effect-free passphrase check. Used by cloud backup before deriving a
 * key so a typo cannot silently create a backup under the wrong passphrase.
 */
export const checkVaultPassphrase = async (
  passphrase: string
): Promise<boolean> => {
  try {
    const salt = await SecureStore.getItemAsync(KEY_SALT);
    const storedHash = await SecureStore.getItemAsync(KEY_HASH);

    if (!salt || !storedHash) {
      return false;
    }

    const computedHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${passphrase}:${salt}`
    );

    return computedHash.toLowerCase() === storedHash.toLowerCase();
  } catch (err) {
    console.error('Passphrase check error:', err);
    return false;
  }
};

export const verifyPassphrase = async (passphrase: string): Promise<boolean> => {
  try {
    const matches = await checkVaultPassphrase(passphrase);
    if (matches) {
      isVaultSessionUnlocked = true;
      await logActivity('vault_unlock', 'Vault unlocked using passphrase');
    }
    return matches;
  } catch (err) {
    console.error('Passphrase verification error:', err);
    return false;
  }
};

export const isBiometricsSupported = async (): Promise<boolean> => {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && isEnrolled;
  } catch (err) {
    return false;
  }
};

export const isBiometricsEnabled = async (): Promise<boolean> => {
  try {
    const enabled = await SecureStore.getItemAsync(KEY_BIOMETRICS);
    return enabled === 'true';
  } catch (err) {
    return false;
  }
};

export const setBiometricsEnabled = async (enabled: boolean): Promise<void> => {
  await SecureStore.setItemAsync(KEY_BIOMETRICS, enabled ? 'true' : 'false');
  await logActivity(
    'vault_settings',
    `Biometric authentication ${enabled ? 'enabled' : 'disabled'}`
  );
};

export const authenticateWithBiometrics = async (): Promise<boolean> => {
  try {
    const supported = await isBiometricsSupported();
    const enabled = await isBiometricsEnabled();

    if (!supported || !enabled) {
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock EvidenceVault',
      cancelLabel: 'Use Passphrase',
      disableDeviceFallback: false,
    });

    if (result.success) {
      isVaultSessionUnlocked = true;
      await logActivity('vault_unlock', 'Vault unlocked using biometrics');
      return true;
    }
    return false;
  } catch (err) {
    console.error('Biometric authentication failed:', err);
    return false;
  }
};

export const isVaultUnlocked = (): boolean => {
  return isVaultSessionUnlocked;
};

export const lockVault = async (): Promise<void> => {
  isVaultSessionUnlocked = false;
  clearCachedBackupKey();
  await logActivity('vault_lock', 'Vault session locked');
};

export const resetVaultSecurity = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(KEY_VAULT_INIT);
    await SecureStore.deleteItemAsync(KEY_SALT);
    await SecureStore.deleteItemAsync(KEY_HASH);
    await SecureStore.deleteItemAsync(KEY_BIOMETRICS);
    await SecureStore.deleteItemAsync(KEY_BACKUP_KDF_SALT);
    await clearAutoBackupPreferences();
    clearCachedBackupKey();
    isVaultSessionUnlocked = false;
  } catch (err) {
    console.error('Failed to reset security store:', err);
  }
};

