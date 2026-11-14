import { loadSampleBytes, storeSampleBytes } from './engine/samples';
import type { Piece } from './piece';
import { readPiece } from './readPiece';

// Two ways a piece leaves this browser:
//
// - A link carries the whole piece in its #fragment: JSON, deflated, then
//   base64url. Fragments never reach a server, so nothing is uploaded, but
//   they can't hold audio either: samples stay behind, and whoever opens the
//   link hears the synth in their place.
// - A file carries the piece and its samples' bytes, so it opens complete.
//
// Both come back through readPiece, since a link or file can come from anyone.

const HASH = 'piece';
/** No shared piece decompresses past this, however small its link. */
const MAX_PIECE_BYTES = 5 * 1024 * 1024;
const FILE_FORMAT = 'pulse-canvas';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string) {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string) => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'));

/** Runs bytes through a (de)compression stream, giving up past `limit` bytes out. */
async function pipe(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream, limit = Infinity) {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = input.pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('the shared piece is too big.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// The code starts with its format: "1." is deflated, "0." plain, for browsers
// without CompressionStream.
export async function encodeShare(piece: Piece): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(piece));
  if (typeof CompressionStream === 'undefined') return `0.${toBase64Url(json)}`;
  return `1.${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

/** Throws an Error saying what is wrong with the code. */
export async function decodeShare(code: string): Promise<Piece> {
  const [format, data] = code.split('.');
  if (!data || (format !== '0' && format !== '1')) throw new Error("the link is incomplete, or from a newer version.");
  let json: Uint8Array;
  try {
    const bytes = fromBase64Url(data);
    json = format === '1' ? await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_PIECE_BYTES) : bytes;
  } catch (err) {
    throw (err as Error).message.includes('too big') ? err : new Error('the link is damaged; it may have been cut short.');
  }
  if (json.length > MAX_PIECE_BYTES) throw new Error('the shared piece is too big.');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new Error('the link is damaged; it may have been cut short.');
  }
  return readPiece(raw);
}

export function shareUrl(code: string, base: string = location.href) {
  const url = new URL(base);
  url.hash = `${HASH}=${code}`;
  return url.toString();
}

/** The share code in a URL fragment, if there is one. */
export function sharedCode(hash: string): string | null {
  const match = new RegExp(`^#${HASH}=(.+)$`).exec(hash);
  return match ? match[1] : null;
}

/** The piece with every sample it uses, as a file to download. */
export async function pieceToFile(piece: Piece): Promise<Blob> {
  const samples: Record<string, string> = {};
  const used = [
    ...piece.regions.map((region) => region.sample?.id),
    piece.bed?.sample.id,
  ];
  for (const id of used) {
    if (!id || id in samples) continue;
    const bytes = await loadSampleBytes(id);
    if (bytes) samples[id] = toBase64(new Uint8Array(bytes));
  }
  return new Blob([JSON.stringify({ format: FILE_FORMAT, version: 1, piece, samples })], { type: 'application/json' });
}

/**
 * Reads a saved file (or a bare piece), storing its samples in this browser.
 * Each sample is stored under the id its bytes hash to, so a file can't plant
 * bytes under another sample's name.
 */
export async function pieceFromFile(text: string): Promise<Piece> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("it isn't a Pulse Canvas file.");
  }
  const file = isObject(raw) && raw.format === FILE_FORMAT ? raw : null;
  const piece = readPiece(file ? file.piece : raw);
  const ids = new Map<string, string>();
  if (file && isObject(file.samples)) {
    for (const [named, data] of Object.entries(file.samples)) {
      if (typeof data !== 'string') continue;
      try {
        const bytes = fromBase64(data);
        ids.set(named, await storeSampleBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
      } catch (err) {
        console.warn(`Sample ${named} in the file was skipped:`, err);
      }
    }
  }
  const bedId = piece.bed && ids.get(piece.bed.sample.id);
  return {
    ...piece,
    regions: piece.regions.map((r) => {
      const id = r.sample && ids.get(r.sample.id);
      return id && r.sample ? { ...r, sample: { ...r.sample, id } } : r;
    }),
    ...(piece.bed && bedId ? { bed: { ...piece.bed, sample: { ...piece.bed.sample, id: bedId } } } : {}),
  };
}

/** Saves a blob through the browser's download. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A file name with the date and time, e.g. pulse-canvas-2026-11-13-0045.json. */
export function datedName(ext: string, now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `pulse-canvas-${stamp}.${ext}`;
}
