import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import { logActivity } from './database';

const KEY_VAULT_INIT = 'ev_vault_initialized';
const KEY_SALT = 'ev_vault_salt';
const KEY_HASH = 'ev_vault_passphrase_hash';
const KEY_BIOMETRICS = 'ev_vault_biometrics_enabled';

let isVaultSessionUnlocked = false;

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

export const verifyPassphrase = async (passphrase: string): Promise<boolean> => {
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

    const matches = computedHash.toLowerCase() === storedHash.toLowerCase();
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
  await logActivity('vault_lock', 'Vault session locked');
};

export const resetVaultSecurity = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(KEY_VAULT_INIT);
    await SecureStore.deleteItemAsync(KEY_SALT);
    await SecureStore.deleteItemAsync(KEY_HASH);
    await SecureStore.deleteItemAsync(KEY_BIOMETRICS);
    isVaultSessionUnlocked = false;
  } catch (err) {
    console.error('Failed to reset security store:', err);
  }
};

