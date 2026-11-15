export type DeckStatus = 'idle' | 'live';

export type DeckResult = { ok: true; text: string } | { ok: false; error: string };

type Job = { id?: string; status?: string; command?: unknown };

/** How often the page quietly checks whether a deck server is running. */
const PROBE_MS = 8_000;
/** A flag older than this belongs to a deck that died without cleanup. */
const STALE_MS = 15_000;
/** Straight refusals before the client stops touching the port and probes again. */
const FAST_TRIES = 5;

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

type DeckFlag = { port?: unknown; at?: unknown };

/**
 * Reads the deck's announcement from the dev server, same-origin. The file
 * only exists while a deck runs; any other answer (the SPA fallback's HTML,
 * a 404, a network hiccup) just means no deck, and — unlike touching the deck
 * port itself — none of them print anything to the console.
 */
async function readDeckPort(signal: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch('/deck.json', { cache: 'no-store', signal });
    if (!res.ok) return null;
    const flag = (await res.json()) as DeckFlag;
    if (typeof flag?.port !== 'number' || flag.port <= 0) return null;
    if (typeof flag.at === 'number' && Date.now() - flag.at > STALE_MS) return null;
    return flag.port;
  } catch {
    return null;
  }
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
      const port = await readDeckPort(control.signal);
      if (control.signal.aborted) return;
      if (port === null) {
        setLive(false);
        failures = 0;
        await sleep(PROBE_MS, control.signal);
        continue;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/pull`, { signal: control.signal });
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
        await fetch(`http://127.0.0.1:${port}/reply`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify({ id: job.id, ...body }),
          signal: control.signal,
        });
      } catch {
        if (control.signal.aborted) return;
        setLive(false);
        failures += 1;
        // The flag said a deck was there but the port refuses: retry fast for
        // a few seconds in case it is mid-start, then go back to probing.
        // Every refused connection is a red line in the console, so the
        // client never polls the port on a schedule — the flag decides.
        if (failures > FAST_TRIES) {
          failures = 0;
          await sleep(PROBE_MS, control.signal);
        } else {
          await sleep(Math.min(1500, 300 * failures), control.signal);
        }
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
