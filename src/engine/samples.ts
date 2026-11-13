// Samples are audio files, often megabytes, so they live in IndexedDB rather
// than in the piece's JSON (localStorage holds about 5 MB in all). A piece
// refers to each sample by an id made from its bytes, so loading the same file
// twice stores it once. When IndexedDB is unavailable (private windows, tests)
// samples still work for the session, from memory.

const DB = 'pulse-canvas';
const STORE = 'samples';
export const MAX_SAMPLE_BYTES = 20 * 1024 * 1024;

export interface SampleRef {
  id: string;
  name: string;
}

const memory = new Map<string, ArrayBuffer>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

async function contentId(bytes: ArrayBuffer) {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return `smp-${[...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  let h = 0x811c9dc5;
  for (const b of new Uint8Array(bytes)) h = Math.imul(h ^ b, 0x01000193);
  return `smp-${(h >>> 0).toString(16)}`;
}

/** Keeps a sample's bytes for later sessions, returning the id they hash to. Throws if too big. */
export async function storeSampleBytes(bytes: ArrayBuffer): Promise<string> {
  if (bytes.byteLength > MAX_SAMPLE_BYTES) throw new Error(`it's over ${MAX_SAMPLE_BYTES / 1024 / 1024} MB.`);
  const id = await contentId(bytes);
  memory.set(id, bytes);
  try {
    await withStore('readwrite', (s) => s.put(bytes, id));
  } catch (err) {
    console.warn('Sample kept for this session only:', err);
  }
  return id;
}

/** Keeps an audio file for later sessions. Throws if it's too big. */
export async function storeSample(file: File): Promise<SampleRef> {
  if (file.size > MAX_SAMPLE_BYTES) throw new Error(`it's over ${MAX_SAMPLE_BYTES / 1024 / 1024} MB.`);
  return { id: await storeSampleBytes(await file.arrayBuffer()), name: file.name };
}

/** The stored bytes of a sample, or undefined if this browser no longer has it. */
export async function loadSampleBytes(id: string): Promise<ArrayBuffer | undefined> {
  const cached = memory.get(id);
  if (cached) return cached;
  try {
    const bytes = await withStore<ArrayBuffer | undefined>('readonly', (s) => s.get(id));
    if (bytes) memory.set(id, bytes);
    return bytes;
  } catch {
    return undefined;
  }
}
