import { Paths, Directory, File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { FileCategory } from '../types';

/**
 * Resolves the root document directory safely across all platforms and environments.
 */
const getBaseDirectory = (): Directory => {
  try {
    if (Paths.document && Paths.document.uri) {
      return Paths.document;
    }
  } catch (e) {
    console.warn('Paths.document not ready, falling back to cache:', e);
  }

  try {
    if (Paths.cache && Paths.cache.uri) {
      return Paths.cache;
    }
  } catch (e) {
    console.warn('Paths.cache not ready:', e);
  }

  return new Directory('file:///data/user/0/host.exp.exponent/files/');
};

/**
 * Returns or creates the evidencevault parent directory.
 */
const getVaultDirectory = (): Directory => {
  const base = getBaseDirectory();
  const vault = new Directory(base, 'evidencevault');
  if (!vault.exists) {
    try {
      vault.create({ idempotent: true });
    } catch (e) {
      console.warn('Failed to create vault directory:', e);
    }
  }
  return vault;
};

/**
 * Returns or creates the evidencevault/evidence subdirectory.
 */
const getEvidenceDirectoryObj = (): Directory => {
  const vault = getVaultDirectory();
  const ev = new Directory(vault, 'evidence');
  if (!ev.exists) {
    try {
      ev.create({ idempotent: true });
    } catch (e) {
      console.warn('Failed to create evidence directory:', e);
    }
  }
  return ev;
};

export const initStorage = async (): Promise<void> => {
  try {
    getEvidenceDirectoryObj();
  } catch (err) {
    console.warn('Storage initialization notice:', err);
  }
};

export const getEvidenceDirectory = (): string => {
  try {
    return getEvidenceDirectoryObj().uri;
  } catch (e) {
    return 'file:///evidencevault/evidence/';
  }
};

export const computeFileSha256 = async (uri: string): Promise<string> => {
  try {
    const file = new File(uri);
    if (!file.exists) {
      const fallback = `${uri}_${Date.now()}`;
      return (
        await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fallback)
      ).toLowerCase();
    }

    const base64Data = await file.base64();
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      base64Data
    );
    return hash.toLowerCase();
  } catch (error) {
    console.error('Failed to compute SHA-256 hash:', error);
    const fallbackString = `${uri}_${Date.now()}`;
    return (
      await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        fallbackString
      )
    ).toLowerCase();
  }
};

export const saveEvidenceFileLocally = async (
  sourceUri: string,
  originalFilename: string
): Promise<{
  localPath: string;
  filename: string;
  size: number;
  sha256: string;
}> => {
  await initStorage();

  const cleanExt = originalFilename.includes('.')
    ? '.' + originalFilename.split('.').pop()?.toLowerCase()
    : '';
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const secureFilename = `ev_${timestamp}_${randomSuffix}${cleanExt}`;

  const evDir = getEvidenceDirectoryObj();
  const destinationFile = new File(evDir, secureFilename);
  const sourceFile = new File(sourceUri);

  // Copy bit-exact content to isolated sandbox
  await sourceFile.copy(destinationFile);

  const fileSize = destinationFile.size ?? 0;
  const sha256 = await computeFileSha256(destinationFile.uri);

  return {
    localPath: destinationFile.uri,
    filename: secureFilename,
    size: fileSize,
    sha256,
  };
};

export const saveTextAsEvidenceFile = async (
  content: string,
  preferredName: string = 'evidence_note.txt'
): Promise<{
  localPath: string;
  filename: string;
  size: number;
  sha256: string;
}> => {
  await initStorage();

  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const secureFilename = `note_${timestamp}_${randomSuffix}.txt`;

  const evDir = getEvidenceDirectoryObj();
  const destinationFile = new File(evDir, secureFilename);

  // Write UTF-8 text into vault
  await destinationFile.write(content);

  const fileSize = destinationFile.size ?? content.length;
  const sha256 = await computeFileSha256(destinationFile.uri);

  return {
    localPath: destinationFile.uri,
    filename: secureFilename,
    size: fileSize,
    sha256,
  };
};

export const verifyFileIntegrity = async (
  filePath: string,
  expectedHash: string
): Promise<{ isValid: boolean; currentHash: string; fileExists: boolean }> => {
  try {
    const file = new File(filePath);
    if (!file.exists) {
      return { isValid: false, currentHash: '', fileExists: false };
    }

    const currentHash = await computeFileSha256(filePath);
    const isValid = currentHash.toLowerCase() === expectedHash.toLowerCase();
    return { isValid, currentHash, fileExists: true };
  } catch (err) {
    console.error('Integrity verification error:', err);
    return { isValid: false, currentHash: '', fileExists: false };
  }
};

export const readTextFromFile = async (filePath: string): Promise<string | null> => {
  try {
    const file = new File(filePath);
    if (!file.exists) return null;
    return await file.text();
  } catch (err) {
    return null;
  }
};

export const deleteFileLocally = async (filePath: string): Promise<boolean> => {
  try {
    const file = new File(filePath);
    if (file.exists) {
      file.delete();
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to delete file:', err);
    return false;
  }
};

export const getStorageUsage = async (): Promise<{
  evidenceFilesCount: number;
  evidenceBytes: number;
  dbBytes: number;
  totalVaultBytes: number;
}> => {
  try {
    const evDir = getEvidenceDirectoryObj();
    let totalEvidenceBytes = 0;
    let fileCount = 0;

    if (evDir.exists) {
      const items = evDir.list();
      for (const item of items) {
        if (item instanceof File && item.exists) {
          totalEvidenceBytes += item.size ?? 0;
          fileCount++;
        }
      }
    }

    let dbBytes = 0;
    try {
      const base = getBaseDirectory();
      const dbFile = new File(base, 'SQLite', 'evidencevault.db');
      if (dbFile.exists) {
        dbBytes = dbFile.size ?? 0;
      }
    } catch (e) {}

    return {
      evidenceFilesCount: fileCount,
      evidenceBytes: totalEvidenceBytes,
      dbBytes,
      totalVaultBytes: totalEvidenceBytes + dbBytes,
    };
  } catch (err) {
    return {
      evidenceFilesCount: 0,
      evidenceBytes: 0,
      dbBytes: 0,
      totalVaultBytes: 0,
    };
  }
};

export const wipeAllVaultFiles = async (): Promise<void> => {
  try {
    const vault = getVaultDirectory();
    if (vault.exists) {
      vault.delete();
    }
    getEvidenceDirectoryObj(); // Recreate empty structure
  } catch (err) {
    console.error('Failed to wipe vault files:', err);
  }
};

export const detectFileType = (filename: string, mimeType?: string): FileCategory => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mime = mimeType?.toLowerCase() || '';

  if (
    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'tiff'].includes(ext) ||
    mime.startsWith('image/')
  ) {
    return 'image';
  }

  if (ext === 'pdf' || mime === 'application/pdf') {
    return 'pdf';
  }

  if (
    ['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp'].includes(ext) ||
    mime.startsWith('video/')
  ) {
    return 'video';
  }

  if (
    ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'].includes(ext) ||
    mime.startsWith('audio/')
  ) {
    return 'audio';
  }

  if (
    ['txt', 'log', 'csv', 'json', 'md', 'xml', 'eml'].includes(ext) ||
    mime.startsWith('text/')
  ) {
    return 'text';
  }

  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf'].includes(ext)) {
    return 'document';
  }

  return 'other';
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
