import { argon2idAsync } from '@noble/hashes/argon2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Pure, platform-independent backup cryptography.
 *
 * The AES-GCM primitive is injected so this module can be unit tested in
 * Node with WebCrypto and used on device with expo-crypto. Nothing here
 * imports React Native or Expo.
 *
 * Envelope layout (all integers big-endian):
 *
 *   "EVB1" | uint32 headerLength | header JSON (UTF-8) | ciphertext | 16-byte tag
 *
 * The bytes from "EVB1" through the end of the header are used as GCM
 * additional authenticated data (AAD). Tampering with the header, the
 * declared plaintext hash, the KDF parameters or the context therefore
 * makes decryption fail as well as changing the ciphertext.
 */

export const ENVELOPE_MAGIC = 'EVB1';
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_EXTENSION = '.evb';

const MAGIC_BYTES = new Uint8Array([0x45, 0x56, 0x42, 0x31]);
const ENVELOPE_PREFIX_BYTES = 4 + 4;
const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MIN_SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;
const MAX_HEADER_BYTES = 8192;
const MIN_HEADER_BYTES = 2;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type BackupCryptoErrorCode =
  | 'invalid_base64'
  | 'invalid_key'
  | 'invalid_kdf'
  | 'invalid_cipher'
  | 'invalid_context'
  | 'invalid_envelope'
  | 'invalid_header'
  | 'unsupported_version'
  | 'authentication_failed'
  | 'hash_mismatch'
  | 'size_mismatch'
  | 'passphrase_required';

export class BackupCryptoError extends Error {
  readonly code: BackupCryptoErrorCode;

  constructor(code: BackupCryptoErrorCode, message: string) {
    super(message);
    this.name = 'BackupCryptoError';
    this.code = code;
  }
}

export interface AesGcmEncryptInput {
  key: Uint8Array;
  nonce: Uint8Array;
  plaintext: Uint8Array;
  aad: Uint8Array;
}

export interface AesGcmDecryptInput {
  key: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
  aad: Uint8Array;
}

export interface AesGcmBackend {
  encrypt(input: AesGcmEncryptInput): Promise<{
    ciphertext: Uint8Array;
    tag: Uint8Array;
  }>;
  decrypt(input: AesGcmDecryptInput): Promise<Uint8Array>;
}

export interface BackupKdfCost {
  /** Argon2id memory cost in kibibytes. */
  m: number;
  /** Argon2id iterations. */
  t: number;
  /** Argon2id parallelism. */
  p: number;
  /** Derived key length in bytes. Must be 32 for AES-256. */
  dkLen: number;
}

/**
 * Mobile-friendly Argon2id parameters. 64 MiB / 3 iterations is within
 * OWASP's recommended range and is deliberately chosen to be usable on a
 * phone. A malicious envelope cannot raise these limits beyond the bounds
 * enforced by assertKdfCost().
 */
export const DEFAULT_BACKUP_KDF_COST: BackupKdfCost = Object.freeze({
  m: 65536,
  t: 3,
  p: 1,
  dkLen: 32,
});

const KDF_LIMITS = Object.freeze({
  minM: 8192,
  maxM: 262144,
  minT: 1,
  maxT: 10,
  minP: 1,
  maxP: 4,
});

export interface BackupEnvelopeContext {
  userId: string;
  caseId: string;
  evidenceId: string;
}

export interface BackupEnvelopeHeader {
  version: 1;
  kdf: {
    name: 'argon2id';
    m: number;
    t: number;
    p: number;
    dkLen: number;
    salt: string;
  };
  cipher: {
    name: 'AES-256-GCM';
    nonce: string;
    tagLength: 16;
  };
  context: BackupEnvelopeContext;
  plaintext: {
    sha256: string;
    size: number;
  };
}

export interface ParsedEnvelope {
  header: BackupEnvelopeHeader;
  /** Exact bytes covered by the GCM authentication tag. */
  aad: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface SealEnvelopeInput {
  plaintext: Uint8Array;
  key: Uint8Array;
  kdfSalt: Uint8Array;
  context: BackupEnvelopeContext;
  aes: AesGcmBackend;
  randomBytes: (byteCount: number) => Uint8Array;
  kdfCost?: BackupKdfCost;
  /** Only for deterministic tests. Production always uses randomBytes(12). */
  nonce?: Uint8Array;
}

export interface OpenEnvelopeInput {
  envelope: Uint8Array;
  key: Uint8Array;
  aes: AesGcmBackend;
  expectedContext?: BackupEnvelopeContext;
}

export interface OpenEnvelopeResult {
  plaintext: Uint8Array;
  header: BackupEnvelopeHeader;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET[i]] = i;
  }
  return table;
})();

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;

    output += BASE64_ALPHABET[(triplet >> 18) & 63];
    output += BASE64_ALPHABET[(triplet >> 12) & 63];
    output += i + 1 < bytes.length ? BASE64_ALPHABET[(triplet >> 6) & 63] : '=';
    output += i + 2 < bytes.length ? BASE64_ALPHABET[triplet & 63] : '=';
  }
  return output;
};

export const base64ToBytes = (value: string): Uint8Array => {
  if (typeof value !== 'string' || !BASE64_RE.test(value)) {
    throw new BackupCryptoError('invalid_base64', 'Value is not valid base64');
  }

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const outputLength = (value.length / 4) * 3 - padding;
  const output = new Uint8Array(outputLength);

  let cursor = 0;
  for (let i = 0; i < value.length; i += 4) {
    const c0 = BASE64_LOOKUP[value[i]];
    const c1 = BASE64_LOOKUP[value[i + 1]];
    const c2 = value[i + 2] === '=' ? 0 : BASE64_LOOKUP[value[i + 2]];
    const c3 = value[i + 3] === '=' ? 0 : BASE64_LOOKUP[value[i + 3]];

    if (
      c0 === undefined ||
      c1 === undefined ||
      c2 === undefined ||
      c3 === undefined
    ) {
      throw new BackupCryptoError('invalid_base64', 'Value is not valid base64');
    }

    if (cursor < outputLength) {
      output[cursor++] = (c0 << 2) | (c1 >> 4);
    }
    if (cursor < outputLength) {
      output[cursor++] = ((c1 & 15) << 4) | (c2 >> 2);
    }
    if (cursor < outputLength) {
      output[cursor++] = ((c2 & 3) << 6) | c3;
    }
  }

  return output;
};

export const bytesToHex = (bytes: Uint8Array): string => {
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    output += bytes[i].toString(16).padStart(2, '0');
  }
  return output;
};

export const hexToBytes = (value: string): Uint8Array => {
  if (typeof value !== 'string' || value.length % 2 !== 0) {
    throw new BackupCryptoError('invalid_header', 'Hex value has an invalid length');
  }
  if (!/^[0-9a-f]*$/i.test(value)) {
    throw new BackupCryptoError('invalid_header', 'Hex value contains invalid characters');
  }

  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return output;
};

/**
 * Strict UTF-8 encoder/decoder. Kept local so the envelope parser never
 * depends on a runtime-provided TextEncoder/TextDecoder.
 */
export const utf8Encode = (value: string): Uint8Array => {
  const bytes: number[] = [];

  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.charCodeAt(i);

    // Combine surrogate pairs.
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint =
          0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        throw new BackupCryptoError(
          'invalid_header',
          'String contains an unpaired UTF-16 surrogate'
        );
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      throw new BackupCryptoError(
        'invalid_header',
        'String contains an unpaired UTF-16 surrogate'
      );
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }

  return new Uint8Array(bytes);
};

export const utf8Decode = (bytes: Uint8Array): string => {
  let output = '';
  let i = 0;

  while (i < bytes.length) {
    const first = bytes[i++];
    let codePoint: number;

    if (first < 0x80) {
      codePoint = first;
    } else if (first >= 0xc2 && first <= 0xdf) {
      if (i >= bytes.length) {
        throw new BackupCryptoError('invalid_header', 'Truncated UTF-8 sequence');
      }
      const second = bytes[i++];
      if ((second & 0xc0) !== 0x80) {
        throw new BackupCryptoError('invalid_header', 'Invalid UTF-8 continuation byte');
      }
      codePoint = ((first & 0x1f) << 6) | (second & 0x3f);
    } else if (first >= 0xe0 && first <= 0xef) {
      if (i + 1 >= bytes.length) {
        throw new BackupCryptoError('invalid_header', 'Truncated UTF-8 sequence');
      }
      const second = bytes[i++];
      const third = bytes[i++];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) {
        throw new BackupCryptoError('invalid_header', 'Invalid UTF-8 continuation byte');
      }
      if (first === 0xe0 && second < 0xa0) {
        throw new BackupCryptoError('invalid_header', 'Overlong UTF-8 sequence');
      }
      if (first === 0xed && second >= 0xa0) {
        throw new BackupCryptoError('invalid_header', 'UTF-8 surrogate is not allowed');
      }
      codePoint =
        ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
    } else if (first >= 0xf0 && first <= 0xf4) {
      if (i + 2 >= bytes.length) {
        throw new BackupCryptoError('invalid_header', 'Truncated UTF-8 sequence');
      }
      const second = bytes[i++];
      const third = bytes[i++];
      const fourth = bytes[i++];
      if (
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80 ||
        (fourth & 0xc0) !== 0x80
      ) {
        throw new BackupCryptoError('invalid_header', 'Invalid UTF-8 continuation byte');
      }
      if (first === 0xf0 && second < 0x90) {
        throw new BackupCryptoError('invalid_header', 'Overlong UTF-8 sequence');
      }
      if (first === 0xf4 && second >= 0x90) {
        throw new BackupCryptoError('invalid_header', 'UTF-8 code point is out of range');
      }
      codePoint =
        ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f);
    } else {
      throw new BackupCryptoError('invalid_header', 'Invalid UTF-8 leading byte');
    }

    if (codePoint > 0xffff) {
      const adjusted = codePoint - 0x10000;
      output += String.fromCharCode(
        0xd800 + (adjusted >> 10),
        0xdc00 + (adjusted & 0x3ff)
      );
    } else {
      output += String.fromCharCode(codePoint);
    }
  }

  return output;
};

const concatBytes = (...chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

const writeUint32BE = (value: number, target: Uint8Array, offset: number): void => {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
};

const readUint32BE = (source: Uint8Array, offset: number): number =>
  ((source[offset] << 24) |
    (source[offset + 1] << 16) |
    (source[offset + 2] << 8) |
    source[offset + 3]) >>>
  0;

const assertUuid = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new BackupCryptoError(
      'invalid_context',
      `${field} must be a UUID`
    );
  }
  return value.toLowerCase();
};

const assertPlaintextSize = (value: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new BackupCryptoError(
      'invalid_header',
      'Plaintext size must be a non-negative safe integer'
    );
  }
  return value;
};

const assertSha256 = (value: unknown): string => {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new BackupCryptoError(
      'invalid_header',
      'SHA-256 must be 64 lowercase hex characters'
    );
  }
  return value;
};

const assertByteLength = (
  bytes: Uint8Array,
  expected: number,
  code: BackupCryptoErrorCode,
  label: string
): void => {
  if (bytes.length !== expected) {
    throw new BackupCryptoError(
      code,
      `${label} must be exactly ${expected} bytes`
    );
  }
};

export const assertKdfCost = (cost: BackupKdfCost): BackupKdfCost => {
  if (!cost || typeof cost !== 'object') {
    throw new BackupCryptoError('invalid_kdf', 'KDF parameters are missing');
  }

  const isInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value);

  if (!isInteger(cost.m) || cost.m < KDF_LIMITS.minM || cost.m > KDF_LIMITS.maxM) {
    throw new BackupCryptoError(
      'invalid_kdf',
      `Argon2id memory cost must be between ${KDF_LIMITS.minM} and ${KDF_LIMITS.maxM} KiB`
    );
  }
  if (!isInteger(cost.t) || cost.t < KDF_LIMITS.minT || cost.t > KDF_LIMITS.maxT) {
    throw new BackupCryptoError(
      'invalid_kdf',
      `Argon2id iterations must be between ${KDF_LIMITS.minT} and ${KDF_LIMITS.maxT}`
    );
  }
  if (!isInteger(cost.p) || cost.p < KDF_LIMITS.minP || cost.p > KDF_LIMITS.maxP) {
    throw new BackupCryptoError(
      'invalid_kdf',
      `Argon2id parallelism must be between ${KDF_LIMITS.minP} and ${KDF_LIMITS.maxP}`
    );
  }
  if (cost.dkLen !== AES_KEY_BYTES) {
    throw new BackupCryptoError(
      'invalid_kdf',
      `Argon2id output must be ${AES_KEY_BYTES} bytes`
    );
  }

  return {
    m: cost.m,
    t: cost.t,
    p: cost.p,
    dkLen: cost.dkLen,
  };
};

const assertSalt = (salt: Uint8Array): void => {
  if (
    !(salt instanceof Uint8Array) ||
    salt.length < MIN_SALT_BYTES ||
    salt.length > MAX_SALT_BYTES
  ) {
    throw new BackupCryptoError(
      'invalid_kdf',
      `KDF salt must be ${MIN_SALT_BYTES}-${MAX_SALT_BYTES} bytes`
    );
  }
};

const assertKey = (key: Uint8Array): void => {
  if (!(key instanceof Uint8Array)) {
    throw new BackupCryptoError('invalid_key', 'Key must be a Uint8Array');
  }
  assertByteLength(key, AES_KEY_BYTES, 'invalid_key', 'AES-256 key');
};

const assertContext = (context: BackupEnvelopeContext): BackupEnvelopeContext => ({
  userId: assertUuid(context?.userId, 'userId'),
  caseId: assertUuid(context?.caseId, 'caseId'),
  evidenceId: assertUuid(context?.evidenceId, 'evidenceId'),
});

const contextsMatch = (
  expected: BackupEnvelopeContext,
  actual: BackupEnvelopeContext
): boolean =>
  expected.userId.toLowerCase() === actual.userId.toLowerCase() &&
  expected.caseId.toLowerCase() === actual.caseId.toLowerCase() &&
  expected.evidenceId.toLowerCase() === actual.evidenceId.toLowerCase();

// ---------------------------------------------------------------------------
// KDF + hashing
// ---------------------------------------------------------------------------

export const sha256Hex = (data: Uint8Array): string => {
  if (!(data instanceof Uint8Array)) {
    throw new BackupCryptoError('invalid_header', 'SHA-256 input must be bytes');
  }
  return bytesToHex(sha256(data));
};

/**
 * Derive the AES-256 key from the vault passphrase. The salt is public and
 * travels in the envelope header, so a backup can be restored on a brand-new
 * device as long as the user still knows the passphrase.
 */
export const deriveBackupKey = async (
  passphrase: string,
  salt: Uint8Array,
  cost: BackupKdfCost = DEFAULT_BACKUP_KDF_COST
): Promise<Uint8Array> => {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new BackupCryptoError('passphrase_required', 'A passphrase is required');
  }
  assertSalt(salt);
  const validated = assertKdfCost(cost);

  // Noble's default maxmem is 1 GiB. Pass an explicit budget derived from the
  // validated cost so a crafted header cannot cause an unexpectedly large
  // allocation.
  const maxmem = Math.max(
    validated.m * 1024 * 2 + 1024 * 1024,
    16 * 1024 * 1024
  );

  return argon2idAsync(passphrase, salt, {
    m: validated.m,
    t: validated.t,
    p: validated.p,
    dkLen: validated.dkLen,
    maxmem,
    asyncTick: 15,
  });
};

// ---------------------------------------------------------------------------
// Envelope encoding
// ---------------------------------------------------------------------------

export const parseEnvelope = (envelope: Uint8Array): ParsedEnvelope => {
  if (!(envelope instanceof Uint8Array)) {
    throw new BackupCryptoError('invalid_envelope', 'Envelope must be bytes');
  }

  if (envelope.length < ENVELOPE_PREFIX_BYTES + MIN_HEADER_BYTES + GCM_TAG_BYTES) {
    throw new BackupCryptoError('invalid_envelope', 'Envelope is truncated');
  }

  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    if (envelope[i] !== MAGIC_BYTES[i]) {
      throw new BackupCryptoError('invalid_envelope', 'Envelope magic is missing');
    }
  }

  const headerLength = readUint32BE(envelope, 4);
  if (headerLength < MIN_HEADER_BYTES || headerLength > MAX_HEADER_BYTES) {
    throw new BackupCryptoError(
      'invalid_header',
      `Header length must be between ${MIN_HEADER_BYTES} and ${MAX_HEADER_BYTES} bytes`
    );
  }

  const headerEnd = ENVELOPE_PREFIX_BYTES + headerLength;
  if (headerEnd + GCM_TAG_BYTES > envelope.length) {
    throw new BackupCryptoError('invalid_envelope', 'Envelope is truncated');
  }

  const headerBytes = envelope.slice(ENVELOPE_PREFIX_BYTES, headerEnd);
  let rawHeader: unknown;
  try {
    rawHeader = JSON.parse(utf8Decode(headerBytes));
  } catch (error) {
    if (error instanceof BackupCryptoError) throw error;
    throw new BackupCryptoError('invalid_header', 'Header is not valid JSON');
  }

  if (!rawHeader || typeof rawHeader !== 'object' || Array.isArray(rawHeader)) {
    throw new BackupCryptoError('invalid_header', 'Header must be an object');
  }

  const header = rawHeader as Record<string, unknown>;

  if (header.version !== ENVELOPE_VERSION) {
    throw new BackupCryptoError(
      'unsupported_version',
      `Unsupported envelope version: ${String(header.version)}`
    );
  }

  const kdf = header.kdf as Record<string, unknown> | undefined;
  if (!kdf || typeof kdf !== 'object') {
    throw new BackupCryptoError('invalid_kdf', 'Header is missing KDF parameters');
  }
  if (kdf.name !== 'argon2id') {
    throw new BackupCryptoError('invalid_kdf', 'Only Argon2id is supported');
  }
  const kdfCost = assertKdfCost({
    m: kdf.m as number,
    t: kdf.t as number,
    p: kdf.p as number,
    dkLen: kdf.dkLen as number,
  });
  const salt = base64ToBytes(kdf.salt as string);
  assertSalt(salt);

  const cipher = header.cipher as Record<string, unknown> | undefined;
  if (!cipher || typeof cipher !== 'object') {
    throw new BackupCryptoError('invalid_cipher', 'Header is missing cipher parameters');
  }
  if (cipher.name !== 'AES-256-GCM') {
    throw new BackupCryptoError('invalid_cipher', 'Only AES-256-GCM is supported');
  }
  if (cipher.tagLength !== GCM_TAG_BYTES) {
    throw new BackupCryptoError(
      'invalid_cipher',
      `GCM tag must be ${GCM_TAG_BYTES} bytes`
    );
  }
  const nonce = base64ToBytes(cipher.nonce as string);
  assertByteLength(nonce, GCM_NONCE_BYTES, 'invalid_cipher', 'GCM nonce');

  const rawContext = header.context as Record<string, unknown> | undefined;
  if (!rawContext || typeof rawContext !== 'object') {
    throw new BackupCryptoError('invalid_context', 'Header is missing context');
  }
  const context = assertContext({
    userId: rawContext.userId as string,
    caseId: rawContext.caseId as string,
    evidenceId: rawContext.evidenceId as string,
  });

  const rawPlaintext = header.plaintext as Record<string, unknown> | undefined;
  if (!rawPlaintext || typeof rawPlaintext !== 'object') {
    throw new BackupCryptoError('invalid_header', 'Header is missing plaintext metadata');
  }
  const plaintextSha256 = assertSha256(rawPlaintext.sha256);
  const plaintextSize = assertPlaintextSize(rawPlaintext.size);

  const ciphertext = envelope.slice(headerEnd, envelope.length - GCM_TAG_BYTES);
  const tag = envelope.slice(envelope.length - GCM_TAG_BYTES);
  const aad = envelope.slice(0, headerEnd);

  if (ciphertext.length !== plaintextSize) {
    throw new BackupCryptoError(
      'size_mismatch',
      'Header plaintext size does not match the ciphertext length'
    );
  }

  const validatedHeader: BackupEnvelopeHeader = {
    version: 1,
    kdf: {
      name: 'argon2id',
      m: kdfCost.m,
      t: kdfCost.t,
      p: kdfCost.p,
      dkLen: kdfCost.dkLen,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: 'AES-256-GCM',
      nonce: bytesToBase64(nonce),
      tagLength: 16,
    },
    context,
    plaintext: {
      sha256: plaintextSha256,
      size: plaintextSize,
    },
  };

  return {
    header: validatedHeader,
    aad,
    ciphertext,
    tag,
  };
};

export const sealEnvelope = async (input: SealEnvelopeInput): Promise<Uint8Array> => {
  if (!(input.plaintext instanceof Uint8Array)) {
    throw new BackupCryptoError('invalid_header', 'Plaintext must be bytes');
  }

  assertKey(input.key);
  assertSalt(input.kdfSalt);

  if (typeof input.randomBytes !== 'function') {
    throw new BackupCryptoError('invalid_cipher', 'A secure random source is required');
  }

  const cost = assertKdfCost(input.kdfCost ?? DEFAULT_BACKUP_KDF_COST);
  const context = assertContext(input.context);
  const nonce = input.nonce ?? input.randomBytes(GCM_NONCE_BYTES);

  assertByteLength(nonce, GCM_NONCE_BYTES, 'invalid_cipher', 'GCM nonce');
  const plaintextSha256 = sha256Hex(input.plaintext);

  const header: BackupEnvelopeHeader = {
    version: 1,
    kdf: {
      name: 'argon2id',
      m: cost.m,
      t: cost.t,
      p: cost.p,
      dkLen: cost.dkLen,
      salt: bytesToBase64(input.kdfSalt),
    },
    cipher: {
      name: 'AES-256-GCM',
      nonce: bytesToBase64(nonce),
      tagLength: 16,
    },
    context,
    plaintext: {
      sha256: plaintextSha256,
      size: input.plaintext.length,
    },
  };

  const headerBytes = utf8Encode(JSON.stringify(header));
  if (headerBytes.length > MAX_HEADER_BYTES) {
    throw new BackupCryptoError('invalid_header', 'Header is too large');
  }

  const prefix = new Uint8Array(ENVELOPE_PREFIX_BYTES);
  prefix.set(MAGIC_BYTES, 0);
  writeUint32BE(headerBytes.length, prefix, 4);

  const aad = concatBytes(prefix, headerBytes);
  const { ciphertext, tag } = await input.aes.encrypt({
    key: input.key,
    nonce,
    plaintext: input.plaintext,
    aad,
  });

  if (ciphertext.length !== input.plaintext.length) {
    throw new BackupCryptoError(
      'invalid_cipher',
      'GCM ciphertext length does not match the plaintext length'
    );
  }
  assertByteLength(tag, GCM_TAG_BYTES, 'invalid_cipher', 'GCM authentication tag');

  return concatBytes(aad, ciphertext, tag);
};

export const openEnvelope = async (
  input: OpenEnvelopeInput
): Promise<OpenEnvelopeResult> => {
  assertKey(input.key);
  const parsed = parseEnvelope(input.envelope);

  if (
    input.expectedContext &&
    !contextsMatch(assertContext(input.expectedContext), parsed.header.context)
  ) {
    throw new BackupCryptoError(
      'invalid_context',
      'Envelope belongs to a different user, case or evidence item'
    );
  }

  const nonce = base64ToBytes(parsed.header.cipher.nonce);

  let plaintext: Uint8Array;
  try {
    plaintext = await input.aes.decrypt({
      key: input.key,
      nonce,
      ciphertext: parsed.ciphertext,
      tag: parsed.tag,
      aad: parsed.aad,
    });
  } catch {
    // Wrong passphrase, modified header or modified ciphertext all land here.
    // Never leak which one it was.
    throw new BackupCryptoError(
      'authentication_failed',
      'Decryption failed: wrong passphrase or corrupted backup'
    );
  }

  if (plaintext.length !== parsed.header.plaintext.size) {
    throw new BackupCryptoError(
      'size_mismatch',
      'Decrypted size does not match the authenticated header'
    );
  }

  const actualSha256 = sha256Hex(plaintext);
  if (actualSha256 !== parsed.header.plaintext.sha256) {
    throw new BackupCryptoError(
      'hash_mismatch',
      'Decrypted data does not match its authenticated SHA-256'
    );
  }

  return {
    plaintext,
    header: parsed.header,
  };
};

/**
 * Remove the envelope header without decrypting. Useful for showing safe
 * metadata or deriving the key before a full decrypt on restore.
 */
export const readEnvelopeHeader = (envelope: Uint8Array): BackupEnvelopeHeader =>
  parseEnvelope(envelope).header;
