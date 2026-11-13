import { describe, expect, it } from 'vitest';
import { PX_PER_BEAT } from '../engine/geometry';
import { perform } from './plan';
import type { DeckInput } from './scene';

function rig(): DeckInput {
  return {
    canvasName: 'Night',
    bpm: 112,
    snap: true,
    playing: false,
    beat: 0,
    scaleId: 'major',
    scaleName: 'Major',
    rootHz: 261.6256,
    blocks: [
      { id: 's', kind: 'start', degree: 0, every: 0, key: 'a', x: 0, y: 0 },
      { id: 'k', kind: 'kick', degree: 0, every: 0, x: PX_PER_BEAT, y: 0 },
    ],
    links: [{ id: 'sk', from: 's', to: 'k', bends: [] }],
    regions: [],
  };
}

describe('deck building', () => {
  it('adds a block and links it from another', () => {
    const plan = perform(rig(), { op: 'add_block', kind: 'tone', from: 'start', degree: 2 });
    if ('error' in plan) throw new Error(plan.error);
    const added = plan.effects.find((effect) => effect.type === 'addBlock');
    const linked = plan.effects.find((effect) => effect.type === 'addLink');
    expect(added && added.type === 'addBlock' && added.block.kind).toBe('tone');
    expect(added && added.type === 'addBlock' && added.block.degree).toBe(2);
    expect(linked && linked.type === 'addLink' && linked.link.from).toBe('s');
    expect(plan.text).toContain('Added Tone');
    expect(plan.text).toContain('Linked from Start');
  });

  it('rejects a pattern the parser cannot read', () => {
    const plan = perform(rig(), { op: 'add_block', kind: 'tone', pattern: '[[[', x: 0, y: 1 });
    expect('error' in plan).toBe(true);
  });

  it('refuses a second link the same way', () => {
    const plan = perform(rig(), { op: 'link', from: 's', to: 'kick' });
    expect(plan).toMatchObject({ error: expect.stringMatching(/already links/) });
  });

  it('edits a block and removes it with its links', () => {
    const edited = perform(rig(), { op: 'edit_block', block: 'k', degree: 5, code: 'drop' });
    if ('error' in edited) throw new Error(edited.error);
    expect(edited.effects).toEqual([expect.objectContaining({ type: 'putBlock' })]);
    expect(edited.text).toContain('code "drop"');
    const removed = perform(rig(), { op: 'remove', target: 'kick' });
    if ('error' in removed) throw new Error(removed.error);
    expect(removed.effects[0]).toMatchObject({ type: 'drop', blockIds: ['k'], linkIds: ['sk'] });
    expect(removed.text).toContain('Removed Kick (k)');
    expect(removed.text).toContain('Links, whose length is the time a pulse takes to travel:\n- none');
  });

  it('wraps blocks in a region and retunes the canvas', () => {
    const region = perform(rig(), { op: 'add_region', name: 'Drums', around: 'kick', key: 'd' });
    if ('error' in region) throw new Error(region.error);
    expect(region.effects[0]).toMatchObject({ type: 'addRegion' });
    expect(region.text).toContain('Drums');
    const tuned = perform(rig(), { op: 'tune', scale: 'major', root: 'D', snap: false });
    if ('error' in tuned) throw new Error(tuned.error);
    expect(tuned.effects[0]).toMatchObject({ type: 'tune', scaleId: 'major', snap: false });
    expect(tuned.text).toContain('Major');
    expect(tuned.text).toContain('snap off');
  });

  it('drops a sine wave', () => {
    const plan = perform(rig(), { op: 'wave', stamp: 'sine', x: 1, y: 0 });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects[0]).toMatchObject({ type: 'addWave' });
    expect(plan.text).toContain('sine cycle');
  });

  it('lists instruments that match a query', () => {
    const plan = perform(rig(), { op: 'catalog', query: 'kick' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects).toEqual([]);
    expect(plan.text).toContain('kick — Kick');
  });
});
