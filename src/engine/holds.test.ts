import { describe, expect, it } from 'vitest';
import { HoldBook } from './holds';
import { VoiceReserve } from './pool';

describe('held voices', () => {
  it('reserves one voice and leaves the other free', () => {
    const reserve = new VoiceReserve(2);
    const first = reserve.hold(0);
    const second = reserve.hold(0.01);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(reserve.take(0.02)).toBeNull();

    reserve.free(first!, 1);
    expect(reserve.isHeld(first!)).toBe(false);
    expect(reserve.isHeld(second!)).toBe(true);
    expect(reserve.take(1.1)).toBe(first);
  });
});

describe('live holds', () => {
  it('releases a note that was let go before the voice started', () => {
    const book = new HoldBook();
    const id = book.open();
    const released: number[] = [];
    book.release(id, 1);
    book.start(id, 2, { release: (time) => released.push(time) });
    expect(released).toEqual([2]);
    book.release(id, 3);
    expect(released).toEqual([2]);
  });

  it('does not choke a strike that already played', () => {
    const book = new HoldBook();
    const id = book.open();
    const released: number[] = [];
    book.release(id, 1);
    book.start(id, 2, { release: (time) => released.push(time), once: true });
    expect(released).toEqual([]);
  });

  it('releases only the note that came up', () => {
    const book = new HoldBook();
    const first = book.open();
    const second = book.open();
    const released: string[] = [];
    book.start(first, 0, { release: () => released.push('first') });
    book.start(second, 0, { release: () => released.push('second') });
    book.release(first, 1);
    expect(released).toEqual(['first']);
    book.release(second, 2);
    expect(released).toEqual(['first', 'second']);
  });
});
