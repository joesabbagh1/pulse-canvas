import { compileExpr, MAX_EXPR_CHARS, type ExprFn } from './fexpr';
import { instrumentById } from './instruments';

// The graph page, as data: curves of y = f(x), the window they're read
// through, and how that window maps onto beats and scale degrees. The x axis
// is time — one sweep of the window takes `loopBeats` — and a note sounds on
// every step, its degree set by the curve's y at the playhead.

export const MAX_CURVES = 4;
/** One pass, for sending to the canvas; a straight row longer than this would sprawl. */
export const MAX_GRAPH_NOTES = 200;

export interface GraphCurve {
  id: string;
  /** y = f(x), in the little language of engine/fexpr.ts. */
  expr: string;
  /** The instrument (or machine) that sounds this curve. '' follows the block's. */
  kind: string;
  /** 0 to 1, of full loudness. */
  level: number;
  /** Degrees added to whatever the window maps the curve's y to. */
  shift: number;
}

export interface GraphSpec {
  curves: GraphCurve[];
  /** The window: the part of the plane that is drawn and read. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** One sweep of the window, in beats. */
  loopBeats: number;
  /** One note every this many beats. */
  stepBeats: number;
  /** How long a note sounds, in beats; null follows the step. */
  lengthBeats: number | null;
  /** The degree the top of the window sounds as; the bottom is `spanDegrees` below it. */
  baseDegree: number;
  spanDegrees: number;
  /** Whether the graph plays while the piece's transport runs. */
  run: boolean;
}

export const DEFAULT_GRAPH: GraphSpec = {
  curves: [{ id: 'graph-1', expr: 'sin(x)', kind: 'tone', level: 0.9, shift: 0 }],
  x0: 0,
  x1: 16,
  y0: -1.2,
  y1: 1.2,
  // Eight beats keeps a sent box a sane size on the canvas (240px a beat).
  loopBeats: 8,
  stepBeats: 0.25,
  lengthBeats: null,
  baseDegree: -4,
  spanDegrees: 16,
  run: false,
};

export interface CurveFn {
  curve: GraphCurve;
  fn: ExprFn;
  index: number;
}

/**
 * A graph box's share of the spec: everything but the page's sweep length
 * (the box's `beats` is that — distance is time) and its Run switch (playing
 * is the canvas's transport).
 */
export type BlockGraph = Omit<GraphSpec, 'loopBeats' | 'run'>;

export const DEFAULT_BLOCK_GRAPH: BlockGraph = (() => {
  const { loopBeats: _loop, run: _run, ...rest } = DEFAULT_GRAPH;
  // A new box follows its block's instrument, so the inspector's picker works.
  return { ...rest, curves: [{ ...rest.curves[0], kind: '' }] };
})();

/** The same safety net, for a graph riding on a block. '' (this block) is kept. */
export function clampBlockGraph(v: unknown, kindOk: (kind: string) => boolean = (k) => !!instrumentById(k)): BlockGraph {
  const { loopBeats: _loop, run: _run, ...rest } = clampGraph(v, kindOk, true);
  return rest;
}

/** One sweep of the window across `span` beats — the box's whole pass. */
export function blockGraphNotes(
  spec: BlockGraph,
  curves: readonly CurveFn[],
  span: number,
  fromBeat: number,
  toBeat: number,
): GraphNote[] {
  return graphNotes({ ...spec, loopBeats: span, run: false }, curves, fromBeat, toBeat);
}

/** Compiles every curve; the ones that don't read are left out until they do. */
export function compileCurves(spec: GraphSpec): CurveFn[] {
  const out: CurveFn[] = [];
  spec.curves.forEach((curve, index) => {
    const got = compileExpr(curve.expr);
    if (got.fn) out.push({ curve, fn: got.fn, index });
  });
  return out;
}

/** The graph's x at a beat: one sweep of the window per loop. */
export function xAt(spec: GraphSpec, beat: number): number {
  const loop = spec.loopBeats;
  const phase = ((beat % loop) + loop) % loop;
  return spec.x0 + (phase / loop) * (spec.x1 - spec.x0);
}

/**
 * The degree a y sounds as: the window's height laid onto the scale, top of
 * the window highest. Not-a-number y (a rest) comes back as null.
 */
export function degreeAt(spec: GraphSpec, curve: GraphCurve, y: number): number | null {
  if (!Number.isFinite(y)) return null;
  const across = (y - spec.y0) / (spec.y1 - spec.y0);
  const degree = Math.round(spec.baseDegree + across * spec.spanDegrees + curve.shift);
  return Math.min(96, Math.max(-96, degree));
}

export interface GraphNote {
  curve: number;
  beat: number;
  degree: number;
  velocity: number;
  /** How long it sounds, in beats. */
  beats: number;
}

/** Every note whose step falls in [fromBeat, toBeat), on the step grid. */
export function graphNotes(spec: GraphSpec, curves: readonly CurveFn[], fromBeat: number, toBeat: number): GraphNote[] {
  const step = spec.stepBeats;
  if (step <= 0 || toBeat <= fromBeat) return [];
  const first = Math.ceil(fromBeat / step - 1e-9);
  const last = Math.floor(toBeat / step - 1e-9);
  const out: GraphNote[] = [];
  for (let k = first; k <= last; k++) {
    // The +0 turns a -0 step (ceil just under zero) back into 0.
    const beat = k * step + 0;
    if (beat < fromBeat - 1e-9 || beat >= toBeat - 1e-9) continue;
    const x = xAt(spec, beat);
    for (const { curve, fn, index } of curves) {
      const degree = degreeAt(spec, curve, fn(x));
      if (degree === null) continue;
      out.push({ curve: index, beat, degree, velocity: curve.level, beats: spec.lengthBeats ?? step });
    }
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/**
 * Safety net for a graph coming in from storage or a share: numbers clamped,
 * unknown instruments retargeted to the plain tone, sizes capped. `kindOk`
 * says which instrument ids exist (machines included).
 */
export function clampGraph(
  v: unknown,
  kindOk: (kind: string) => boolean = (k) => !!instrumentById(k),
  keepEmptyKind = false,
): GraphSpec {
  const g = isObject(v) ? v : {};
  const rawCurves = Array.isArray(g.curves) ? g.curves : DEFAULT_GRAPH.curves;
  const curves: GraphCurve[] = rawCurves
    .filter(isObject)
    .slice(0, MAX_CURVES)
    .map((c, i) => ({
      id: typeof c.id === 'string' && c.id ? c.id.slice(0, 100) : `graph-${i + 1}`,
      expr: typeof c.expr === 'string' ? c.expr.slice(0, MAX_EXPR_CHARS) : 'sin(x)',
      kind: typeof c.kind === 'string' && (kindOk(c.kind) || (keepEmptyKind && c.kind === '')) ? c.kind : 'tone',
      level: num(c.level, 0, 1, 0.9),
      shift: Math.round(num(c.shift, -24, 24, 0)),
    }));
  let x0 = num(g.x0, -1e6, 1e6, DEFAULT_GRAPH.x0);
  let x1 = num(g.x1, -1e6, 1e6, DEFAULT_GRAPH.x1);
  let y0 = num(g.y0, -1e6, 1e6, DEFAULT_GRAPH.y0);
  let y1 = num(g.y1, -1e6, 1e6, DEFAULT_GRAPH.y1);
  // A window with no width can't be drawn or read through.
  if (x1 - x0 === 0) {
    x0 = DEFAULT_GRAPH.x0;
    x1 = DEFAULT_GRAPH.x1;
  }
  if (y1 - y0 === 0) {
    y0 = DEFAULT_GRAPH.y0;
    y1 = DEFAULT_GRAPH.y1;
  }
  return {
    curves,
    x0,
    x1,
    y0,
    y1,
    loopBeats: num(g.loopBeats, 1, 128, DEFAULT_GRAPH.loopBeats),
    stepBeats: num(g.stepBeats, 1 / 16, 4, DEFAULT_GRAPH.stepBeats),
    lengthBeats: g.lengthBeats == null ? null : num(g.lengthBeats, 1 / 16, 16, DEFAULT_GRAPH.stepBeats),
    baseDegree: Math.round(num(g.baseDegree, -48, 48, DEFAULT_GRAPH.baseDegree)),
    spanDegrees: Math.round(num(g.spanDegrees, 1, 48, DEFAULT_GRAPH.spanDegrees)),
    run: g.run === true,
  };
}
