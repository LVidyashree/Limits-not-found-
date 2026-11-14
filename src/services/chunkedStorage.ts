// Secure, chunked key-value storage.
//
// expo-secure-store rejects values larger than ~2 KB, while a Supabase
// session (JWT + refresh token + user object) is usually larger than
// that. This adapter transparently splits each value into chunks and
// stores the chunk count alongside them.
//
// It is written against a tiny storage interface so the chunking logic
// can be unit-tested without the native module.

export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Keep chunks comfortably below SecureStore's ~2 KB limit even when the
// value contains multi-byte UTF-8 characters (e.g. a name with accents).
const DEFAULT_CHUNK_BYTES = 1800;

const utf8Length = (char: string): number => {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

// Splits on code-point boundaries so surrogate pairs are never broken.
const splitByBytes = (value: string, maxBytes: number): string[] => {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of value) {
    const bytes = utf8Length(char);
    if (currentBytes + bytes > maxBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }

  if (current.length > 0 || chunks.length === 0) chunks.push(current);
  return chunks;
};

export const createChunkedStorage = (
  store: KeyValueStore,
  chunkBytes: number = DEFAULT_CHUNK_BYTES
): AsyncStorageLike => {
  if (chunkBytes <= 0) {
    throw new Error('chunkBytes must be greater than zero');
  }

  const countKey = (key: string) => `${key}.chunks`;
  const chunkKey = (key: string, index: number) => `${key}.chunk.${index}`;

  const removeItem = async (key: string): Promise<void> => {
    const rawCount = await store.getItemAsync(countKey(key));
    const count = rawCount === null ? 0 : Number.parseInt(rawCount, 10);

    if (Number.isFinite(count) && count > 0) {
      for (let i = 0; i < count; i += 1) {
        await store.deleteItemAsync(chunkKey(key, i));
      }
    }

    await store.deleteItemAsync(countKey(key));
  };

  const getItem = async (key: string): Promise<string | null> => {
    const rawCount = await store.getItemAsync(countKey(key));
    if (rawCount === null) return null;

    const count = Number.parseInt(rawCount, 10);
    if (!Number.isFinite(count) || count < 0) return null;

    let value = '';
    for (let i = 0; i < count; i += 1) {
      const part = await store.getItemAsync(chunkKey(key, i));
      if (part === null) return null;
      value += part;
    }
    return value;
  };

  const setItem = async (key: string, value: string): Promise<void> => {
    await removeItem(key);

    const chunks = splitByBytes(value, chunkBytes);

    for (let i = 0; i < chunks.length; i += 1) {
      await store.setItemAsync(chunkKey(key, i), chunks[i]);
    }
    await store.setItemAsync(countKey(key), String(chunks.length));
  };

  return { getItem, setItem, removeItem };
};
