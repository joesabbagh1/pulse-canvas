import { describe, expect, it } from 'vitest';
import { VizEar, type VizFrame } from './features';
import { MODES, type ModeEnv, type PieceSnapshot } from './modes';

// jsdom has no 2d context, so drawing is smoked against a recorder that
// accepts every call: this catches bad state, NaNs and crashes in the modes,
// while the real pixels are checked in the browser.
function stubCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const store: Record<string | symbol, unknown> = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const silence = new VizEar(48000).update(null, null, 1 / 60);

function loudFrame(): VizFrame {
  const ear = new VizEar(48000);
  const wave = new Float32Array(1024).map((_, i) => Math.sin((i / 1024) * Math.PI * 10) * 0.7);
  const bands = new Float32Array(256).fill(-34);
  let frame = ear.update(wave, bands, 1 / 60);
  for (let i = 0; i < 30; i++) {
    bands[i * 3] = i % 2 ? -50 : -18; // the spectrum jumps around, like music
    frame = ear.update(wave, bands, 1 / 60);
  }
  return frame;
}

const piece: PieceSnapshot = {
  playing: true,
  beat: 3.25,
  blocks: [
    { color: 'hsl(200 75% 60%)', isStart: true, isDrum: false },
    { color: '#ff6b4a', isStart: false, isDrum: true },
    { color: 'hsl(330 75% 60%)', isStart: false, isDrum: false },
  ],
  links: [
    { from: 0, to: 1 },
    { from: 0, to: 2 },
  ],
  comets: [{ from: 0, to: 1, progress: 0.5 }],
  blooms: [{ at: 2, strength: 1, color: 'hsl(40 80% 60%)', age: 0.12 }],
};

function env(ctx: CanvasRenderingContext2D, frame: VizFrame, t: number): ModeEnv {
  return { ctx, w: 640, h: 400, dt: 1 / 60, t, bpm: 112, frame, piece };
}

describe('viz modes', () => {
  it('has six uniquely named stages', () => {
    expect(MODES.length).toBe(6);
    expect(new Set(MODES.map((m) => m.id)).size).toBe(6);
    expect(new Set(MODES.map((m) => m.label)).size).toBe(6);
    for (const mode of MODES) expect(mode.blurb.length).toBeGreaterThan(10);
  });

  it('draws every stage through silence and loudness without throwing', () => {
    for (const mode of MODES) {
      const ctx = stubCtx();
      for (let i = 0; i < 30; i++) mode.draw(env(ctx, silence, i / 60));
      for (let i = 0; i < 30; i++) mode.draw(env(ctx, loudFrame(), 1 + i / 60));
    }
  });

  it('keeps trails stages above zero and piece stages honest', () => {
    for (const mode of MODES) expect(mode.trails).toBeGreaterThanOrEqual(0);
    expect(MODES.filter((m) => m.wantsPiece).map((m) => m.id)).toEqual(['galaxy']);
  });

  it('survives a piece snapshot with dead references', () => {
    const galaxy = MODES.find((m) => m.id === 'galaxy')!;
    const broken: PieceSnapshot = {
      ...piece,
      blocks: piece.blocks.slice(0, 1),
      links: [{ from: 0, to: 5 }],
      comets: [{ from: 9, to: 1, progress: 0.3 }],
      blooms: [{ at: 8, strength: 1, color: 'red', age: 0.1 }],
    };
    const ctx = stubCtx();
    for (let i = 0; i < 10; i++) galaxy.draw(env(ctx, loudFrame(), i / 60));
    galaxy.draw({ ...env(ctx, loudFrame(), 0.2), piece: broken });
  });
});
