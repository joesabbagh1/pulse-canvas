import type { Edge, Node } from '@xyflow/react';
import { BLOCK_SIZE, PX_PER_BEAT, patternFrame, spanOf, type XY } from './engine/geometry';
import { backbeat, phraseLoop } from './melody';
import { DEFAULT_FX, DEFAULT_MIX, type BusSettings, type Fx, type Mix } from './engine/mixer';
import { DEFAULT_GROOVE, type Groove } from './engine/groove';
import type { SampleRef } from './engine/samples';
import type { BlockKind, GraphBlock, GraphLink } from './engine/scheduler';
import { DEFAULT_SCALE_ID, ROOT_HZ, scaleById, type Scale, type Tuning } from './engine/tuning';
import type { Wave } from './engine/wave';
import type { Take } from './takes';
import { readPiece } from './readPiece';
import { REGION_Z, regionAt } from './regions';

// A piece is plain JSON: blocks, links, regions and global settings. This is
// the shape that gets saved, and later shared by link.

/** `code` is a script run on each pulse through the block or link (see engine/script.ts). */
/** `key` is a performance key: pressing it fires the block (start blocks only). */
/**
 * `pattern` makes it a pattern block: a box `beats` long that plays the
 * pattern across its length each time a pulse goes through (see engine/pattern.ts).
 */
export type BlockData = { kind: BlockKind; degree: number; every: number; code?: string; key?: string; pattern?: string; beats?: number };
export type BlockNode = Node<BlockData, 'block'>;
/**
 * A rectangle of canvas with its own tuning, mix, effects, groove and sample,
 * for the blocks inside it. `key` is a performance key that mutes and unmutes it.
 */
export type RegionData = {
  name: string;
  scaleId: string;
  rootHz: number;
  mix: Mix;
  fx: Fx;
  groove: Groove;
  sample?: SampleRef;
  key?: string;
};
/** A region as written by hand or saved before mixes existed: mix, effects and groove default. */
export type RegionInit = Omit<RegionData, 'mix' | 'fx' | 'groove'> & { mix?: Mix; fx?: Partial<Fx>; groove?: Partial<Groove> };
export type RegionNode = Node<RegionData, 'region'>;
export type CanvasNode = BlockNode | RegionNode;
/** Bend points are canvas positions, in order from source to target. */
export type LinkData = { bends: XY[]; code?: string };
export type LinkEdge = Edge<LinkData, 'link'>;

export interface Settings {
  bpm: number;
  snap: boolean;
  /** The scale outside every region, and the frequency of its degree 0. */
  scaleId: string;
  rootHz: number;
  /** Scales imported into this piece, kept with it so it plays the same anywhere. */
  scales: Scale[];
}

export interface Piece extends Settings {
  version: 1;
  blocks: ({ id: string; x: number; y: number } & BlockData)[];
  links: { id: string; from: string; to: string; bends?: XY[]; code?: string }[];
  /** x and y are the top-left corner. */
  regions: ({ id: string; x: number; y: number; w: number; h: number } & RegionInit)[];
  /**
   * Drawn synth shapes. Absent on pieces saved before waves existed; readers
   * fill in `[]`.
   */
  waves?: Wave[];
  /**
   * Performances recorded on the Instruments page. Absent on pieces saved
   * before takes existed; readers fill in `[]`.
   */
  takes?: Take[];
}

const STORAGE_KEY = 'pulse-canvas:piece:v1';

export function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export const isBlock = (n: CanvasNode): n is BlockNode => n.type === 'block';
export const isRegion = (n: CanvasNode): n is RegionNode => n.type === 'region';

// Regions sit behind everything and let clicks through to the canvas, except
// on their name tab (which drags them) and their resize handles.
export function regionNode(id: string, rect: { x: number; y: number; w: number; h: number }, init: RegionInit): RegionNode {
  const data: RegionData = {
    ...init,
    mix: init.mix ?? DEFAULT_MIX,
    fx: { ...DEFAULT_FX, ...init.fx },
    groove: { ...DEFAULT_GROOVE, ...init.groove },
  };
  return {
    id,
    type: 'region',
    position: { x: rect.x, y: rect.y },
    origin: [0, 0],
    width: rect.w,
    height: rect.h,
    zIndex: REGION_Z,
    dragHandle: '.region-tab',
    style: { pointerEvents: 'none' },
    data,
  };
}

export function toNodes(piece: Piece): CanvasNode[] {
  return [
    ...piece.regions.map(({ id, x, y, w, h, ...data }) => regionNode(id, { x, y, w, h }, data)),
    ...piece.blocks.map(({ id, x, y, kind, degree, every, code, key, pattern, beats }): BlockNode => {
      const data = {
        kind,
        degree,
        every,
        ...(code ? { code } : {}),
        ...(key ? { key } : {}),
        ...(pattern !== undefined ? { pattern, beats: spanOf({ pattern, beats }) } : {}),
      };
      return { id, type: 'block', position: { x, y }, data, ...(patternFrame(data) ?? {}) };
    }),
  ];
}

export function toEdges(piece: Piece): LinkEdge[] {
  return piece.links.map(({ id, from, to, bends, code }) => ({
    id,
    type: 'link',
    source: from,
    target: to,
    data: { bends: bends ?? [], ...(code ? { code } : {}) },
  }));
}

export function bendsOf(edge: LinkEdge): XY[] {
  return edge.data?.bends ?? [];
}

export function toPiece(
  nodes: CanvasNode[],
  edges: LinkEdge[],
  settings: Settings & { takes?: Take[] },
  waves: Wave[] = [],
  takes?: Take[],
): Piece {
  return {
    version: 1,
    ...settings,
    blocks: nodes.filter(isBlock).map(({ id, position, data: { code, key, ...data } }) => ({
      id,
      x: position.x,
      y: position.y,
      ...data,
      ...(code ? { code } : {}),
      ...(key ? { key } : {}),
    })),
    regions: nodes.filter(isRegion).map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      w: n.width ?? n.measured?.width ?? 0,
      h: n.height ?? n.measured?.height ?? 0,
      ...n.data,
    })),
    links: edges.map((e) => {
      const bends = bendsOf(e);
      const code = e.data?.code;
      return { id: e.id, from: e.source, to: e.target, ...(bends.length ? { bends } : {}), ...(code ? { code } : {}) };
    }),
    waves,
    takes: takes ?? settings.takes ?? [],
  };
}

// Bends belong to the canvas, so moving one block reshapes its links. When
// both ends of a link are dragged together, though (a selection), its bends
// come along, so a loop moved as a whole keeps its rhythm.

/** The bends of links with both blocks among `moving`, by link id. */
export function bendsCarriedBy(edges: LinkEdge[], moving: Set<string>): Map<string, XY[]> {
  const carried = new Map<string, XY[]>();
  for (const e of edges) {
    if (moving.has(e.source) && moving.has(e.target) && bendsOf(e).length) carried.set(e.id, bendsOf(e));
  }
  return carried;
}

/** Puts each carried link's bends back at their original spots, shifted by (dx, dy). */
export function carryBends(edges: LinkEdge[], carried: Map<string, XY[]>, dx: number, dy: number): LinkEdge[] {
  return edges.map((e) => {
    const bends = carried.get(e.id);
    return bends ? { ...e, data: { ...e.data, bends: bends.map((p) => ({ x: p.x + dx, y: p.y + dy })) } } : e;
  });
}

/** The tuning of a region, or of the canvas outside every region. */
export function regionTuning(region: RegionNode | undefined, canvas: Tuning, library: readonly Scale[]): Tuning {
  return region ? { scale: scaleById(region.data.scaleId, library), rootHz: region.data.rootHz } : canvas;
}

/** The tuning a block at `at` plays in: its region's, or else the canvas's. */
export function tuningAt(nodes: readonly CanvasNode[], at: XY, canvas: Tuning, library: readonly Scale[]): Tuning {
  return regionTuning(regionAt(nodes, at), canvas, library);
}

export function toGraph(nodes: CanvasNode[], canvas: Tuning, library: readonly Scale[]): GraphBlock[] {
  return nodes.filter(isBlock).map((n) => {
    const region = regionAt(nodes, n.position);
    return { id: n.id, x: n.position.x, y: n.position.y, ...n.data, ...regionTuning(region, canvas, library), bus: region?.id };
  });
}

/** Each region's mix, effects and sample, for the engine. */
export function toBuses(nodes: CanvasNode[]): Map<string, BusSettings> {
  return new Map(
    nodes.filter(isRegion).map((r) => [r.id, { mix: r.data.mix, fx: r.data.fx, groove: r.data.groove, sample: r.data.sample?.id }]),
  );
}

export function toGraphLinks(edges: LinkEdge[]): GraphLink[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target, bends: bendsOf(e), code: e.data?.code }));
}

/** Whether this browser has a saved piece, as opposed to a first visit. */
export function hasSavedPiece() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadPiece(): Piece {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return readPiece(JSON.parse(saved));
  } catch {
    // Unreadable storage, or not a piece: fall through to the tour.
  }
  return demoPiece();
}

export function savePiece(piece: Piece) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(piece));
  } catch {
    // Storage full or blocked; the canvas keeps working without it.
  }
}

export function emptyPiece(settings: Settings): Piece {
  return {
    version: 1,
    ...settings,
    blocks: [{ id: 'start', x: 0, y: 0, kind: 'start', degree: 0, every: 0 }],
    links: [],
    regions: [],
    waves: [],
    takes: [],
  };
}

// The first patch anyone sees, and the tour on the examples page: a 2-beat
// drum line against a 3¾-beat melody folded around a rectangle, so the two
// loops drift against each other. The snare branches off the kick and rejoins
// on the backbeat. A bass note hangs off the melody. The melody sits in a
// Maqam Rast region with its own echo, panned a little left, so it plays
// quarter tones while the bass stays pentatonic, and a little code varies each
// part (none of it in a loop, where a transpose or delay would add up on
// every pass).
export function demoPiece(): Piece {
  const mel = phraseLoop('mel', 180, -20, [
    { degree: 0, beats: 0.75 },
    { degree: 2, beats: 0.75 },
    { degree: 4, beats: 0.75 },
    { degree: 3, beats: 0.75 },
    { degree: 1, beats: 0.75 },
  ]);
  const drums = backbeat(-460, -260, 'chance 30%: mute  # ghost notes');
  const m1 = mel.blocks[0];
  const melody = mel.blocks;
  const xs = melody.map((b) => b.x);
  const ys = melody.map((b) => b.y);
  const [rx, ry] = [Math.min(...xs) - BLOCK_SIZE, Math.min(...ys) - BLOCK_SIZE];

  return {
    version: 1,
    bpm: 112,
    snap: true,
    scaleId: DEFAULT_SCALE_ID,
    rootHz: ROOT_HZ,
    scales: [],
    blocks: [
      { id: 'start', x: -640, y: 0, kind: 'start', degree: 0, every: 0 },
      ...drums.blocks,
      ...mel.blocks,
      {
        id: 'bass',
        x: m1.x - PX_PER_BEAT,
        y: m1.y + PX_PER_BEAT,
        kind: 'bass',
        degree: -5,
        every: 0,
        code: 'every 2: transpose +2  # a two-note bass line',
      },
    ],
    links: [
      { id: 'start>kick', from: 'start', to: 'kick' },
      ...drums.links,
      { id: 'start>mel-1', from: 'start', to: mel.first },
      ...mel.links,
      { id: 'mel-1>bass', from: 'mel-1', to: 'bass', code: 'every 4: delay 1/2  # push every 4th bass note late' },
    ],
    waves: [],
    regions: [
      {
        id: 'maqam',
        name: 'Maqam',
        scaleId: 'rast',
        rootHz: ROOT_HZ,
        mix: { level: -2, pan: -0.3, mute: false },
        fx: { echo: 0.3, echoBeats: 0.75 },
        x: rx,
        y: ry,
        w: Math.max(...xs) + BLOCK_SIZE - rx,
        h: Math.max(...ys) + BLOCK_SIZE - ry,
      },
    ],
  };
}
