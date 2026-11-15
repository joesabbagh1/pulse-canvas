import { describe, expect, it } from 'vitest';
import { guardTimers, type TimerQueue } from './timers';

/** Runs due timers the way Tone's context does: in order, removing each only after it returns. */
class Queue implements TimerQueue {
  private waiting: { fn: () => void; time: number }[] = [];
  private now = 0;

  setTimeout(fn: () => void, timeout: number) {
    this.waiting.push({ fn, time: this.now + timeout });
    this.waiting.sort((a, b) => a.time - b.time);
    return this.waiting.length;
  }

  // Modeled on Tone's Context.setInterval: the re-arm lives inside the
  // callback and reaches past setTimeout, straight onto the queue.
  setInterval(fn: () => void, interval: number) {
    const rearm = () => {
      this.waiting.push({ fn: () => { fn(); rearm(); }, time: this.now + interval });
      this.waiting.sort((a, b) => a.time - b.time);
    };
    rearm();
    return this.waiting.length;
  }

  advance(seconds: number) {
    this.now += seconds;
    for (const entry of this.waiting.filter((item) => item.time <= this.now)) {
      entry.fn();
      this.waiting = this.waiting.filter((item) => item !== entry);
    }
  }
}

function tick(queue: Queue) {
  try {
    queue.advance(1);
  } catch {
    // Tone's clock swallows it too, and comes back on the next tick.
  }
}

describe('guarded timers', () => {
  it('a timer that throws blocks every timer behind it', () => {
    const queue = new Queue();
    const ran: string[] = [];
    queue.setTimeout(() => {
      throw new Error('bad ramp');
    }, 1);
    queue.setTimeout(() => ran.push('tick'), 2);
    for (let i = 0; i < 5; i++) tick(queue);
    expect(ran).toEqual([]);
  });

  it('reports the failure and keeps the queue moving', () => {
    const queue = new Queue();
    const ran: string[] = [];
    const failed: unknown[] = [];
    guardTimers(queue, (err) => failed.push(err));
    queue.setTimeout(() => {
      throw new Error('bad ramp');
    }, 1);
    queue.setTimeout(() => ran.push('tick'), 2);
    for (let i = 0; i < 5; i++) tick(queue);
    expect(ran).toEqual(['tick']);
    expect(failed).toHaveLength(1);
  });

  it('a repeating timer that throws stops repeating and wedges the queue', () => {
    const queue = new Queue();
    const ran: string[] = [];
    queue.setInterval(() => {
      throw new Error('bad tick');
    }, 1);
    queue.setTimeout(() => ran.push('tick'), 2);
    for (let i = 0; i < 5; i++) tick(queue);
    expect(ran).toEqual([]);
  });

  it('a guarded repeating timer reports the throw and keeps repeating', () => {
    const queue = new Queue();
    const ran: string[] = [];
    const failed: unknown[] = [];
    let fired = 0;
    guardTimers(queue, (err) => failed.push(err));
    queue.setInterval(() => {
      fired++;
      throw new Error('bad tick');
    }, 1);
    queue.setTimeout(() => ran.push('tick'), 2);
    for (let i = 0; i < 5; i++) tick(queue);
    expect(fired).toBe(5);
    expect(failed).toHaveLength(5);
    expect(ran).toEqual(['tick']);
  });

  it('wraps a queue once', () => {
    const queue = new Queue();
    const failed: unknown[] = [];
    guardTimers(queue, (err) => failed.push(err));
    guardTimers(queue, (err) => failed.push(err));
    queue.setTimeout(() => {
      throw new Error('bad ramp');
    }, 1);
    tick(queue);
    expect(failed).toHaveLength(1);
  });
});
