// Where the pulse is inside a pattern box. Time is a fraction of the pass, 0 at
// the inlet and 1 at the outlet. The pulse travels in from the inlet, sits on
// each note until the next one (so it jumps), then leaves toward the outlet.

export interface Mark {
  /** Where the note starts, as a fraction of the pass. */
  at: number;
  /** How long it is held, as a fraction of the pass. */
  span: number;
}

export type Place =
  | { kind: 'across'; u: number }
  | { kind: 'toward'; index: number; u: number }
  | { kind: 'on'; index: number }
  | { kind: 'leave'; index: number; u: number };

/** The note the pulse is on, or the gap it is crossing to get there or leave. */
export function playhead(t: number, marks: readonly Mark[]): Place {
  const u = Math.min(1, Math.max(0, t));
  if (!marks.length) return { kind: 'across', u };
  let on = -1;
  for (let i = 0; i < marks.length; i++) if (marks[i].at <= u + 1e-6) on = i;
  if (on < 0) {
    const end = marks[0].at;
    return { kind: 'toward', index: 0, u: end > 1e-6 ? u / end : 1 };
  }
  // Sit on this note until the next one starts. The last note is held for its
  // own length, and only then does the pulse head for the outlet.
  if (on < marks.length - 1) return { kind: 'on', index: on };
  const hold = Math.min(1, marks[on].at + Math.max(0, marks[on].span));
  if (u < hold - 1e-6) return { kind: 'on', index: on };
  const room = 1 - hold;
  return { kind: 'leave', index: on, u: room > 1e-6 ? (u - hold) / room : 1 };
}
