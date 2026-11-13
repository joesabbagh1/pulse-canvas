import { describe, expect, it } from 'vitest';
import { livePass, setLivePasses } from './livePass';

describe('livePass', () => {
  it('keeps the same object while a pass is unchanged, and drops it when the pulse leaves', () => {
    setLivePasses([{ id: 'box', fast: 2, rev: true, cycle: 3, shift: 0 }]);
    const first = livePass('box');
    setLivePasses([{ id: 'box', fast: 2, rev: true, cycle: 3, shift: 0 }]);
    expect(livePass('box')).toBe(first);
    setLivePasses([{ id: 'box', fast: 1, rev: false, cycle: 4, shift: 7 }]);
    expect(livePass('box')).toEqual({ fast: 1, rev: false, cycle: 4, shift: 7 });
    setLivePasses([]);
    expect(livePass('box')).toBeNull();
  });
});
