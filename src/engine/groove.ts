// A region's groove moves *when its notes sound*, never when pulses arrive:
// the scheduler's beats stay exact, so loops can't drift out of time however
// much swing is on. Only the sound, a few milliseconds either side, moves.

export interface Groove {
  /** 0 (straight) to 1 (full triplet swing). */
  swing: number;
  /** The note value that swings, in beats: ½ for 8ths, ¼ for 16ths. */
  swingGrid: number;
  /** 0 to 1: random nudges to timing and velocity, so repeats aren't identical. */
  humanize: number;
}

export const DEFAULT_GROOVE: Groove = { swing: 0, swingGrid: 0.5, humanize: 0 };

/** At full humanize, notes land up to this early or late, and this much softer. */
const MAX_JITTER_SECONDS = 0.015;
const MAX_SOFTEN = 0.3;
const ON_GRID = 0.02;

/**
 * How a note at `beat` is moved: seconds to shift it by, and a velocity
 * factor. Swing delays the off-beat of each pair of grid steps, up to a
 * third of a step, where it sits on the triplet.
 */
export function grooveNote(beat: number, groove: Groove, secondsPerBeat: number, random: () => number = Math.random) {
  const { swing, swingGrid: g, humanize } = groove;
  let seconds = 0;
  const inPair = (((beat / g) % 2) + 2) % 2;
  if (swing > 0 && Math.abs(inPair - 1) < ON_GRID) seconds += ((swing * g) / 3) * secondsPerBeat;
  let velocity = 1;
  if (humanize > 0) {
    seconds += (random() * 2 - 1) * humanize * MAX_JITTER_SECONDS;
    velocity -= random() * humanize * MAX_SOFTEN;
  }
  return { seconds, velocity };
}
