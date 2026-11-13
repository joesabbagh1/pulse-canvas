import { describe, expect, it } from 'vitest';
import { perform } from './plan';
import type { DeckInput } from './scene';

function rig(): DeckInput {
  return {
    canvasName: 'Night',
    bpm: 120,
    snap: true,
    playing: true,
    beat: 4,
    blocks: [],
    links: [],
    regions: [],
    takes: [{ id: 'take1', name: 'Kick 1', instrument: 'kick', notes: [{ beat: 0, degree: 0, beats: 0.25, velocity: 1 }] }],
  };
}

describe('playing and recording', () => {
  it('plays a row of notes on an instrument', () => {
    const plan = perform(rig(), {
      op: 'play_instrument',
      instrument: 'piano',
      notes: [
        { degree: 0, beats: 1 },
        { degree: 2, beats: 1 },
      ],
    });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects[0]).toMatchObject({
      type: 'playNotes',
      instrument: 'piano',
      notes: [
        { degree: 0, beats: 1, at: 0, velocity: 1 },
        { degree: 2, beats: 1, at: 1, velocity: 1 },
      ],
    });
    expect(plan.text).toContain('Playing Acoustic grand');
  });

  it('starts a recording and refuses a second one', () => {
    const plan = perform(rig(), { op: 'record', action: 'start' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects).toEqual([{ type: 'recordStart' }]);
    expect(plan.text).toContain('recording');
    const again = perform({ ...rig(), recording: true }, { op: 'record', action: 'start' });
    if ('error' in again) throw new Error(again.error);
    expect(again.effects).toEqual([]);
    expect(again.text).toContain('Already recording');
  });

  it('saves a take and can place one already saved', () => {
    const plan = perform(rig(), {
      op: 'take',
      instrument: 'kick',
      place: true,
      notes: [
        { beat: 0, degree: 0, beats: 0.5 },
        { beat: 1, degree: 0, beats: 0.5 },
      ],
    });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects.map((effect) => effect.type)).toEqual(['saveTake', 'placeTake']);
    expect(plan.text).toContain('Kick 2');
    const placed = perform(rig(), { op: 'take', place: 'Kick 1' });
    if ('error' in placed) throw new Error(placed.error);
    expect(placed.effects[0]).toMatchObject({ type: 'placeTake', take: { id: 'take1' } });
  });
});
