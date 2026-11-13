// "Distance is time": a link's length in canvas pixels sets how many beats a
// pulse takes to travel it. Shared by the scheduler, the link renderer and the
// pulse renderer so all three agree on where a link is and how long it takes.

export const PX_PER_BEAT = 240;
export const GRID = 0.25; // snap step, in beats
const MIN_FREE_BEATS = 1 / 16;

export const BLOCK_SIZE = 60;
export const BLOCK_R = BLOCK_SIZE / 2;
// Two straight links between the same pair of blocks (A→B and B→A) are drawn
// side by side. Once either one is bent they no longer overlap.
export const PARALLEL_OFFSET = 7;

export interface XY {
  x: number;
  y: number;
}

// A pattern block is a box as wide as its length in beats, so distance stays
// time inside it too: a pulse goes in at the left edge, crosses the box while
// the pattern plays, and comes out at the right edge. A plain block is a disc
// with no length; links meet it at its centre.
export const BOX_HEIGHT = 128;
export const PORT_R = 7;
export const MIN_SPAN = GRID;
export const MAX_SPAN = 32;
export const DEFAULT_SPAN = 2;

/** How many beats a pulse takes to cross the block: its length for a pattern block, 0 for a disc. */
export function spanOf(block: { pattern?: string; beats?: number }): number {
  if (block.pattern === undefined) return 0;
  const beats = block.beats;
  return typeof beats === 'number' && Number.isFinite(beats) ? Math.min(MAX_SPAN, Math.max(MIN_SPAN, beats)) : DEFAULT_SPAN;
}

/** Where links into a block end. `at` is the block's centre. */
export function inPort(at: XY, span: number): XY {
  return span ? { x: at.x - (span * PX_PER_BEAT) / 2, y: at.y } : at;
}

/** Where links out of a block begin. */
export function outPort(at: XY, span: number): XY {
  return span ? { x: at.x + (span * PX_PER_BEAT) / 2, y: at.y } : at;
}

/** A block's centre plus the pattern fields that decide where its ports sit. */
export interface SpanPoint extends XY {
  pattern?: string;
  beats?: number;
}

/** The link from one block's out port to another's in port. Discs have no length, so theirs are their centres. */
export function linkBetween(a: SpanPoint, b: SpanPoint, bends: readonly XY[], offset: number): LinkPath {
  return linkPath(outPort(a, spanOf(a)), inPort(b, spanOf(b)), bends, offset);
}

/** How much of a link's end is hidden under the block it meets. */
export function portGap(span: number): number {
  return span ? PORT_R : BLOCK_R;
}

/** The pixel size of a pattern box. Null for a disc, which is measured from its own element. */
export function patternFrame(block: { pattern?: string; beats?: number }): { width: number; height: number } | null {
  const span = spanOf(block);
  return span ? { width: span * PX_PER_BEAT, height: BOX_HEIGHT } : null;
}

/** A point on a link, with the direction a pulse travels there. */
export interface PathPoint extends XY {
  ux: number;
  uy: number;
}

// A link is a polyline from one block's centre, through its bend points, to
// the other block's centre. Its length is the sum of its segments, so bending
// a link lengthens it without moving either block.
export interface LinkPath {
  points: XY[];
  /** Distance along the path to each point. */
  at: number[];
  len: number;
}

/** `offset` shifts the link sideways, and only applies to straight links. */
export function linkPath(a: XY, b: XY, bends: readonly XY[], offset: number): LinkPath {
  let points = [a, ...bends, b];
  if (offset && !bends.length) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = len ? (-(b.y - a.y) / len) * offset : 0;
    const ny = len ? ((b.x - a.x) / len) * offset : offset;
    points = points.map((p) => ({ x: p.x + nx, y: p.y + ny }));
  }
  const at = [0];
  for (let i = 1; i < points.length; i++) {
    at.push(at[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { points, at, len: at[at.length - 1] };
}

/** The point `d` px along the path. Beyond either end, the end segments extend. */
export function pointAt({ points, at }: LinkPath, d: number): PathPoint {
  let i = 0;
  while (i < points.length - 2 && at[i + 1] < d) i++;
  const a = points[i];
  const b = points[i + 1];
  const seg = at[i + 1] - at[i];
  const ux = seg ? (b.x - a.x) / seg : 1;
  const uy = seg ? (b.y - a.y) / seg : 0;
  return { x: a.x + ux * (d - at[i]), y: a.y + uy * (d - at[i]), ux, uy };
}

/** The stretch of the path between distances `d0` and `d1`, corners included. */
export function slicePath(path: LinkPath, d0: number, d1: number): XY[] {
  const out: XY[] = [pointAt(path, d0)];
  for (let i = 1; i < path.points.length - 1; i++) {
    if (path.at[i] > d0 && path.at[i] < d1) out.push(path.points[i]);
  }
  out.push(pointAt(path, d1));
  return out;
}

/** The segment closest to `p`. Segment i runs from points[i] to points[i + 1]. */
export function nearestSegment({ points }: LinkPath, p: XY): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const dx = points[i + 1].x - a.x;
    const dy = points[i + 1].y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq)) : 0;
    const dist = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

export function linkBeats(lenPx: number, snap: boolean): number {
  const raw = lenPx / PX_PER_BEAT;
  return snap ? Math.max(GRID, Math.round(raw / GRID) * GRID) : Math.max(MIN_FREE_BEATS, raw);
}

const QUARTERS = ['', '¼', '½', '¾'];

export function formatBeats(beats: number, snap: boolean): string {
  if (!snap) return beats.toFixed(2);
  const quarters = Math.round(beats / GRID);
  const whole = Math.floor(quarters / 4);
  const frac = QUARTERS[quarters % 4];
  return whole === 0 ? frac : `${whole}${frac}`;
}

/**
 * Bends that make a link from `a` to `b` exactly `target` px long without
 * moving either block. Existing bends keep their shape, pushed further out
 * or pulled in toward the straight line; a straight link bows out at its
 * middle, on the side a parallel link would sit. Null if `target` is shorter
 * than the straight line, which no bending can reach.
 */
export function fitLength(a: XY, b: XY, bends: readonly XY[], target: number): XY[] | null {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (target < d - 0.01) return null;
  if (target - d < 0.01) return [];
  const ux = d ? (b.x - a.x) / d : 1;
  const uy = d ? (b.y - a.y) / d : 0;
  // Each bend as a distance along the straight line plus one off to the side.
  // Scaling only the sideways part keeps the shape, and the length grows
  // steadily with the scale, so halving the interval finds it.
  let shape = bends.map((p) => ({
    along: (p.x - a.x) * ux + (p.y - a.y) * uy,
    side: (p.x - a.x) * -uy + (p.y - a.y) * ux,
  }));
  const at = (k: number) => shape.map(({ along, side }) => ({ x: a.x + ux * along - uy * side * k, y: a.y + uy * along + ux * side * k }));
  const length = (k: number) => linkPath(a, b, at(k), 0).len;
  // Bends that are all on the line can't bow out, and ones that double back
  // can be too long even flattened: start over from one bend at the middle.
  if (!shape.some((s) => Math.abs(s.side) > 0.01) || length(0) > target) shape = [{ along: d / 2, side: 1 }];
  let lo = 0;
  let hi = 1;
  while (length(hi) < target) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (length(mid) < target) lo = mid;
    else hi = mid;
  }
  return at(hi);
}

const FRACTIONS: Record<string, string> = { '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4' };

/** A typed length in beats: "1¾", "1 3/4", "7/4" or "1.75". NaN if it isn't one. */
export function parseLength(text: string): number {
  const t = text.trim().replace(/[¼½¾]/g, (f) => FRACTIONS[f]).trim();
  const frac = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(t);
  const n = frac ? Number(frac[1] ?? 0) + Number(frac[2]) / Number(frac[3]) : /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
  return Number.isFinite(n) ? n : NaN;
}
