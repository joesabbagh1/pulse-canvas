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
    regions: [
      {
        id: 'drums',
        name: 'Drums',
        key: 'd',
        x: -120,
        y: -120,
        w: 600,
        h: 400,
        mix: { level: 0, pan: 0, mute: false },
        fx: { tone: 1, echo: 0, echoBeats: 0.75, reverb: 0.25, drive: 0, pump: 0, pumpBeats: 0.5 },
        groove: { swing: 0, swingGrid: 0.5, humanize: 0 },
      },
    ],
    blocks: [
      { id: 's', kind: 'start', degree: 0, every: 0, key: 'a', x: 0, y: 0 },
      { id: 'k', kind: 'kick', degree: 0, every: 0, x: PX_PER_BEAT, y: 0 },
    ],
    links: [
      { id: 'sk', from: 's', to: 'k', bends: [] },
      { id: 'ks', from: 'k', to: 's', bends: [] },
    ],
  };
}

describe('deck plan', () => {
  it('reads the canvas in beats', () => {
    const plan = perform(rig(), { op: 'look' });
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.text).toContain('Night · 112 bpm · stopped · snap ¼');
    expect(plan.text).toContain('The parts line up every 2 beats.');
    expect(plan.text).toContain('Drums (drums) · key D · on · 0 dB · center');
    expect(plan.text).toContain('Start (s) · key A · fires once when play starts · at 0, 0 · in Drums');
    expect(plan.text).toContain('Kick (k) · degree 0 · at 1, 0 · in Drums');
    expect(plan.text).toContain('sk · Start → Kick · 1 beat');
    expect(plan.text).toContain('Start → Kick · 2 beats');
  });

  it('starts playback and sets the tempo', () => {
    const plan = perform(rig(), { op: 'transport', action: 'play', bpm: 128 });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects).toEqual([
      { type: 'bpm', bpm: 128 },
      { type: 'play' },
    ]);
    expect(plan.text).toContain('Tempo is 128 bpm.');
    expect(plan.text).toContain('Playing.');
    expect(plan.text).toContain('128 bpm · playing');
  });

  it('refuses a tempo outside the bar', () => {
    const plan = perform(rig(), { op: 'transport', bpm: 20 });
    expect(plan).toEqual({ error: 'Tempo is from 50 to 200.' });
  });

  it('fires a start block by its key only while playing', () => {
    expect(perform(rig(), { op: 'hit', block: 'a' })).toEqual({ error: 'The canvas is stopped. Play first, then hit.' });
    const live = { ...rig(), playing: true, beat: 4 };
    const plan = perform(live, { op: 'hit', block: 'a' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects).toEqual([{ type: 'fire', id: 's' }]);
    expect(plan.text).toContain('Fired a pulse from Start (s, key A).');
  });

  it('points a region key at mix, not hit', () => {
    const plan = perform({ ...rig(), playing: true }, { op: 'hit', block: 'd' });
    expect(plan).toEqual({ error: 'D mutes Drums. Hit takes a block.' });
  });

  it('mutes a region by name', () => {
    const plan = perform(rig(), { op: 'mix', region: 'drums', mute: true, level: -6 });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects).toEqual([{ type: 'region', id: 'drums', mix: { mute: true, level: -6 } }]);
    expect(plan.text).toContain('Drums: muted, -6 dB.');
    expect(plan.text).toContain('muted · -6 dB');
  });

  it('moves a block and reports the new link lengths', () => {
    const plan = perform(rig(), { op: 'nudge', block: 'kick', dx: 1, dy: 0 });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects).toEqual([{ type: 'move', id: 'k', x: PX_PER_BEAT * 2, y: 0 }]);
    expect(plan.text).toContain('Moved Kick right 1 beat.');
    expect(plan.text).toContain('Start → Kick is now 2 beats (was 1 beat)');
    expect(plan.text).toContain('at 2, 0');
  });

  it('asks for an id when two blocks share a name', () => {
    const input = rig();
    input.blocks.push({ id: 'k2', kind: 'kick', degree: 0, every: 0, x: 0, y: PX_PER_BEAT });
    const plan = perform(input, { op: 'nudge', block: 'kick', dx: 1, dy: 0 });
    expect('error' in plan && plan.error).toMatch(/matches/);
  });

  it('refuses to shorten a link past the straight line', () => {
    const plan = perform(rig(), { op: 'stretch', link: 'Start to Kick', beats: 0.5 });
    expect('error' in plan && plan.error).toMatch(/straight line/);
  });

  it('sets drive and pump on a region', () => {
    const plan = perform(rig(), { op: 'mix', region: 'drums', drive: 0.5, pump: 0.75, pumpBeats: 0.5 });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects).toEqual([{ type: 'region', id: 'drums', fx: { drive: 0.5, pump: 0.75, pumpBeats: 0.5 } }]);
    expect(plan.text).toContain('drive 50%');
    expect(plan.text).toContain('pump 75%');
    expect(plan.text).toContain('pump 75% over ½');
  });

  it('bends a link out to a longer travel time', () => {
    const plan = perform(rig(), { op: 'stretch', link: 'sk', beats: 2 });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.effects[0]).toMatchObject({ type: 'bends', id: 'sk' });
    const bends = plan.effects[0].type === 'bends' ? plan.effects[0].bends : [];
    expect(bends.length).toBeGreaterThan(0);
    expect(plan.text).toContain('Start → Kick is now 2 beats (was 1 beat).');
  });
});
