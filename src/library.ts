import { demoPiece, newId, type Piece } from './piece';
import { readPiece } from './readPiece';

// Every canvas in this browser. The piece currently open is also written to
// the old single-piece slot, so a save from before this list still opens.

const LIBRARY_KEY = 'pulse-canvas:library:v1';
const PIECE_KEY = 'pulse-canvas:piece:v1';
export const MAX_CANVASES = 40;

export interface SavedCanvas {
  id: string;
  name: string;
  updatedAt: number;
  piece: Piece;
}

export interface LibraryFile {
  currentId: string;
  canvases: SavedCanvas[];
}

export interface OpenShelf {
  current: Piece;
  currentId: string;
  canvases: SavedCanvas[];
  /** A piece or a library was already stored. A shared link should ask first. */
  existed: boolean;
}

const NAME_MAX = 80;

export function canvasName(value: unknown, fallback = 'Canvas') {
  const name = typeof value === 'string' ? value.trim().slice(0, NAME_MAX) : '';
  return name || fallback;
}

export function nextCanvasName(canvases: readonly { name: string }[]) {
  const taken = new Set(canvases.map((canvas) => canvas.name));
  if (!taken.has('Canvas')) return 'Canvas';
  for (let n = 2; n < 1000; n++) {
    const name = `Canvas ${n}`;
    if (!taken.has(name)) return name;
  }
  return 'Canvas';
}

function pieceIn(storage: Storage): Piece | null {
  try {
    const saved = storage.getItem(PIECE_KEY);
    if (!saved) return null;
    return readPiece(JSON.parse(saved));
  } catch {
    return null;
  }
}

function readCanvas(value: unknown): SavedCanvas | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Partial<SavedCanvas>;
  if (typeof row.id !== 'string' || !row.id) return null;
  try {
    return {
      id: row.id,
      name: canvasName(row.name),
      updatedAt: typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
      piece: readPiece(row.piece),
    };
  } catch {
    return null;
  }
}

export function readLibrary(storage: Storage): LibraryFile | null {
  try {
    const raw = storage.getItem(LIBRARY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<LibraryFile>;
    if (!Array.isArray(data.canvases)) return null;
    const canvases = data.canvases.map(readCanvas).filter((canvas): canvas is SavedCanvas => !!canvas);
    if (!canvases.length) return null;
    const currentId = canvases.some((canvas) => canvas.id === data.currentId) ? (data.currentId as string) : canvases[0].id;
    return { currentId, canvases };
  } catch {
    return null;
  }
}

export function writeLibrary(storage: Storage, file: LibraryFile) {
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(file));
    const current = file.canvases.find((canvas) => canvas.id === file.currentId);
    if (current) storage.setItem(PIECE_KEY, JSON.stringify(current.piece));
  } catch {
    // Storage full or blocked; the open canvas keeps working without the list.
  }
}

/** The list, or one canvas wrapped around whatever this browser already had. */
export function openLibrary(storage: Storage, now = Date.now()): OpenShelf {
  const existing = readLibrary(storage);
  if (existing) {
    const current = existing.canvases.find((canvas) => canvas.id === existing.currentId) ?? existing.canvases[0];
    writeLibrary(storage, existing);
    return { current: current.piece, currentId: current.id, canvases: existing.canvases, existed: true };
  }
  const saved = pieceIn(storage);
  const piece = saved ?? demoPiece();
  const canvas: SavedCanvas = { id: newId('c'), name: 'Canvas', updatedAt: now, piece };
  const file = { currentId: canvas.id, canvases: [canvas] };
  writeLibrary(storage, file);
  return { current: piece, currentId: canvas.id, canvases: [canvas], existed: !!saved };
}

export function withCurrentPiece(file: LibraryFile, piece: Piece, now = Date.now()): LibraryFile {
  return {
    currentId: file.currentId,
    canvases: file.canvases.map((canvas) => (canvas.id === file.currentId ? { ...canvas, piece, updatedAt: now } : canvas)),
  };
}

export function addCanvas(file: LibraryFile, fresh: Piece, now = Date.now(), name?: string): LibraryFile | null {
  if (file.canvases.length >= MAX_CANVASES) return null;
  const fallback = nextCanvasName(file.canvases);
  const canvas: SavedCanvas = { id: newId('c'), name: name === undefined ? fallback : canvasName(name, fallback), updatedAt: now, piece: fresh };
  return { currentId: canvas.id, canvases: [canvas, ...file.canvases] };
}

export function renameInLibrary(file: LibraryFile, id: string, name: string): LibraryFile {
  const next = canvasName(name);
  return { ...file, canvases: file.canvases.map((canvas) => (canvas.id === id ? { ...canvas, name: next } : canvas)) };
}

/**
 * Drops one canvas. The last one is replaced by an empty piece, so the list
 * is never empty. `opened` is the piece to show when the current canvas was
 * the one removed.
 */
export function removeFromLibrary(file: LibraryFile, id: string, empty: Piece, now = Date.now()): { file: LibraryFile; opened: Piece | null } {
  const remaining = file.canvases.filter((canvas) => canvas.id !== id);
  if (!remaining.length) {
    const canvas: SavedCanvas = { id: newId('c'), name: 'Canvas', updatedAt: now, piece: empty };
    return { file: { currentId: canvas.id, canvases: [canvas] }, opened: id === file.currentId ? empty : null };
  }
  const currentId = id === file.currentId ? remaining[0].id : file.currentId;
  const opened = id === file.currentId ? (remaining.find((canvas) => canvas.id === currentId)?.piece ?? null) : null;
  return { file: { currentId, canvases: remaining }, opened };
}
