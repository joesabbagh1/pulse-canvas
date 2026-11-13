// Which pass of a pattern is crossing its box right now. The drawing and the
// lit word follow it, so `every` and `chance` change the picture with the sound.

export interface LivePass {
  fast: number;
  rev: boolean;
  cycle: number;
  /** Scale degrees added by the code of this pass, including every and chance. */
  shift: number;
}

const passes = new Map<string, LivePass>();
const listeners = new Set<() => void>();

export function livePass(id: string): LivePass | null {
  return passes.get(id) ?? null;
}

export function subscribeLive(listen: () => void) {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

/** Replace the passes that are under way. Same values keep the same object, so a subscriber does not redraw. */
export function setLivePasses(active: readonly (LivePass & { id: string })[]) {
  let changed = false;
  const seen = new Set<string>();
  for (const { id, fast, rev, cycle, shift } of active) {
    seen.add(id);
    const prev = passes.get(id);
    if (prev && prev.fast === fast && prev.rev === rev && prev.cycle === cycle && prev.shift === shift) continue;
    passes.set(id, { fast, rev, cycle, shift });
    changed = true;
  }
  for (const id of passes.keys()) {
    if (seen.has(id)) continue;
    passes.delete(id);
    changed = true;
  }
  if (changed) for (const listen of listeners) listen();
}
