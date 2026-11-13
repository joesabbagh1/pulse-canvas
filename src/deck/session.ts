// The page and the MCP server share one local session. The page waits on
// pull; a tool call hands it a command and waits for the reply. One tab waits
// at a time. A second tab is told to stand by until the first lets go.

export const DECK_PORT = 4731;

export const OFFLINE = `Pulse Canvas is not connected. Open the app in a browser (npm run dev). The deck listens on 127.0.0.1:${DECK_PORT}. Press Play once in the page so the browser can make sound; after that the deck can start and stop.`;

export interface DeckReply {
  ok: boolean;
  text?: string;
  error?: string;
}

export type Pull =
  | { status: 'job'; id: string; command: unknown }
  | { status: 'idle' }
  | { status: 'busy' };

interface Waiter {
  resolve: (result: Pull) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Pending {
  resolve: (reply: DeckReply) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DeckSession {
  private waiter: Waiter | null = null;
  private queue: { id: string; command: unknown }[] = [];
  private pending = new Map<string, Pending>();
  private seq = 0;
  private touched = 0;
  private askTimeoutMs: number;
  private holdMs: number;

  constructor(askTimeoutMs = 8000, holdMs = 25_000) {
    this.askTimeoutMs = askTimeoutMs;
    this.holdMs = holdMs;
  }

  /** A page is waiting, or one checked in recently enough that the next pull is coming. */
  get connected() {
    return this.waiter !== null || this.queue.length > 0 || Date.now() - this.touched < this.holdMs;
  }

  /**
   * Wait until a command arrives, the wait runs out, or `cancel` fires
   * (the HTTP request closed). A page that arrives while another is already
   * waiting gets `busy` and should try again.
   */
  pull(waitMs: number, cancel?: Promise<void>): Promise<Pull> {
    this.touched = Date.now();
    const queued = this.queue.shift();
    if (queued) return Promise.resolve({ status: 'job', ...queued });
    if (this.waiter) return Promise.resolve({ status: 'busy' });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: Pull) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.waiter?.resolve === finish) this.waiter = null;
        resolve(result);
      };
      const timer = setTimeout(() => finish({ status: 'idle' }), waitMs);
      cancel?.then(() => finish({ status: 'idle' }));
      this.waiter = { resolve: finish, timer };
    });
  }

  /** Answer the command with this id. False if it already timed out. */
  reply(id: string, body: DeckReply) {
    this.touched = Date.now();
    const pending = this.pending.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(body);
    return true;
  }

  ask(command: unknown): Promise<DeckReply> {
    if (!this.connected) return Promise.reject(new Error(OFFLINE));
    const id = `d${++this.seq}`;
    const job = { id, command };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.queue = this.queue.filter((item) => item.id !== id);
        reject(new Error('The canvas did not answer. Is the Pulse Canvas tab still open?'));
      }, this.askTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const waiter = this.waiter;
      if (waiter) {
        this.waiter = null;
        clearTimeout(waiter.timer);
        waiter.resolve({ status: 'job', ...job });
      } else {
        this.queue.push(job);
      }
    });
  }

  close() {
    const waiter = this.waiter;
    this.waiter = null;
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve({ status: 'idle' });
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Deck closed'));
    }
    this.pending.clear();
    this.queue = [];
  }
}
