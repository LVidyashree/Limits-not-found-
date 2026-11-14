import * as SecureStore from 'expo-secure-store';

/**
 * Optional automatic encrypted cloud backup.
 *
 * Auto-backup is off by default. Enabling it requires a separate, explicit
 * consent action that records when the user agreed. The consent timestamp and
 * the enabled flag are preferences, not secrets, but they live in SecureStore
 * so they are removed together with the rest of the vault security state.
 */
const KEY_AUTO_BACKUP_ENABLED = 'ev_auto_backup_enabled';
const KEY_AUTO_BACKUP_CONSENT_AT = 'ev_auto_backup_consent_at';

export const isAutoBackupEnabled = async (): Promise<boolean> => {
  try {
    return (await SecureStore.getItemAsync(KEY_AUTO_BACKUP_ENABLED)) === 'true';
  } catch (err) {
    console.warn('Could not read auto-backup preference:', err);
    return false;
  }
};

export const getAutoBackupConsentAt = async (): Promise<string | null> => {
  try {
    const value = await SecureStore.getItemAsync(KEY_AUTO_BACKUP_CONSENT_AT);
    return value && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch (err) {
    console.warn('Could not read auto-backup consent:', err);
    return null;
  }
};

export const hasAutoBackupConsent = async (): Promise<boolean> =>
  (await getAutoBackupConsentAt()) !== null;

export interface EnableAutoBackupResult {
  enabled: true;
  consentAt: string;
}

/**
 * Enables auto-backup and records consent. Consent is only written by this
 * explicit call, never as a side effect of uploading evidence.
 */
export const enableAutoBackupWithConsent =
  async (): Promise<EnableAutoBackupResult> => {
    const existing = await getAutoBackupConsentAt();
    const consentAt = existing ?? new Date().toISOString();

    await SecureStore.setItemAsync(KEY_AUTO_BACKUP_CONSENT_AT, consentAt);
    await SecureStore.setItemAsync(KEY_AUTO_BACKUP_ENABLED, 'true');

    return { enabled: true, consentAt };
  };

export const disableAutoBackup = async (): Promise<void> => {
  // Keep the consent record so the user can see that they previously opted in,
  // but stop all automatic uploads immediately.
  await SecureStore.setItemAsync(KEY_AUTO_BACKUP_ENABLED, 'false');
};

export const clearAutoBackupPreferences = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(KEY_AUTO_BACKUP_ENABLED);
  await SecureStore.deleteItemAsync(KEY_AUTO_BACKUP_CONSENT_AT);
};
