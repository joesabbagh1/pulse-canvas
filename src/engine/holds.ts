// Live notes on the Instruments page. The id is handed out before the audio
// context is ready, so a key can come up before the note has started.

export interface NoteGate {
  release(time: number): void;
  /** The strike already played its full envelope. Releasing the key does not choke it. */
  once?: boolean;
}

export const NO_GATE: NoteGate = { release() {} };
export const ONCE_GATE: NoteGate = { release() {}, once: true };

interface Slot {
  cancel: boolean;
  release: ((time: number) => void) | null;
}

export class HoldBook {
  private next = 1;
  private slots = new Map<number, Slot>();

  open(): number {
    const id = this.next++;
    this.slots.set(id, { cancel: false, release: null });
    return id;
  }

  /**
   * The voice has started. A key that already came up releases it now, so it
   * does not keep sounding. A one-shot that already played is left alone.
   */
  start(id: number, time: number, gate: NoteGate) {
    const slot = this.slots.get(id);
    if (!slot || slot.cancel) {
      this.slots.delete(id);
      if (!gate.once) gate.release(time);
      return;
    }
    if (gate.once) {
      this.slots.delete(id);
      return;
    }
    slot.release = (at) => gate.release(at);
  }

  /** Key up. If the voice has not started yet, it is released the moment it does. */
  release(id: number, time: number) {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.cancel = true;
    if (!slot.release) return;
    this.slots.delete(id);
    slot.release(time);
  }

  /** The mixer already silenced every voice. Forget the handles. */
  dropAll() {
    this.slots.clear();
  }
}
