import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  BackupCryptoError,
  DEFAULT_BACKUP_KDF_COST,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  deriveBackupKey,
  hexToBytes,
  openEnvelope,
  parseEnvelope,
  readEnvelopeHeader,
  sealEnvelope,
  sha256Hex,
  utf8Decode,
  utf8Encode,
} from '../src/services/backupCryptoCore.ts';

// Fast Argon2 parameters keep the test suite quick while exercising the real
// code path. Production uses DEFAULT_BACKUP_KDF_COST.
const TEST_COST = { m: 8192, t: 1, p: 1, dkLen: 32 };
const SALT = new Uint8Array(16).fill(7);
const NONCE = new Uint8Array(12).fill(9);
const CONTEXT = {
  userId: '11111111-1111-4111-8111-111111111111',
  caseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  evidenceId: 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const aes = {
  async encrypt({ key, nonce, plaintext, aad }) {
    const cryptoKey = await webcrypto.subtle.importKey(
      'raw',
      key,
      'AES-GCM',
      false,
      ['encrypt']
    );
    const combined = new Uint8Array(
      await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
        cryptoKey,
        plaintext
      )
    );
    return {
      ciphertext: combined.slice(0, combined.length - 16),
      tag: combined.slice(combined.length - 16),
    };
  },
  async decrypt({ key, nonce, ciphertext, tag, aad }) {
    const cryptoKey = await webcrypto.subtle.importKey(
      'raw',
      key,
      'AES-GCM',
      false,
      ['decrypt']
    );
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext, 0);
    combined.set(tag, ciphertext.length);
    return new Uint8Array(
      await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
        cryptoKey,
        combined
      )
    );
  },
};

const randomBytes = (count) => new Uint8Array(count).fill(3);
const plaintext = utf8Encode('EvidenceVault backup test payload — café ☕');

const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof BackupCryptoError, `expected BackupCryptoError, got ${error}`);
    assert.equal(error.code, code);
    return true;
  });
};

test('base64 and hex round-trip arbitrary bytes', () => {
  for (let length = 0; length < 40; length += 1) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (i * 37 + length) % 256;
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
    assert.deepEqual(hexToBytes(bytesToHex(bytes)), bytes);
  }
});

test('strict base64 rejects whitespace, urlsafe and bad padding', () => {
  for (const value of [' AA==', 'AA==\n', 'AA', 'A===', 'AA-_', '****']) {
    assert.throws(() => base64ToBytes(value), BackupCryptoError);
  }
});

test('utf8 round-trips non-ASCII and astral characters', () => {
  for (const value of ['', 'plain', 'café', '☕ evidence', 'emoji 😀🔐', '日本語']) {
    assert.equal(utf8Decode(utf8Encode(value)), value);
  }
});

test('utf8 decoder rejects malformed sequences', () => {
  for (const bytes of [
    new Uint8Array([0xc0, 0x80]),
    new Uint8Array([0xe0, 0x80, 0x80]),
    new Uint8Array([0xed, 0xa0, 0x80]),
    new Uint8Array([0xf4, 0x90, 0x80, 0x80]),
    new Uint8Array([0x80]),
  ]) {
    assert.throws(() => utf8Decode(bytes), BackupCryptoError);
  }
});

test('sha256Hex matches the known digest of the empty string', () => {
  assert.equal(
    sha256Hex(new Uint8Array()),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('Argon2id key derivation is stable and salt-dependent', async () => {
  const first = await deriveBackupKey('correct horse battery staple', SALT, TEST_COST);
  const second = await deriveBackupKey('correct horse battery staple', SALT, TEST_COST);
  const otherSalt = await deriveBackupKey(
    'correct horse battery staple',
    new Uint8Array(16).fill(8),
    TEST_COST
  );
  const otherPassphrase = await deriveBackupKey('different', SALT, TEST_COST);

  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, otherSalt);
  assert.notDeepEqual(first, otherPassphrase);
});

test('Argon2id validates cost bounds and salt length', async () => {
  await expectCode(deriveBackupKey('', SALT, TEST_COST), 'passphrase_required');
  await expectCode(
    deriveBackupKey('passphrase', new Uint8Array(8), TEST_COST),
    'invalid_kdf'
  );
  await expectCode(
    deriveBackupKey('passphrase', SALT, { ...TEST_COST, m: 1 << 30 }),
    'invalid_kdf'
  );
  await expectCode(
    deriveBackupKey('passphrase', SALT, { ...TEST_COST, dkLen: 16 }),
    'invalid_kdf'
  );
});

test('seal/open round-trip authenticates and verifies the plaintext hash', async () => {
  const key = await deriveBackupKey('backup passphrase', SALT, TEST_COST);
  const envelope = await sealEnvelope({
    plaintext,
    key,
    kdfSalt: SALT,
    context: CONTEXT,
    aes,
    randomBytes,
    kdfCost: TEST_COST,
    nonce: NONCE,
  });

  assert.ok(envelope.length > plaintext.length);
  const header = readEnvelopeHeader(envelope);
  assert.equal(header.context.userId, CONTEXT.userId);
  assert.equal(header.plaintext.size, plaintext.length);
  assert.equal(header.plaintext.sha256, sha256Hex(plaintext));
  assert.equal(header.kdf.m, TEST_COST.m);

  const opened = await openEnvelope({
    envelope,
    key,
    aes,
    expectedContext: CONTEXT,
  });
  assert.deepEqual(opened.plaintext, plaintext);
  assert.equal(opened.header.plaintext.sha256, sha256Hex(plaintext));
});

test('wrong passphrase and tampered ciphertext fail authentication', async () => {
  const key = await deriveBackupKey('right passphrase', SALT, TEST_COST);
  const envelope = await sealEnvelope({
    plaintext,
    key,
    kdfSalt: SALT,
    context: CONTEXT,
    aes,
    randomBytes,
    kdfCost: TEST_COST,
    nonce: NONCE,
  });

  const wrongKey = await deriveBackupKey('wrong passphrase', SALT, TEST_COST);
  await expectCode(openEnvelope({ envelope, key: wrongKey, aes }), 'authentication_failed');

  const tamperedCiphertext = envelope.slice();
  tamperedCiphertext[tamperedCiphertext.length - 20] ^= 0x01;
  await expectCode(
    openEnvelope({ envelope: tamperedCiphertext, key, aes }),
    'authentication_failed'
  );

  const tamperedHeader = envelope.slice();
  // Flip a byte inside the JSON header. The AAD no longer matches.
  tamperedHeader[12] ^= 0x01;
  await assert.rejects(
    openEnvelope({ envelope: tamperedHeader, key, aes }),
    (error) =>
      error instanceof BackupCryptoError &&
      ['invalid_header', 'unsupported_version', 'invalid_kdf'].includes(error.code)
  );
});

test('the authenticated context prevents swapping an envelope between rows', async () => {
  const key = await deriveBackupKey('backup passphrase', SALT, TEST_COST);
  const envelope = await sealEnvelope({
    plaintext,
    key,
    kdfSalt: SALT,
    context: CONTEXT,
    aes,
    randomBytes,
    kdfCost: TEST_COST,
    nonce: NONCE,
  });

  await expectCode(
    openEnvelope({
      envelope,
      key,
      aes,
      expectedContext: {
        ...CONTEXT,
        evidenceId: 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
      },
    }),
    'invalid_context'
  );
});

test('production default cost is bounded and uses 32-byte keys', () => {
  assert.equal(DEFAULT_BACKUP_KDF_COST.dkLen, 32);
  assert.ok(DEFAULT_BACKUP_KDF_COST.m >= 19456);
  assert.ok(DEFAULT_BACKUP_KDF_COST.t >= 2);
});

test('envelope parser rejects truncation, bad magic and unsupported versions', async () => {
  const key = await deriveBackupKey('backup passphrase', SALT, TEST_COST);
  const envelope = await sealEnvelope({
    plaintext,
    key,
    kdfSalt: SALT,
    context: CONTEXT,
    aes,
    randomBytes,
    kdfCost: TEST_COST,
    nonce: NONCE,
  });

  assert.throws(() => parseEnvelope(envelope.slice(0, 10)), BackupCryptoError);

  const badMagic = envelope.slice();
  badMagic[0] = 0x00;
  assert.throws(() => parseEnvelope(badMagic), BackupCryptoError);

  const headerLength = new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength
  ).getUint32(4, false);
  const headerStart = 8;
  const header = JSON.parse(
    utf8Decode(envelope.slice(headerStart, headerStart + headerLength))
  );
  header.version = 2;
  const replacement = utf8Encode(JSON.stringify(header));
  const forged = new Uint8Array(8 + replacement.length + envelope.length - headerStart - headerLength);
  const view = new DataView(forged.buffer);
  view.setUint32(4, replacement.length, false);
  forged.set(envelope.slice(0, 4), 0);
  forged.set(replacement, 8);
  forged.set(envelope.slice(headerStart + headerLength), 8 + replacement.length);

  assert.throws(
    () => parseEnvelope(forged),
    (error) => error instanceof BackupCryptoError && error.code === 'unsupported_version'
  );
});

test('envelope parser enforces KDF, nonce, tag and size bounds', async () => {
  const key = await deriveBackupKey('backup passphrase', SALT, TEST_COST);
  const envelope = await sealEnvelope({
    plaintext,
    key,
    kdfSalt: SALT,
    context: CONTEXT,
    aes,
    randomBytes,
    kdfCost: TEST_COST,
    nonce: NONCE,
  });

  const headerLength = new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength
  ).getUint32(4, false);

  const mutateHeader = (mutator) => {
    const header = JSON.parse(
      utf8Decode(envelope.slice(8, 8 + headerLength))
    );
    mutator(header);
    const replacement = utf8Encode(JSON.stringify(header));
    const forged = new Uint8Array(8 + replacement.length + envelope.length - 8 - headerLength);
    const view = new DataView(forged.buffer);
    view.setUint32(0, 0x45564231, false);
    view.setUint32(4, replacement.length, false);
    forged.set(replacement, 8);
    forged.set(envelope.slice(8 + headerLength), 8 + replacement.length);
    return forged;
  };

  assert.throws(
    () => parseEnvelope(mutateHeader((h) => (h.kdf.m = 1 << 30))),
    (error) => error instanceof BackupCryptoError && error.code === 'invalid_kdf'
  );
  assert.throws(
    () => parseEnvelope(mutateHeader((h) => (h.kdf.dkLen = 16))),
    (error) => error instanceof BackupCryptoError && error.code === 'invalid_kdf'
  );
  assert.throws(
    () => parseEnvelope(mutateHeader((h) => (h.cipher.nonce = bytesToBase64(new Uint8Array(8))))),
    (error) => error instanceof BackupCryptoError && error.code === 'invalid_cipher'
  );
  assert.throws(
    () => parseEnvelope(mutateHeader((h) => (h.cipher.tagLength = 12))),
    (error) => error instanceof BackupCryptoError && error.code === 'invalid_cipher'
  );
  assert.throws(
    () => parseEnvelope(mutateHeader((h) => (h.plaintext.size += 1))),
    (error) => error instanceof BackupCryptoError && error.code === 'size_mismatch'
  );
  assert.throws(
    () => parseEnvelope(mutateHeader((h) => (h.context.userId = 'not-a-uuid'))),
    (error) => error instanceof BackupCryptoError && error.code === 'invalid_context'
  );
});

test('sealEnvelope rejects a short key and a bad nonce', async () => {
  await expectCode(
    sealEnvelope({
      plaintext,
      key: new Uint8Array(16),
      kdfSalt: SALT,
      context: CONTEXT,
      aes,
      randomBytes,
      kdfCost: TEST_COST,
    }),
    'invalid_key'
  );

  const key = await deriveBackupKey('backup passphrase', SALT, TEST_COST);
  await expectCode(
    sealEnvelope({
      plaintext,
      key,
      kdfSalt: SALT,
      context: CONTEXT,
      aes,
      randomBytes,
      kdfCost: TEST_COST,
      nonce: new Uint8Array(8),
    }),
    'invalid_cipher'
  );
});

test('two seals with fresh randomness use different nonces', async () => {
  const key = await deriveBackupKey('backup passphrase', SALT, TEST_COST);
  let counter = 0;
  const freshRandom = (count) => {
    counter += 1;
    return new Uint8Array(count).fill(counter);
  };

  const first = await sealEnvelope({
    plaintext,
    key,
    kdfSalt: SALT,
    context: CONTEXT,
    aes,
    randomBytes: freshRandom,
    kdfCost: TEST_COST,
  });
  const second = await sealEnvelope({
    plaintext,
    key,
    kdfSalt: SALT,
    context: CONTEXT,
    aes,
    randomBytes: freshRandom,
    kdfCost: TEST_COST,
  });

  assert.notEqual(readEnvelopeHeader(first).cipher.nonce, readEnvelopeHeader(second).cipher.nonce);
});

test('opening a truncated envelope fails cleanly', async () => {
  const key = await deriveBackupKey('backup passphrase', SALT, TEST_COST);
  const envelope = await sealEnvelope({
    plaintext,
    key,
    kdfSalt: SALT,
    context: CONTEXT,
    aes,
    randomBytes,
    kdfCost: TEST_COST,
    nonce: NONCE,
  });

  await assert.rejects(
    openEnvelope({ envelope: envelope.slice(0, envelope.length - 1), key, aes }),
    (error) =>
      error instanceof BackupCryptoError &&
      ['invalid_envelope', 'size_mismatch'].includes(error.code)
  );
});
