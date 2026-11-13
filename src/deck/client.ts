import { DECK_PORT } from './session';

export type DeckStatus = 'idle' | 'live';

export type DeckResult = { ok: true; text: string } | { ok: false; error: string };

type Job = { id?: string; status?: string; command?: unknown };

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Keeps a pull open to the deck server. `onStatus` is `live` while this tab
 * is the one receiving commands. Closing aborts the pull.
 */
export function connectDeck(handle: (command: unknown) => Promise<DeckResult>, onStatus: (status: DeckStatus) => void) {
  const control = new AbortController();
  let live = false;
  const setLive = (next: boolean) => {
    if (live === next) return;
    live = next;
    onStatus(next ? 'live' : 'idle');
  };

  const run = async () => {
    let failures = 0;
    while (!control.signal.aborted) {
      try {
        const res = await fetch(`http://127.0.0.1:${DECK_PORT}/pull`, { signal: control.signal });
        if (!res.ok) throw new Error(String(res.status));
        const job = (await res.json()) as Job;
        if (control.signal.aborted) return;
        if (job.status === 'busy') {
          setLive(false);
          await sleep(1000, control.signal);
          continue;
        }
        failures = 0;
        setLive(true);
        if (!job.id) continue;
        let body: DeckResult;
        try {
          body = await handle(job.command);
        } catch (err) {
          body = { ok: false, error: err instanceof Error ? err.message : 'The canvas could not do that.' };
        }
        if (control.signal.aborted) return;
        await fetch(`http://127.0.0.1:${DECK_PORT}/reply`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify({ id: job.id, ...body }),
          signal: control.signal,
        });
      } catch {
        if (control.signal.aborted) return;
        setLive(false);
        failures += 1;
        await sleep(Math.min(4000, 300 * failures), control.signal);
      }
    }
  };

  void run();
  return {
    close() {
      control.abort();
      setLive(false);
    },
  };
}
