import { describe, expect, it } from 'vitest';
import { playhead } from './playhead';

describe('playhead', () => {
  const marks = [
    { at: 0, span: 0.17 },
    { at: 0.17, span: 0.33 },
    { at: 0.5, span: 0.17 },
    { at: 0.67, span: 0.33 },
  ];

  it('comes in from the inlet, then sits on each note until the next one', () => {
    expect(playhead(-1, marks)).toEqual({ kind: 'on', index: 0 });
    expect(playhead(0.1, marks)).toEqual({ kind: 'on', index: 0 });
    expect(playhead(0.17, marks)).toEqual({ kind: 'on', index: 1 });
    expect(playhead(0.4, marks)).toEqual({ kind: 'on', index: 1 });
    expect(playhead(0.5, marks)).toEqual({ kind: 'on', index: 2 });
    expect(playhead(0.66, marks)).toEqual({ kind: 'on', index: 2 });
    expect(playhead(0.67, marks)).toEqual({ kind: 'on', index: 3 });
  });

  it('walks from the inlet to a note that does not start at the edge, and leaves after the last one', () => {
    const late = [{ at: 0.5, span: 0.25 }];
    expect(playhead(0, late)).toEqual({ kind: 'toward', index: 0, u: 0 });
    expect(playhead(0.25, late)).toEqual({ kind: 'toward', index: 0, u: 0.5 });
    expect(playhead(0.5, late)).toEqual({ kind: 'on', index: 0 });
    expect(playhead(0.75, late)).toEqual({ kind: 'leave', index: 0, u: 0 });
    expect(playhead(0.875, late)).toEqual({ kind: 'leave', index: 0, u: 0.5 });
    expect(playhead(1, late)).toEqual({ kind: 'leave', index: 0, u: 1 });
  });

  it('crosses an empty pattern from inlet to outlet', () => {
    expect(playhead(0.25, [])).toEqual({ kind: 'across', u: 0.25 });
  });
});
