import { additiveTerms, compileExpr, MAX_EXPR_CHARS, parseExpr, type AdditiveTerm, type ExprFn, type Node } from './fexpr';

// Bending: pressing a curve and dragging adds one gaussian term to its
// expression, centred where you pressed — `sin(x)` becomes
// `sin(x)+.75exp(-((x-4)/1)^2)`. The function itself is what changes: it is
// still the function, still text, and the bend has faded to nothing a couple
// of widths away from the press, so only where you pulled moves. A drag over
// an earlier bend absorbs it, so re-bending the same spot retunes one term
// instead of piling terms up.

/** How wide a bend is, as a share of the window's width. */
const WIDTH_SHARE = 1 / 16;
/** Below this, after rounding, an amplitude isn't worth a term in the text. */
const AMP_EPSILON = 0.005;
/** A bend this close to the press (in widths) folds into the new one. */
const ABSORB_WIDTHS = 0.5;
/** The longest term a drag could write, for making room before one starts. */
const WORST_TERM = '-9.99exp(-((x-999.99)/9.99)^2)';

/** One gaussian bend term living in an expression. */
interface BendTerm {
  amp: number;
  center: number;
  width: number;
  /** The term as it sits in the expression, joiner sign included. */
  text: string;
}

/** A drag in progress: everything a move needs, frozen at the press. */
export interface BendSession {
  /** The curve as the drag found it — drawn as the ghost while you drag. */
  before: ExprFn;
  /** The expression minus the absorbed bends: what the bend rides on. */
  baseText: string;
  /** Earlier bends kept as terms, dropped smallest-first if text runs out. */
  kept: BendTerm[];
  /** Where the pointer pressed; the bend stays centred here for the drag. */
  center: number;
  width: number;
  /** baseText plus the kept bends: the curve under the active bend. */
  under: ExprFn;
}

/** Compact number text: no trailing zeros, no leading zero on a fraction. */
const fmt = (v: number): string => String(Math.round(v * 100) / 100).replace(/^(-?)0\./, '$1.').replace(/(\.\d*?)0+$/, '$1');

/** The gaussian term for one bend — `+.75exp(-((x-4)/1)^2)` — '' if it fades away. */
function bendTermText(amp: number, center: number, width: number): string {
  const a = Math.round(amp * 100) / 100;
  if (Math.abs(a) < AMP_EPSILON) return '';
  const fromCenter = Math.abs(center) < 0.005 ? 'x' : `(x${center > 0 ? '-' : '+'}${fmt(Math.abs(center))})`;
  const mag = fmt(Math.abs(a));
  return `${a < 0 ? '-' : '+'}${mag === '1' ? '' : mag}exp(-(${fromCenter}/${fmt(width)})^2)`;
}

/** A term that is a plain number, alone or under a unary minus. */
const numNode = (n: Node): number | null => {
  if (n.t === 'neg') {
    const v = numNode(n.a);
    return v === null ? null : -v;
  }
  return n.t === 'num' ? n.v : null;
};

/** Reads a term as one of the bends this module writes, or null if it isn't one. */
function bendOfTerm(term: AdditiveTerm): BendTerm | null {
  if (!term.text) return null;
  let node: Node;
  try {
    node = parseExpr(term.text);
  } catch {
    return null;
  }
  let sign = term.sign === '-' ? -1 : 1;
  while (node.t === 'neg') {
    sign = -sign;
    node = node.a;
  }
  // The amplitude: a plain number multiplying the exp (either side), or none.
  let amp = sign;
  if (node.t === 'bin' && node.op === '*') {
    const left = numNode(node.a);
    const right = numNode(node.b);
    if (left !== null && right === null) {
      amp = sign * left;
      node = node.b;
    } else if (right !== null && left === null) {
      amp = sign * right;
      node = node.a;
    } else return null;
  }
  if (node.t !== 'call' || node.f !== 'exp' || node.args.length !== 1) return null;
  // The body: the negative square of (x-c)/w.
  let arg = node.args[0];
  if (arg.t === 'neg') arg = arg.a;
  let inner: Node;
  if (arg.t === 'pow') {
    if (arg.b.t !== 'num' || arg.b.v !== 2) return null;
    inner = arg.a;
  } else if (arg.t === 'call' && arg.f === 'pow' && arg.args.length === 2 && arg.args[1].t === 'num' && arg.args[1].v === 2) {
    inner = arg.args[0];
  } else return null;
  if (inner.t !== 'bin' || inner.op !== '/') return null;
  const width = numNode(inner.b);
  if (width === null || width === 0) return null;
  const top = inner.a;
  let center: number;
  if (top.t === 'bin' && top.op === '-' && top.a.t === 'var' && top.b.t === 'num') center = top.b.v;
  else if (top.t === 'bin' && top.op === '+' && top.a.t === 'var' && top.b.t === 'num') center = -top.b.v;
  else if (top.t === 'var') center = 0;
  else return null;
  return { amp, center, width: Math.abs(width), text: `${term.sign}${term.text}` };
}

/** Terms joined back the way they parse: value-identical to where they came from. */
const joinTerms = (terms: readonly AdditiveTerm[]): string =>
  terms.map((t, i) => (i === 0 ? t.text : `${t.sign}${t.text}`)).join('');

/** base, kept bends and the active term as one expression, never empty. */
const assemble = (base: string, keptText: readonly string[], active: string): string => {
  const text = base + keptText.join('') + active;
  if (!text) return '0';
  // A leading + only happens when the base was bends alone and folded away.
  return text[0] === '+' ? text.slice(1) : text;
};

/**
 * Everything a drag needs, from the expression it starts from. Bends close
 * to `center` fold into the drag; older kept bends are dropped, smallest
 * first, until the bent expression fits the cap. Null when even the base
 * can't make room, and the drag is ignored.
 */
export function beginBend(expr: string, center: number, windowWidth: number): BendSession | null {
  const before = compileExpr(expr);
  if (!before.fn) return null;
  const width = Math.max(1e-3, Math.abs(windowWidth) * WIDTH_SHARE);
  const base: AdditiveTerm[] = [];
  const kept: BendTerm[] = [];
  for (const term of additiveTerms(expr)) {
    const bend = bendOfTerm(term);
    if (bend && Math.abs(bend.center - center) <= ABSORB_WIDTHS * Math.max(width, bend.width)) continue;
    if (bend) kept.push(bend);
    else base.push(term);
  }
  const baseText = joinTerms(base);
  const keptText = () => kept.map((k) => k.text);
  while (kept.length && assemble(baseText, keptText(), WORST_TERM).length > MAX_EXPR_CHARS) {
    let drop = 0;
    for (let i = 1; i < kept.length; i++) {
      if (Math.abs(kept[i].amp) < Math.abs(kept[drop].amp)) drop = i;
    }
    kept.splice(drop, 1);
  }
  if (assemble(baseText, keptText(), WORST_TERM).length > MAX_EXPR_CHARS) return null;
  const under = compileExpr(assemble(baseText, keptText(), ''));
  if (!under.fn) return null;
  return { before: before.fn, baseText, kept, center, width, under: under.fn };
}

/**
 * The bent expression when the pointer holds the curve at `y`: base and kept
 * bends as they were, plus one gaussian centred on the press. Null when the
 * text can't fit, and this move is ignored.
 */
export function bendText(bend: BendSession, y: number): string | null {
  const amp = y - bend.under(bend.center);
  const text = assemble(bend.baseText, bend.kept.map((k) => k.text), bendTermText(amp, bend.center, bend.width));
  return text.length <= MAX_EXPR_CHARS ? text : null;
}
