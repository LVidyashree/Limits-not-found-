// PLACEHOLDER — client-side encryption for cloud backup is not
// implemented yet. Pending approval of the Supabase backend plan.
// The app remains 100% offline until this is wired up.

export interface EncryptedFile {
  encryptedData: ArrayBuffer;
  iv: Uint8Array;
  authTag: Uint8Array;
}

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

export const encryptFile = async (
  filePath: string,
  key: CryptoKey
): Promise<EncryptedFile> => notImplemented('encryptFile');

export const decryptFile = async (
  encryptedData: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array,
  authTag: Uint8Array
): Promise<ArrayBuffer> => notImplemented('decryptFile');

export const deriveKeyFromPassword = async (
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> => notImplemented('deriveKeyFromPassword');
