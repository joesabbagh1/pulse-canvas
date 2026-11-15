// Math expressions for the graph page: "sin(x) + sin(3x)/3". The text is
// parsed into this tree and run as the tree, never as JavaScript, so a shared
// piece can't run anything but arithmetic on x.
//
//   numbers 2, 1.5, .5, 2e3        the variable x
//   pi, e, tau                    + - * / % and ^ (so -x^2 is -(x^2))
//   2x, 3sin(x), x(x+1)           multiplication can be implied
//   sin cos tan asin acos atan atan2 abs sqrt floor ceil round exp ln log
//   log2 sign min max pow mod      (ln is natural, log is base 10)
//   curve(x, a, b, y0…yn)         knot values smoothly spread over [a, b],
//                                 flat past either end — a shape to type.

export const MAX_EXPR_CHARS = 200;
const MAX_DEPTH = 32;

export type ExprFn = (x: number) => number;
export type CompiledExpr = { fn: ExprFn; error: null } | { fn: null; error: string };

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var' }
  | { t: 'const'; v: number }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '%'; a: Node; b: Node }
  | { t: 'pow'; a: Node; b: Node }
  | { t: 'call'; f: string; args: Node[] };

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

interface FnDef {
  /** How many comma-separated values the call accepts, inclusive. */
  minArgs: number;
  maxArgs: number;
  call: (...xs: number[]) => number;
}

const one = (f: (a: number) => number): FnDef => ({ minArgs: 1, maxArgs: 1, call: (a) => f(a) });
const two = (f: (a: number, b: number) => number): FnDef => ({ minArgs: 2, maxArgs: 2, call: (a, b) => f(a, b) });

/** A bend, as math: knot values spread over [a, b], cosine-smoothed between them. */
function curveAt(x: number, a: number, b: number, ys: number[]): number {
  if (b <= a || ys.length < 2) return ys[0] ?? NaN;
  // Flat past either end, so a bend stays inside its window.
  const across = Math.min(1, Math.max(0, (x - a) / (b - a)));
  const pos = across * (ys.length - 1);
  const i = Math.min(ys.length - 2, Math.floor(pos));
  const u = (1 - Math.cos(Math.PI * (pos - i))) / 2;
  return ys[i] + (ys[i + 1] - ys[i]) * u;
}

const FUNCTIONS: Record<string, FnDef> = {
  sin: one(Math.sin),
  cos: one(Math.cos),
  tan: one(Math.tan),
  asin: one(Math.asin),
  acos: one(Math.acos),
  atan: one(Math.atan),
  atan2: two(Math.atan2),
  abs: one(Math.abs),
  sqrt: one(Math.sqrt),
  floor: one(Math.floor),
  ceil: one(Math.ceil),
  round: one(Math.round),
  exp: one(Math.exp),
  ln: one(Math.log),
  log: one(Math.log10),
  log2: one(Math.log2),
  sign: one(Math.sign),
  min: two(Math.min),
  max: two(Math.max),
  pow: two(Math.pow),
  mod: two((a, b) => ((a % b) + b) % b),
  // The one variadic: x, the window's ends, and two to fourteen knot values.
  curve: { minArgs: 5, maxArgs: 17, call: (x, a, b, ...ys) => curveAt(x, a, b, ys) },
};

/** A token with the span it came from, so terms can be cut as source text. */
type Tok = { k: 'num'; v: number; i: number; j: number } | { k: 'name'; v: string; i: number; j: number } | { k: 'op'; v: string; i: number; j: number };

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= '0' && c <= '9';
  const isName = (c: string) => /[a-zA-Z_]/.test(c);
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j++;
      // A trailing exponent: 2e3, 2e-3. "2e" alone is 2 times e.
      const exp = /^e([+-]?\d)/.exec(src.slice(j));
      if (exp) j += exp[0].length;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`"${src.slice(i, j)}" isn't a number I can read`);
      toks.push({ k: 'num', v, i, j });
      i = j;
      continue;
    }
    if (isName(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z_0-9]/.test(src[j])) j++;
      toks.push({ k: 'name', v: src.slice(i, j), i, j });
      i = j;
      continue;
    }
    if ('+-*/%^(),'.includes(c)) {
      toks.push({ k: 'op', v: c, i, j: i + 1 });
      i++;
      continue;
    }
    throw new Error(`"${c}" isn't something I can read`);
  }
  return toks;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private at(v: string): boolean {
    const t = this.peek();
    return t !== undefined && t.k === 'op' && t.v === v;
  }

  private eat(v: string): boolean {
    if (!this.at(v)) return false;
    this.i++;
    return true;
  }

  private describe(t: Tok | undefined): string {
    if (t === undefined) return 'the end';
    return t.k === 'op' ? `"${t.v}"` : `"${t.v}"`;
  }

  parse(): Node {
    const node = this.expr(0);
    if (this.i < this.toks.length) throw new Error(`didn't expect ${this.describe(this.peek())} here`);
    return node;
  }

  private expr(d: number): Node {
    this.guard(d);
    let a = this.term(d);
    while (this.at('+') || this.at('-')) {
      const op = this.toks[this.i].v as '+' | '-';
      this.i++;
      a = { t: 'bin', op, a, b: this.term(d + 1) };
    }
    return a;
  }

  private term(d: number): Node {
    this.guard(d);
    let a = this.unary(d);
    for (;;) {
      if (this.at('*') || this.at('/') || this.at('%')) {
        const op = this.toks[this.i].v as '*' | '/' | '%';
        this.i++;
        a = { t: 'bin', op, a, b: this.unary(d + 1) };
        continue;
      }
      // 2x, 3sin(x), x(x+1): a value or group starting here multiplies.
      const t = this.peek();
      if (t !== undefined && (t.k === 'num' || t.k === 'name' || this.at('('))) {
        a = { t: 'bin', op: '*', a, b: this.unary(d + 1) };
        continue;
      }
      return a;
    }
  }

  private unary(d: number): Node {
    this.guard(d);
    if (this.eat('-')) return { t: 'neg', a: this.unary(d + 1) };
    if (this.eat('+')) return this.unary(d + 1);
    return this.power(d);
  }

  private power(d: number): Node {
    this.guard(d);
    const a = this.atom(d + 1);
    if (this.eat('^')) return { t: 'pow', a, b: this.unary(d + 1) };
    return a;
  }

  private atom(d: number): Node {
    this.guard(d);
    const t = this.peek();
    if (t === undefined) throw new Error('the expression ends early');
    if (t.k === 'num') {
      this.i++;
      return { t: 'num', v: t.v };
    }
    if (t.k === 'name') {
      this.i++;
      if (t.v === 'x') return { t: 'var' };
      if (t.v in CONSTANTS) return { t: 'const', v: CONSTANTS[t.v] };
      const fn = FUNCTIONS[t.v];
      if (!fn) throw new Error(`"${t.v}" isn't known here`);
      if (!this.eat('(')) throw new Error(`${t.v} is a function: write ${t.v}(x)`);
      const args: Node[] = [];
      if (!this.at(')')) {
        args.push(this.expr(d + 1));
        while (this.eat(',')) args.push(this.expr(d + 1));
      }
      if (!this.eat(')')) throw new Error(`${t.v}( needs a ) to close it`);
      if (args.length < fn.minArgs || args.length > fn.maxArgs) {
        const takes =
          fn.minArgs === fn.maxArgs
            ? `${fn.minArgs} ${fn.minArgs === 1 ? 'value' : 'values'}`
            : `${fn.minArgs} to ${fn.maxArgs} values`;
        throw new Error(`${t.v} takes ${takes}`);
      }
      return { t: 'call', f: t.v, args };
    }
    if (this.eat('(')) {
      const inner = this.expr(d + 1);
      if (!this.eat(')')) throw new Error('( needs a ) to close it');
      return inner;
    }
    throw new Error(`expected a number, a name or ( before ${this.describe(t)}`);
  }

  private guard(d: number) {
    if (d > MAX_DEPTH) throw new Error('too deeply nested');
  }
}

function build(n: Node): ExprFn {
  switch (n.t) {
    case 'num': {
      const v = n.v;
      return () => v;
    }
    case 'var':
      return (x) => x;
    case 'const': {
      const v = n.v;
      return () => v;
    }
    case 'neg': {
      const a = build(n.a);
      return (x) => -a(x);
    }
    case 'bin': {
      const a = build(n.a);
      const b = build(n.b);
      switch (n.op) {
        case '+':
          return (x) => a(x) + b(x);
        case '-':
          return (x) => a(x) - b(x);
        case '*':
          return (x) => a(x) * b(x);
        case '/':
          return (x) => a(x) / b(x);
        case '%':
          return (x) => a(x) % b(x);
      }
    }
    case 'pow': {
      const a = build(n.a);
      const b = build(n.b);
      return (x) => a(x) ** b(x);
    }
    case 'call': {
      const fn = FUNCTIONS[n.f];
      const args = n.args.map(build);
      if (args.length === 1) {
        const a = args[0];
        return (x) => fn.call(a(x));
      }
      return (x) => fn.call(...args.map((g) => g(x)));
    }
  }
}

/** Parses to the tree, throwing the same errors compileExpr reports. */
export function parseExpr(source: string): Node {
  return new Parser(lex(source)).parse();
}

/** Compiles "sin(x) + 1" into a function of x, or says why it can't be read. */
export function compileExpr(source: string): CompiledExpr {
  if (source.trim().length === 0) return { fn: null, error: 'write a function of x, like sin(x)' };
  if (source.length > MAX_EXPR_CHARS) return { fn: null, error: `expressions are capped at ${MAX_EXPR_CHARS} characters` };
  try {
    const node = parseExpr(source);
    return { fn: build(node), error: null };
  } catch (err) {
    return { fn: null, error: err instanceof Error ? err.message : "can't read that expression" };
  }
}

export interface AdditiveTerm {
  /** The +/- that joined this term to the one before it; '+' on the first. */
  sign: '+' | '-';
  /** The term's own source, its leading unary signs included, joiner excluded. */
  text: string;
}

/**
 * The expression's top-level +/- terms, cut where a plus or minus binds
 * loosest — outside every bracket, and binary (a value ends just before it,
 * so the minus in "sin(-x)" and the one in "x^-2" stay inside their terms).
 * Terms joined back with their signs read as the same function.
 */
export function additiveTerms(src: string): AdditiveTerm[] {
  const toks = lex(src);
  const terms: AdditiveTerm[] = [];
  let depth = 0;
  let sign: '+' | '-' = '+';
  let start = 0;
  let valueBefore = false;
  for (const t of toks) {
    if (t.k === 'op' && (t.v === '(' || t.v === ')')) depth += t.v === '(' ? 1 : -1;
    if (t.k === 'op' && (t.v === '+' || t.v === '-') && depth === 0 && valueBefore) {
      terms.push({ sign, text: src.slice(start, t.i).trim() });
      sign = t.v;
      start = t.j;
    }
    valueBefore = t.k !== 'op' || t.v === ')';
  }
  terms.push({ sign, text: src.slice(start).trim() });
  return terms;
}

/** The functions and constants on offer, for the page's reference. */
export const EXPR_WORDS = [...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS), 'x'].sort();
