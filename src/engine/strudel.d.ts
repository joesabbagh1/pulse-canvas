// The parts of Strudel's mini-notation package that pattern.ts uses. The
// package ships no types of its own.
declare module '@strudel/mini' {
  export interface MiniNode {
    type_: string;
    source_?: unknown;
    arguments_?: Record<string, unknown>;
    options_?: { ops?: { type_: string; arguments_?: Record<string, unknown> }[]; weight?: number };
  }

  export interface Hap {
    /** The whole event; `part` may be a slice of it. Fractions, read with valueOf(). */
    whole?: { begin: { valueOf(): number }; end: { valueOf(): number } };
    value: unknown;
    hasOnset(): boolean;
  }

  export interface StrudelPattern {
    queryArc(begin: number, end: number): Hap[];
    fast(factor: number): StrudelPattern;
    rev(): StrudelPattern;
  }

  /** Parses a quoted mini-notation string. Throws a peggy SyntaxError. */
  export function parse(code: string): MiniNode;
  export function patternifyAST(ast: MiniNode, code: string): StrudelPattern;
}
