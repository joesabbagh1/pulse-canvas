// Tone keeps every timer on one queue and takes an entry off only after its
// callback returns. A callback that throws stays at the front, throws again on
// every clock tick, and nothing behind it ever runs: the playback tick, the
// poly synths' just-in-time notes, the cleanup of finished drum hits. The piece
// turns to noise, then stays silent through stop and play until a reload.

export interface TimerQueue {
  setTimeout(fn: (...args: any[]) => void, timeout: number): number;
  setInterval?(fn: (...args: any[]) => void, interval: number): number;
}

const guarded = new WeakSet<object>();

/** Runs fn, reporting a throw instead of letting it escape into the queue. */
function safe(fn: (...args: any[]) => void, report: (err: unknown) => void) {
  return (...args: any[]) => {
    try {
      fn(...args);
    } catch (err) {
      report(err);
    }
  };
}

/** Makes a timer that throws report itself and get out of the way. Safe to call again. */
export function guardTimers(queue: TimerQueue, report: (err: unknown) => void = (err) => console.warn('A scheduled audio callback failed', err)) {
  if (guarded.has(queue)) return;
  guarded.add(queue);
  const setTimeout = queue.setTimeout.bind(queue);
  queue.setTimeout = (fn, timeout) => setTimeout(safe(fn, report), timeout);
  // setInterval re-arms itself inside its own callback and adds straight to
  // the queue without going through setTimeout, so it needs its own wrap:
  // one throw would both kill the re-arm and strand the event at the front,
  // wedging every timer behind it — the playback tick included.
  const setInterval = queue.setInterval?.bind(queue);
  if (setInterval) queue.setInterval = (fn, interval) => setInterval(safe(fn, report), interval);
}
