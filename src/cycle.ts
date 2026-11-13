// Loops of different lengths drift against each other and come back into
// line after the least common multiple of their lengths: a 2-beat drum loop
// against a 3¾-beat melody lines up every 30 beats. That's when the whole
// piece repeats, as far as travel time goes; code that counts passes (every N)
// or delays can stretch it further.

/** Lengths are compared on a 1/48-beat grid, which holds quarters, triplets and sixteenths. */
const STEPS_PER_BEAT = 48;
/** Past this, "it repeats" stops meaning anything to a listener. */
export const MAX_CYCLE_BEATS = 10_000;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export type Cycle =
  | { kind: 'none' }
  | { kind: 'repeats'; beats: number }
  /** A length isn't on the grid (free timing, Snap off): the loops never line up exactly. */
  | { kind: 'drifts' }
  | { kind: 'too-long' };

/** When every periodic part (each loop, each repeating start) lines up again. */
export function pieceCycle(periods: readonly number[]): Cycle {
  if (!periods.length) return { kind: 'none' };
  let steps = 1;
  for (const p of periods) {
    const exact = p * STEPS_PER_BEAT;
    const n = Math.round(exact);
    if (n <= 0 || Math.abs(exact - n) > 1e-6) return { kind: 'drifts' };
    steps = (steps / gcd(steps, n)) * n;
    if (steps / STEPS_PER_BEAT > MAX_CYCLE_BEATS) return { kind: 'too-long' };
  }
  return { kind: 'repeats', beats: steps / STEPS_PER_BEAT };
}
