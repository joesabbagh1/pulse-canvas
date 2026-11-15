import { describe, expect, it } from 'vitest';
import { VizEar } from './features';

const SR = 48000;
const FRAME = 1 / 60;

/** An FFT whose bins sit at -100 dB except where a peak is placed. */
const spectrum = (n: number, peaks: [bin: number, db: number][]) => {
  const a = new Float32Array(n).fill(-100);
  for (const [bin, db] of peaks) a[bin] = db;
  return a;
};

/** A sine that fills `cycles` periods, at `amp` peak. */
const sine = (n: number, cycles: number, amp: number) =>
  new Float32Array(n).map((_, i) => Math.sin((i / n) * Math.PI * 2 * cycles) * amp);

describe('viz ear', () => {
  it('reads silence before the mixer exists (null taps)', () => {
    const ear = new VizEar(SR);
    const frame = ear.update(null, null, FRAME);
    expect(frame.silent).toBe(true);
    expect(frame.rms).toBe(0);
    expect(frame.onset).toBe(0);
    expect(frame.pitchClass).toBeNull();
    expect(frame.bands.length).toBe(0);
  });

  it('measures a sine: peak at once, rms as the envelope settles', () => {
    const ear = new VizEar(SR);
    const wave = sine(1024, 4, 0.5);
    const first = ear.update(wave, null, FRAME);
    expect(first.peak).toBeCloseTo(0.5, 5);
    let frame = first;
    for (let i = 0; i < 120; i++) frame = ear.update(wave, null, FRAME);
    expect(frame.rms).toBeCloseTo(Math.SQRT1_2 * 0.5, 2);
    expect(frame.silent).toBe(false);
  });

  it('splits the spectrum into bands and reads brightness from the centre of mass', () => {
    // 256 bins at 48 kHz: each bin is 93.75 Hz, so bass ends at bin 3.
    const ear = new VizEar(SR);
    ear.update(null, spectrum(256, [[2, -10]]), FRAME);
    const low = ear.update(null, spectrum(256, [[2, -10]]), FRAME);
    expect(low.bass).toBeGreaterThan(0.3);
    expect(low.mid).toBe(0);
    expect(low.centroid).toBeLessThan(0.1);

    const high = ear.update(null, spectrum(256, [[80, -10]]), FRAME);
    expect(high.bass).toBe(0);
    expect(high.centroid).toBeGreaterThan(0.8);
  });

  it('holds the loudest partial as a pitch class, after a couple of votes', () => {
    // 2048 bins at 48 kHz: bin 37 is centred on 439 Hz — an A above middle C.
    const ear = new VizEar(SR);
    const spectrumA = spectrum(2048, [[37, -20]]);
    expect(ear.update(null, spectrumA, FRAME).pitchClass).toBeNull();
    expect(ear.update(null, spectrumA, FRAME).pitchClass).toBe(9);
    // A new note wins over the old once its votes add up.
    const spectrumC = spectrum(2048, [[26, -20]]); // ~310 Hz, D# above middle C
    expect(ear.update(null, spectrumC, FRAME).pitchClass).toBe(9);
    for (let i = 0; i < 6; i++) ear.update(null, spectrumC, FRAME);
    expect(ear.update(null, spectrumC, FRAME).pitchClass).toBe(3);
  });

  it('finds onsets in the flux, honours the refractory gap, and forgets', () => {
    const ear = new VizEar(SR);
    const quiet = spectrum(256, []);
    const loud = spectrum(256, Array.from({ length: 40 }, (_, b) => [b * 2 + 1, -20] as [number, number]));
    for (let i = 0; i < 60; i++) ear.update(null, quiet, FRAME);
    const hit = ear.update(null, loud, FRAME);
    expect(hit.onsetCount).toBe(1);
    expect(hit.onset).toBeGreaterThan(0.4);

    // An immediate second spike lands inside the refractory gap: one onset only.
    ear.update(null, quiet, FRAME);
    ear.update(null, loud, FRAME);
    expect(ear.update(null, quiet, FRAME).onsetCount).toBe(1);

    // After quiet frames the next hit counts again.
    for (let i = 0; i < 12; i++) ear.update(null, quiet, FRAME);
    expect(ear.update(null, loud, FRAME).onsetCount).toBe(2);
    // And the envelope decays while the sound holds steady.
    const steady = ear.update(null, loud, FRAME);
    expect(steady.onset).toBeLessThan(hit.onset);
  });
});
