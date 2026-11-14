import { describe, expect, it } from 'vitest';
import { perform } from './plan';
import type { DeckBed, DeckInput } from './scene';

function rig(): DeckInput {
  return {
    canvasName: 'Night',
    canvasId: 'c1',
    bpm: 120,
    snap: true,
    playing: false,
    beat: 0,
    canvases: [
      { id: 'c1', name: 'Night' },
      { id: 'c2', name: 'Canvas' },
    ],
    blocks: [{ id: 's', kind: 'start', degree: 0, every: 0, x: 0, y: 0 }],
    links: [],
    regions: [
      {
        id: 'drums',
        name: 'Drums',
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        mix: { level: 0, pan: 0, mute: false },
        fx: { tone: 1, echo: 0, echoBeats: 0.75, reverb: 0, drive: 0, pump: 0, pumpBeats: 0.5 },
        groove: { swing: 0, swingGrid: 0.5, humanize: 0 },
        sample: { id: 'smp-1', name: 'kick.wav' },
      },
    ],
    canUndo: true,
    canRedo: false,
  };
}

function bed(): DeckBed {
  return {
    name: 'room.wav',
    sampleId: 'smp-bed',
    duration: 4,
    level: 0.8,
    clips: [{ id: 'cut-1', beat: 0, offset: 0, seconds: 4, gain: 1, fadeIn: 0, fadeOut: 0, mute: false }],
  };
}

describe('deck library', () => {
  it('lists canvases on look and opens one by name', () => {
    const look = perform(rig(), { op: 'look' });
    if ('error' in look) throw new Error(look.error);
    expect(look.text).toContain('Canvases: Night (c1, open), Canvas (c2)');
    expect(look.text).toContain('sample "kick.wav"');
    const opened = perform(rig(), { op: 'open_canvas', canvas: 'canvas' });
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.effects).toEqual([{ type: 'openCanvas', id: 'c2' }]);
    expect(opened.reread).toBe(true);
    const same = perform(rig(), { op: 'open_canvas', canvas: 'Night' });
    if ('error' in same) throw new Error(same.error);
    expect(same.effects).toEqual([]);
    expect(same.text).toContain('already open');
  });

  it('renames the open canvas and refuses a shared name without an id', () => {
    const plan = perform(rig(), { op: 'rename_canvas', name: '  Night drive  ' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects).toEqual([{ type: 'renameCanvas', id: 'c1', name: 'Night drive' }]);
    expect(plan.text).toContain('Night drive · 120 bpm');
    const twin = {
      ...rig(),
      canvases: [
        { id: 'c1', name: 'Night' },
        { id: 'c2', name: 'Night' },
      ],
    };
    expect(perform(twin, { op: 'open_canvas', canvas: 'Night' })).toMatchObject({ error: expect.stringMatching(/Say which id/) });
  });

  it('deletes a canvas and undoes only when there is a step', () => {
    const gone = perform(rig(), { op: 'delete_canvas', canvas: 'c2' });
    if ('error' in gone) throw new Error(gone.error);
    expect(gone.effects).toEqual([{ type: 'deleteCanvas', id: 'c2' }]);
    expect(gone.text).toContain('Night stays open');
    const last = perform({ ...rig(), canvases: [{ id: 'c1', name: 'Night' }] }, { op: 'delete_canvas' });
    if ('error' in last) throw new Error(last.error);
    expect(last.text).toContain('blank canvas');
    const undone = perform(rig(), { op: 'undo' });
    if ('error' in undone) throw new Error(undone.error);
    expect(undone.effects).toEqual([{ type: 'undo' }]);
    expect(perform({ ...rig(), canUndo: false }, { op: 'undo' })).toMatchObject({ error: 'Nothing to undo.' });
    expect(perform(rig(), { op: 'redo' })).toMatchObject({ error: 'Nothing to redo.' });
  });

  it('lists examples and opens one by a piece of its title', () => {
    const list = perform(rig(), { op: 'examples' });
    if ('error' in list) throw new Error(list.error);
    expect(list.text).toContain('tour · The tour');
    expect(list.text).toContain('techno · Four on the floor');
    const opened = perform(rig(), { op: 'open_example', example: 'elise' });
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.effects).toEqual([{ type: 'openExample', id: 'elise' }]);
    expect(opened.text).toContain('Für Elise');
  });
});

describe('deck background and samples', () => {
  it('moves, splits and removes the background', () => {
    const input = { ...rig(), bed: bed() };
    const moved = perform(input, { op: 'bed', beat: 2 });
    if ('error' in moved) throw new Error(moved.error);
    expect(moved.effects[0]).toMatchObject({ type: 'setBed' });
    expect(moved.text).toContain('at 2 beats');
    const split = perform(input, { op: 'bed', split: true });
    if ('error' in split) throw new Error(split.error);
    expect(split.text).toContain('Split cut-1');
    if (split.effects[0].type !== 'setBed' || !split.effects[0].bed) throw new Error('expected a bed');
    expect(split.effects[0].bed.clips).toHaveLength(2);
    const cleared = perform(input, { op: 'bed', clear: true });
    if ('error' in cleared) throw new Error(cleared.error);
    expect(cleared.effects).toEqual([{ type: 'setBed', bed: null }]);
    expect(perform(rig(), { op: 'bed', level: 0.5 })).toMatchObject({ error: expect.stringMatching(/no background/) });
  });

  it('copies the background onto a region and clears it', () => {
    const input = { ...rig(), bed: bed() };
    const copied = perform(input, { op: 'sample', region: 'drums', from: 'bed' });
    if ('error' in copied) throw new Error(copied.error);
    expect(copied.effects).toEqual([{ type: 'regionSample', id: 'drums', sample: { id: 'smp-bed', name: 'room.wav' } }]);
    expect(copied.text).toContain('sample "room.wav"');
    const cleared = perform(input, { op: 'sample', region: 'Drums', clear: true });
    if ('error' in cleared) throw new Error(cleared.error);
    expect(cleared.effects[0]).toMatchObject({ type: 'regionSample', sample: null });
    expect(cleared.text).not.toContain('sample "kick.wav"');
  });

  it('shows the background when look is asked', () => {
    const plan = perform({ ...rig(), bed: null }, { op: 'look' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.text).toContain('Background: none');
    const withBed = perform({ ...rig(), bed: bed() }, { op: 'look' });
    if ('error' in withBed) throw new Error(withBed.error);
    expect(withBed.text).toContain('Background: room.wav · level 80%');
    expect(withBed.text).toContain('cut-1 · at 0 beats · 8 beats');
  });
});
