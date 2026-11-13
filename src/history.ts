import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

// Undo works on whole snapshots of the piece (as saved JSON), not on a log of
// edits: every change anywhere (dragging, code, regions, tempo, opening an
// example) is undoable without each feature knowing about undo. Snapshots are
// a few kilobytes, since samples are only referred to by id.

const LIMIT = 200;

/** The undo stack itself, with no timing: a present state, and steps either side. */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(public present: string) {}

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** Makes `next` a new step. Returns false when nothing changed. */
  commit(next: string): boolean {
    if (next === this.present) return false;
    this.past.push(this.present);
    if (this.past.length > LIMIT) this.past.shift();
    this.present = next;
    this.future = [];
    return true;
  }

  undo(): string | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(this.present);
    this.present = previous;
    return previous;
  }

  redo(): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  /** Takes `state` as the present without making a step. */
  rebase(state: string) {
    this.present = state;
  }
}

// A change becomes a step once things settle: nothing has changed for this
// long and no pointer is held down. So a drag, a slider sweep or a burst of
// typing is one step, not hundreds.
export const SETTLE_MS = 400;

/**
 * Undo and redo over `state`, a snapshot of everything undoable. `restore`
 * puts a snapshot back on the canvas.
 */
export function useHistory(state: string, restore: (state: string) => void) {
  const [history] = useState(() => new History(state));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const latest = useRef(state);
  latest.current = state;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const restoring = useRef(false);
  const held = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const commit = useCallback(() => {
    window.clearTimeout(timer.current);
    if (history.commit(latest.current)) refresh();
  }, [history]);

  const settle = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => !held.current && commit(), SETTLE_MS);
  }, [commit]);

  useEffect(() => {
    // The canvas redrawn from a restored step is that step, not a new one.
    if (restoring.current) {
      restoring.current = false;
      history.rebase(state);
      return;
    }
    if (state !== history.present) settle();
  }, [history, state, settle]);

  useEffect(() => {
    const down = () => {
      held.current = true;
    };
    const up = () => {
      held.current = false;
      if (latest.current !== history.present) settle();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.clearTimeout(timer.current);
    };
  }, [history, settle]);

  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      // A change still settling is its own step, so undo takes back exactly it.
      commit();
      const target = direction === 'undo' ? history.undo() : history.redo();
      if (target === null) return;
      restoring.current = true;
      restoreRef.current(target);
      refresh();
    },
    [history, commit],
  );

  return {
    undo: useCallback(() => step('undo'), [step]),
    redo: useCallback(() => step('redo'), [step]),
    canUndo: history.canUndo || state !== history.present,
    canRedo: history.canRedo && state === history.present,
  };
}
