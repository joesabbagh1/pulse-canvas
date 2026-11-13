import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('steps back and forward through commits', () => {
    const h = new History('a');
    expect(h.commit('b')).toBe(true);
    expect(h.commit('c')).toBe(true);
    expect([h.undo(), h.undo(), h.undo()]).toEqual(['b', 'a', null]);
    expect([h.redo(), h.redo(), h.redo()]).toEqual(['b', 'c', null]);
  });

  it('ignores a commit that changes nothing', () => {
    const h = new History('a');
    expect(h.commit('a')).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('forgets the redo steps once something new happens', () => {
    const h = new History('a');
    h.commit('b');
    h.undo();
    expect(h.canRedo).toBe(true);
    h.commit('c');
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('a');
  });

  it('can take a new present without making a step', () => {
    const h = new History('a');
    h.commit('b');
    h.rebase('b, redrawn');
    expect(h.present).toBe('b, redrawn');
    expect(h.undo()).toBe('a');
  });

  it('keeps the last 200 steps', () => {
    const h = new History('0');
    for (let i = 1; i <= 250; i++) h.commit(String(i));
    let oldest = '';
    for (let s = h.undo(); s !== null; s = h.undo()) oldest = s;
    expect(oldest).toBe('50');
  });
});
