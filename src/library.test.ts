import { describe, expect, it } from 'vitest';
import { addCanvas, nextCanvasName, openLibrary, readLibrary, removeFromLibrary, renameInLibrary, withCurrentPiece, writeLibrary } from './library';
import { demoPiece, emptyPiece, type Piece } from './piece';

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

const blank = (): Piece => emptyPiece({ bpm: 100, snap: true, scaleId: 'major', rootHz: 261.6, scales: [] });

describe('canvas library', () => {
  it('wraps an existing saved piece as the one canvas', () => {
    const storage = memory();
    const piece = demoPiece();
    piece.bpm = 90;
    storage.setItem('pulse-canvas:piece:v1', JSON.stringify(piece));
    const shelf = openLibrary(storage, 10);
    expect(shelf.existed).toBe(true);
    expect(shelf.canvases).toHaveLength(1);
    expect(shelf.canvases[0].name).toBe('Canvas');
    expect(shelf.current.bpm).toBe(90);
    expect(readLibrary(storage)?.currentId).toBe(shelf.currentId);
  });

  it('starts a first visit with one canvas, and a second visit keeps the list', () => {
    const storage = memory();
    const first = openLibrary(storage, 10);
    expect(first.existed).toBe(false);
    expect(first.canvases).toHaveLength(1);
    const again = openLibrary(storage, 20);
    expect(again.existed).toBe(true);
    expect(again.currentId).toBe(first.currentId);
    expect(again.canvases).toHaveLength(1);
  });

  it('adds, renames, and removes canvases without dropping the others', () => {
    const storage = memory();
    const shelf = openLibrary(storage, 10);
    const file = readLibrary(storage)!;
    const second = addCanvas(file, blank(), 20)!;
    expect(second.canvases).toHaveLength(2);
    expect(second.canvases[0].name).toBe('Canvas 2');
    expect(second.currentId).toBe(second.canvases[0].id);
    expect(second.canvases[1].id).toBe(shelf.currentId);

    const named = renameInLibrary(second, second.currentId!, '  Night drive  ');
    expect(named.canvases[0].name).toBe('Night drive');

    const touched = withCurrentPiece(named, blank(), 30);
    expect(touched.canvases[0].piece.blocks).toHaveLength(1);
    expect(touched.canvases[1].piece.bpm).toBe(shelf.current.bpm);

    const removed = removeFromLibrary(touched, touched.canvases[1].id);
    expect(removed.opened).toBeNull();
    expect(removed.file.canvases.map((canvas) => canvas.name)).toEqual(['Night drive']);

    // Deleting the current canvas opens the one left; deleting the last one empties the list.
    const next = removeFromLibrary(touched, touched.currentId!);
    expect(next.opened?.bpm).toBe(shelf.current.bpm);
    expect(next.file.currentId).toBe(touched.canvases[1].id);

    const none = removeFromLibrary(removed.file, removed.file.currentId!);
    expect(none.opened).toBeNull();
    expect(none.file.canvases).toHaveLength(0);
    expect(none.file.currentId).toBeNull();

    writeLibrary(storage, none.file);
    const reopened = readLibrary(storage);
    expect(reopened?.canvases).toHaveLength(0);
    expect(reopened?.currentId).toBeNull();
  });

  it('opens an emptied library with no canvas', () => {
    const storage = memory();
    writeLibrary(storage, { currentId: null, canvases: [] });
    const shelf = openLibrary(storage, 10);
    expect(shelf.existed).toBe(true);
    expect(shelf.canvases).toHaveLength(0);
    expect(shelf.currentId).toBeNull();
  });

  it('names the next canvas from the ones already there', () => {
    expect(nextCanvasName([])).toBe('Canvas');
    expect(nextCanvasName([{ name: 'Canvas' }, { name: 'Canvas 2' }])).toBe('Canvas 3');
  });
});
