import * as Crypto from 'expo-crypto';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';

import {
  AesGcmBackend,
  BackupCryptoError,
  BackupEnvelopeContext,
  BackupEnvelopeHeader,
  BackupKdfCost,
  DEFAULT_BACKUP_KDF_COST,
  base64ToBytes,
  deriveBackupKey,
  openEnvelope,
  sealEnvelope,
} from './backupCryptoCore';
import {
  cacheBackupKey,
  checkVaultPassphrase,
  getCachedBackupKey,
  getOrCreateBackupKdfSaltHex,
} from './security';

/**
 * Device-side AES-256-GCM using expo-crypto's native implementation.
 *
 * Keys are imported per operation and never exported or persisted. The
 * passphrase is not cached; only derived keys are, and only in memory.
 */
export const expoAesGcmBackend: AesGcmBackend = {
  async encrypt({ key, nonce, plaintext, aad }) {
    const aesKey = await AESEncryptionKey.import(key);
    const sealed = await aesEncryptAsync(plaintext, aesKey, {
      nonce: { bytes: nonce },
      tagLength: 16,
      additionalData: aad,
    });

    return {
      ciphertext: await sealed.ciphertext(),
      tag: await sealed.tag(),
    };
  },

  async decrypt({ key, nonce, ciphertext, tag, aad }) {
    const aesKey = await AESEncryptionKey.import(key);
    const sealed = AESSealedData.fromParts(nonce, ciphertext, tag);

    return aesDecryptAsync(sealed, aesKey, {
      output: 'bytes',
      additionalData: aad,
    });
  },
};

export interface VaultBackupKey {
  saltHex: string;
  salt: Uint8Array;
  key: Uint8Array;
  cost: BackupKdfCost;
}

const hexToBytesLocal = (hex: string): Uint8Array => {
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new BackupCryptoError('invalid_kdf', 'Invalid backup KDF salt');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const bytesToHexLocal = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/**
 * Resolve the current vault's backup key.
 *
 * - A cached key is used without asking for the passphrase (auto-backup).
 * - Otherwise the passphrase is checked against the existing vault hash
 *   before deriving, so a typo cannot silently encrypt a backup under a
 *   different key.
 */
export const resolveVaultBackupKey = async (
  passphrase?: string
): Promise<VaultBackupKey> => {
  const saltHex = await getOrCreateBackupKdfSaltHex();
  const cached = getCachedBackupKey(saltHex);

  if (cached) {
    // A manual backup supplies a passphrase. Check it even when a key is
    // cached, so a typo cannot be silently accepted while the vault is open.
    if (passphrase) {
      const isCorrect = await checkVaultPassphrase(passphrase);
      if (!isCorrect) {
        throw new BackupCryptoError(
          'authentication_failed',
          'That passphrase does not match this vault'
        );
      }
    }

    return {
      saltHex,
      salt: hexToBytesLocal(saltHex),
      key: cached,
      cost: DEFAULT_BACKUP_KDF_COST,
    };
  }

  if (!passphrase) {
    throw new BackupCryptoError(
      'passphrase_required',
      'Enter your vault passphrase to unlock encrypted cloud backup'
    );
  }

  const isCorrect = await checkVaultPassphrase(passphrase);
  if (!isCorrect) {
    throw new BackupCryptoError(
      'authentication_failed',
      'That passphrase does not match this vault'
    );
  }

  const salt = hexToBytesLocal(saltHex);
  const key = await deriveBackupKey(passphrase, salt, DEFAULT_BACKUP_KDF_COST);
  cacheBackupKey(saltHex, key);

  return {
    saltHex,
    salt,
    key,
    cost: DEFAULT_BACKUP_KDF_COST,
  };
};

/**
 * Derive a key using the salt stored inside an envelope. This is what makes
 * restore possible on a new device, where the local vault salt may differ.
 * The key is cached by its salt so repeated restores do not re-run Argon2id.
 */
export const deriveKeyForEnvelope = async (
  passphrase: string,
  header: BackupEnvelopeHeader
): Promise<{ key: Uint8Array; saltHex: string }> => {
  const salt = base64ToBytes(header.kdf.salt);
  const saltHex = bytesToHexLocal(salt);
  const cached = getCachedBackupKey(saltHex);
  if (cached) {
    return { key: cached, saltHex };
  }

  const key = await deriveBackupKey(passphrase, salt, {
    m: header.kdf.m,
    t: header.kdf.t,
    p: header.kdf.p,
    dkLen: header.kdf.dkLen,
  });

  return { key, saltHex };
};

export interface EncryptBackupInput {
  plaintext: Uint8Array;
  keyMaterial: VaultBackupKey;
  context: BackupEnvelopeContext;
  nonce?: Uint8Array;
}

export const encryptBackupBytes = async (
  input: EncryptBackupInput
): Promise<Uint8Array> =>
  sealEnvelope({
    plaintext: input.plaintext,
    key: input.keyMaterial.key,
    kdfSalt: input.keyMaterial.salt,
    kdfCost: input.keyMaterial.cost,
    context: input.context,
    aes: expoAesGcmBackend,
    randomBytes: Crypto.getRandomBytes,
    nonce: input.nonce,
  });

export interface DecryptBackupInput {
  envelope: Uint8Array;
  key: Uint8Array;
  expectedContext?: BackupEnvelopeContext;
}

export const decryptBackupBytes = async (
  input: DecryptBackupInput
): Promise<{ plaintext: Uint8Array; header: BackupEnvelopeHeader }> =>
  openEnvelope({
    envelope: input.envelope,
    key: input.key,
    aes: expoAesGcmBackend,
    expectedContext: input.expectedContext,
  });
