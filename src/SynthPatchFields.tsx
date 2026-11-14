import type { SynthPatch, SynthWave } from './engine/synth';
import { cutoffHz, cutoffLabel, cutoffNorm, DEFAULT_PATCH, SYNTH_LIMITS, SYNTH_WAVES } from './engine/synth';
import { Slider } from './ui/Slider';

// The controls one synth machine's patch edits with. The Synth page shows the
// full set next to the keyboard; the block Inspector shows the same fields
// inline, so a patch can be tuned without leaving the canvas.

const WAVE_LABELS: Record<SynthWave, string> = {
  sine: 'Sine',
  triangle: 'Tri',
  square: 'Square',
  sawtooth: 'Saw',
  fatsawtooth: 'Fat saw',
};

const seconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const percent = (v: number) => `${Math.round(v * 100)}%`;
const dB = (v: number) => `${v === 0 ? '' : v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1).replace(/\.0$/, '')} dB`;

interface SynthPatchFieldsProps {
  patch: SynthPatch;
  onChange: (patch: Partial<SynthPatch>) => void;
}

export function SynthPatchFields({ patch, onChange }: SynthPatchFieldsProps) {
  return (
    <>
      <div className="field">
        <span className="field-label">Wave</span>
        <div className="segmented" role="group" aria-label="Wave">
          {SYNTH_WAVES.map((wave) => (
            <button key={wave} className={patch.wave === wave ? 'is-on' : ''} onClick={() => onChange({ wave })}>
              {WAVE_LABELS[wave]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Voices</span>
        <div className="segmented" role="group" aria-label="Voices">
          <button className={patch.mode === 'poly' ? 'is-on' : ''} onClick={() => onChange({ mode: 'poly' })}>
            Poly
          </button>
          <button className={patch.mode === 'mono' ? 'is-on' : ''} onClick={() => onChange({ mode: 'mono' })}>
            Mono
          </button>
        </div>
        <span className="muted">{patch.mode === 'mono' ? 'one voice, so chords fold into the last note' : 'chords ring together'}</span>
      </div>

      <Slider
        label="Cutoff"
        value={cutoffNorm(patch.cutoff)}
        min={0}
        max={1}
        step={0.001}
        reset={cutoffNorm(DEFAULT_PATCH.cutoff)}
        format={() => cutoffLabel(patch.cutoff)}
        onChange={(t) => onChange({ cutoff: Math.round(cutoffHz(t)) })}
      />
      <Slider
        label="Resonance"
        value={patch.q}
        min={SYNTH_LIMITS.q[0]}
        max={SYNTH_LIMITS.q[1]}
        step={0.1}
        reset={DEFAULT_PATCH.q}
        format={(q) => q.toFixed(1)}
        onChange={(q) => onChange({ q: Math.round(q * 10) / 10 })}
      />

      <Slider
        label="Attack"
        value={patch.attack}
        min={0}
        max={2}
        step={0.005}
        reset={DEFAULT_PATCH.attack}
        format={seconds}
        onChange={(attack) => onChange({ attack })}
      />
      <Slider
        label="Decay"
        value={patch.decay}
        min={SYNTH_LIMITS.decay[0]}
        max={3}
        step={0.01}
        reset={DEFAULT_PATCH.decay}
        format={seconds}
        onChange={(decay) => onChange({ decay })}
      />
      <Slider
        label="Sustain"
        value={patch.sustain}
        min={0}
        max={1}
        step={0.01}
        reset={DEFAULT_PATCH.sustain}
        format={percent}
        onChange={(sustain) => onChange({ sustain })}
      />
      <Slider
        label="Release"
        value={patch.release}
        min={SYNTH_LIMITS.release[0]}
        max={5}
        step={0.01}
        reset={DEFAULT_PATCH.release}
        format={seconds}
        onChange={(release) => onChange({ release })}
      />

      {patch.mode === 'mono' && (
        <Slider
          label="Glide"
          value={patch.glide}
          min={0}
          max={0.4}
          step={0.005}
          reset={DEFAULT_PATCH.glide}
          format={(g) => (g === 0 ? 'off' : seconds(g))}
          onChange={(glide) => onChange({ glide })}
        />
      )}

      <Slider
        label="Level"
        value={patch.gain}
        min={SYNTH_LIMITS.gain[0]}
        max={0}
        step={0.5}
        reset={DEFAULT_PATCH.gain}
        format={dB}
        onChange={(gain) => onChange({ gain })}
      />
    </>
  );
}
