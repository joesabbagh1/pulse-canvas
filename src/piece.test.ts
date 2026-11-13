import { describe, expect, it } from 'vitest';
import { DEFAULT_FX, DEFAULT_MIX, toneHz } from './engine/mixer';
import { ROOT_HZ, SCALES, type Tuning } from './engine/tuning';
import {
  bendsCarriedBy,
  carryBends,
  isRegion,
  regionNode,
  toBuses,
  toEdges,
  toGraph,
  toNodes,
  toPiece,
  type BlockNode,
  type LinkEdge,
} from './piece';

const link = (id: string, source: string, target: string, bends = [{ x: 50, y: 50 }]): LinkEdge => ({
  id,
  type: 'link',
  source,
  target,
  data: { bends },
});

describe('bends', () => {
  it('move with a link only when both of its blocks are dragged together', () => {
    const edges = [link('ab', 'a', 'b'), link('bc', 'b', 'c'), link('ca', 'c', 'a', [])];
    const carried = bendsCarriedBy(edges, new Set(['a', 'b']));
    expect([...carried.keys()]).toEqual(['ab']);
    // Offsets are from the drag start, so repeated drag events don't add up.
    const once = carryBends(edges, carried, 10, -5);
    const [ab, bc] = carryBends(once, carried, 10, -5);
    expect(ab.data!.bends).toEqual([{ x: 60, y: 45 }]);
    expect(bc).toBe(edges[1]);
  });

  it('are saved only on links that have them, and load back', () => {
    const settings = { bpm: 100, snap: true, scaleId: 'x', rootHz: ROOT_HZ, scales: [] };
    const piece = toPiece([], [link('ab', 'a', 'b'), link('bc', 'b', 'c', [])], settings);
    expect(piece.links).toEqual([
      { id: 'ab', from: 'a', to: 'b', bends: [{ x: 50, y: 50 }] },
      { id: 'bc', from: 'b', to: 'c' },
    ]);
    expect(toEdges(piece).map((e) => e.data!.bends)).toEqual([[{ x: 50, y: 50 }], []]);
  });
});

describe('regions and scales', () => {
  const imported = { id: 'scl-test', name: 'Test', cents: [0, 150], period: 1200 };
  const block = (id: string, x: number): BlockNode => ({
    id,
    type: 'block',
    position: { x, y: 0 },
    data: { kind: 'tone', degree: 1, every: 0 },
  });
  const nodes = [
    regionNode('r', { x: -100, y: -100, w: 200, h: 200 }, { name: 'R', scaleId: 'scl-test', rootHz: ROOT_HZ }),
    block('in', 0),
    block('out', 500),
  ];

  it('blocks play in their region scale and through its bus, and the canvas ones elsewhere', () => {
    const graph = toGraph(nodes, { scale: SCALES[0], rootHz: ROOT_HZ } satisfies Tuning, [...SCALES, imported]);
    expect(graph.map((b) => [b.id, b.scale.id, b.bus])).toEqual([
      ['in', 'scl-test', 'r'],
      ['out', SCALES[0].id, undefined],
    ]);
  });

  it('regions and imported scales survive a save and load', () => {
    const piece = toPiece(nodes, [], { bpm: 100, snap: true, scaleId: SCALES[0].id, rootHz: ROOT_HZ, scales: [imported] });
    expect(piece.regions).toEqual([
      { id: 'r', x: -100, y: -100, w: 200, h: 200, name: 'R', scaleId: 'scl-test', rootHz: ROOT_HZ, mix: DEFAULT_MIX, fx: DEFAULT_FX },
    ]);
    expect(piece.scales).toEqual([imported]);
    expect(toPiece(toNodes(piece), [], piece)).toEqual(piece);
  });
});

describe('code', () => {
  it('is saved on blocks and links that have it, and loads back', () => {
    const settings = { bpm: 100, snap: true, scaleId: SCALES[0].id, rootHz: ROOT_HZ, scales: [] };
    const nodes: BlockNode[] = [
      { id: 'a', type: 'block', position: { x: 0, y: 0 }, data: { kind: 'tone', degree: 0, every: 0, code: 'route cycle' } },
      { id: 'b', type: 'block', position: { x: 1, y: 0 }, data: { kind: 'tone', degree: 0, every: 0, code: '' } },
    ];
    const edges: LinkEdge[] = [{ id: 'ab', type: 'link', source: 'a', target: 'b', data: { bends: [], code: 'delay 1' } }];
    const piece = toPiece(nodes, edges, settings);
    expect(piece.blocks.map((b) => b.code)).toEqual(['route cycle', undefined]);
    expect(piece.links[0].code).toBe('delay 1');
    expect(toPiece(toNodes(piece), toEdges(piece), settings)).toEqual(piece);
  });
});

describe('region mix and effects', () => {
  it('default for regions saved before they existed, keeping any effects that were set', () => {
    const [old] = toNodes({
      version: 1,
      bpm: 100,
      snap: true,
      scaleId: SCALES[0].id,
      rootHz: ROOT_HZ,
      scales: [],
      blocks: [],
      links: [],
      regions: [{ id: 'r', x: 0, y: 0, w: 100, h: 100, name: 'Old', scaleId: SCALES[0].id, rootHz: ROOT_HZ, fx: { echo: 0.5 } }],
    });
    expect(isRegion(old) && old.data).toMatchObject({ mix: DEFAULT_MIX, fx: { ...DEFAULT_FX, echo: 0.5 } });
  });

  it('reach the engine as one bus per region, naming its sample', () => {
    const r = regionNode('r', { x: 0, y: 0, w: 100, h: 100 }, {
      name: 'R',
      scaleId: SCALES[0].id,
      rootHz: ROOT_HZ,
      mix: { level: -6, pan: 0.5, mute: true },
      sample: { id: 'smp-1', name: 'bell.wav' },
    });
    expect([...toBuses([r])]).toEqual([['r', { mix: { level: -6, pan: 0.5, mute: true }, fx: DEFAULT_FX, sample: 'smp-1' }]]);
  });

  it('map the tone control from a dark 200 Hz to an open 20 kHz', () => {
    expect(toneHz(0)).toBeCloseTo(200);
    expect(toneHz(0.5)).toBeCloseTo(2000);
    expect(toneHz(1)).toBeCloseTo(20000);
  });
});
