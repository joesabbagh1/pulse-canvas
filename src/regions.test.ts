import { describe, expect, it } from 'vitest';
import { ROOT_HZ } from './engine/tuning';
import { regionNode, type BlockNode, type CanvasNode } from './piece';
import { regionAt, regionContents } from './regions';

const region = (id: string, x: number, y: number, w: number, h: number) =>
  regionNode(id, { x, y, w, h }, { name: id, scaleId: id, rootHz: ROOT_HZ });
const block = (id: string, x: number, y: number): BlockNode => ({
  id,
  type: 'block',
  position: { x, y },
  data: { kind: 'tone', degree: 0, every: 0 },
});

describe('regions', () => {
  const outer = region('outer', 0, 0, 1000, 1000);
  const inner = region('inner', 100, 100, 300, 300);
  const straddling = region('straddling', 900, 900, 300, 300);
  const nodes: CanvasNode[] = [outer, inner, straddling, block('a', 200, 200), block('b', 600, 600), block('c', 2000, 0)];

  it('a point belongs to the smallest region around it', () => {
    expect(regionAt(nodes, { x: 200, y: 200 })?.id).toBe('inner');
    expect(regionAt(nodes, { x: 600, y: 600 })?.id).toBe('outer');
    expect(regionAt(nodes, { x: 950, y: 950 })?.id).toBe('straddling');
    expect(regionAt(nodes, { x: 2000, y: 0 })).toBeUndefined();
  });

  it('carry the blocks centred in them and the regions wholly inside them', () => {
    expect(regionContents(nodes, outer).map((n) => n.id)).toEqual(['inner', 'a', 'b']);
    expect(regionContents(nodes, inner).map((n) => n.id)).toEqual(['a']);
  });
});
