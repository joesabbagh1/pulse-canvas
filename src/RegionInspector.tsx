import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatBeats } from './engine/geometry';
import { DEFAULT_GROOVE, type Groove } from './engine/groove';
import { DEFAULT_FX, DEFAULT_MIX, MIN_LEVEL, toneHz, type Fx, type Mix } from './engine/mixer';
import { loadSampleBytes } from './engine/samples';
import { scaleById, type Scale } from './engine/tuning';
import type { RegionData, RegionNode } from './piece';
import { KeyField } from './KeyField';
import { RootPicker, ScalePicker } from './ScalePicker';
import { regionColor, useSettings } from './settings';

const ECHO_TIMES = [0.25, 0.5, 0.75, 1];
const PUMP_TIMES = [0.25, 0.5, 0.75, 1, 2];
const SWING_GRIDS = [
  { grid: 0.5, label: '8ths' },
  { grid: 0.25, label: '16ths' },
];

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
const percent = (v: number) => `${Math.round(v * 100)}%`;
const formatLevel = (db: number) => (db <= MIN_LEVEL ? '−∞ dB' : `${signed(db)} dB`);
const formatPan = (pan: number) => (pan === 0 ? 'C' : `${pan < 0 ? 'L' : 'R'} ${Math.round(Math.abs(pan) * 100)}`);
function formatTone(tone: number) {
  if (tone >= 1) return 'open';
  const hz = toneHz(tone);
  return hz < 1000 ? `${Math.round(hz)} Hz` : `${(hz / 1000).toFixed(1)} kHz`;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Double-clicking the slider puts it back here. */
  reset: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, reset, format, onChange }: SliderProps) {
  return (
    <label className="slider" title="Double-click to reset">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(reset)}
      />
      <span className="value">{format(value)}</span>
    </label>
  );
}

interface Props {
  region: RegionNode;
  /** Performance keys already given to something else. */
  takenKeys: ReadonlyMap<string, string>;
  onChange: (patch: Partial<RegionData>) => void;
  onImportScale: (scale: Scale) => void;
  onRemoveScale: (scaleId: string) => void;
  onLoadSample: (file: File) => void;
  onDelete: () => void;
}

export function RegionInspector({ region, takenKeys, onChange, onImportScale, onRemoveScale, onLoadSample, onDelete }: Props) {
  const { scales } = useSettings();
  const { name, scaleId, rootHz, mix, fx, groove, sample } = region.data;
  const setMix = (patch: Partial<Mix>) => onChange({ mix: { ...mix, ...patch } });
  const setFx = (patch: Partial<Fx>) => onChange({ fx: { ...fx, ...patch } });
  const setGroove = (patch: Partial<Groove>) => onChange({ groove: { ...groove, ...patch } });
  const fileRef = useRef<HTMLInputElement>(null);

  // Samples live in this browser's storage, so a piece from elsewhere (or
  // after clearing site data) can name one that isn't here.
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let current = true;
    setMissing(false);
    if (sample) void loadSampleBytes(sample.id).then((bytes) => current && setMissing(!bytes));
    return () => {
      current = false;
    };
  }, [sample]);

  return (
    <div className="inspector" style={{ '--c': regionColor(scaleId) } as CSSProperties}>
      <div className="inspector-title">
        <span className="swatch" /> Region
      </div>
      <label className="field">
        <span className="field-label">Name</span>
        <input type="text" value={name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <div className="field">
        <span className="field-label">Key and scale</span>
        <div className="tuning-row">
          <RootPicker value={rootHz} scale={scaleById(scaleId, scales)} label="Region key" onChange={(hz) => onChange({ rootHz: hz })} />
          <ScalePicker
            value={scaleId}
            label="Region scale"
            onChange={(id) => onChange({ scaleId: id })}
            onImport={onImportScale}
            onRemove={onRemoveScale}
          />
        </div>
      </div>

      <div className="field">
        <div className="field-head">
          <span className="field-label">Mix</span>
          <label className="toggle">
            <input type="checkbox" checked={mix.mute} onChange={(e) => setMix({ mute: e.target.checked })} />
            <span>Mute</span>
          </label>
        </div>
        <Slider label="Level" value={mix.level} min={MIN_LEVEL} max={6} step={1} reset={DEFAULT_MIX.level} format={formatLevel} onChange={(level) => setMix({ level })} />
        <Slider label="Pan" value={mix.pan} min={-1} max={1} step={0.05} reset={DEFAULT_MIX.pan} format={formatPan} onChange={(pan) => setMix({ pan })} />
      </div>

      <div className="field">
        <span className="field-label">Effects</span>
        <Slider label="Tone" value={fx.tone} min={0} max={1} step={0.01} reset={DEFAULT_FX.tone} format={formatTone} onChange={(tone) => setFx({ tone })} />
        <Slider label="Echo" value={fx.echo} min={0} max={1} step={0.01} reset={DEFAULT_FX.echo} format={percent} onChange={(echo) => setFx({ echo })} />
        <div className="slider">
          <span className="slider-label">Echo time</span>
          <div className="segmented" role="group" aria-label="Echo time in beats">
            {ECHO_TIMES.map((beats) => (
              <button key={beats} className={beats === fx.echoBeats ? 'is-on' : ''} onClick={() => setFx({ echoBeats: beats })}>
                {formatBeats(beats, true)}
              </button>
            ))}
          </div>
          <span className="value">beat</span>
        </div>
        <Slider label="Reverb" value={fx.reverb} min={0} max={1} step={0.01} reset={DEFAULT_FX.reverb} format={percent} onChange={(reverb) => setFx({ reverb })} />
        <Slider label="Drive" value={fx.drive} min={0} max={1} step={0.01} reset={DEFAULT_FX.drive} format={percent} onChange={(drive) => setFx({ drive })} />
        <Slider label="Pump" value={fx.pump} min={0} max={1} step={0.01} reset={DEFAULT_FX.pump} format={percent} onChange={(pump) => setFx({ pump })} />
        <div className="slider">
          <span className="slider-label">Pump time</span>
          <div className="segmented" role="group" aria-label="Pump time in beats">
            {PUMP_TIMES.map((beats) => (
              <button key={beats} className={beats === fx.pumpBeats ? 'is-on' : ''} onClick={() => setFx({ pumpBeats: beats })}>
                {formatBeats(beats, true)}
              </button>
            ))}
          </div>
          <span className="value">beat</span>
        </div>
        <span className="muted">Dips when a kick plays in another region, then comes back. Kicks in this region leave it alone.</span>
      </div>

      <div className="field">
        <span className="field-label">Groove</span>
        <Slider label="Swing" value={groove.swing} min={0} max={1} step={0.01} reset={DEFAULT_GROOVE.swing} format={percent} onChange={(swing) => setGroove({ swing })} />
        <div className="slider">
          <span className="slider-label">Swing on</span>
          <div className="segmented" role="group" aria-label="Which notes swing">
            {SWING_GRIDS.map(({ grid, label }) => (
              <button key={grid} className={grid === groove.swingGrid ? 'is-on' : ''} onClick={() => setGroove({ swingGrid: grid })}>
                {label}
              </button>
            ))}
          </div>
          <span className="value" />
        </div>
        <Slider
          label="Humanize"
          value={groove.humanize}
          min={0}
          max={1}
          step={0.01}
          reset={DEFAULT_GROOVE.humanize}
          format={percent}
          onChange={(humanize) => setGroove({ humanize })}
        />
        <span className="muted">Moves when notes sound, never when pulses arrive, so loops stay in time.</span>
      </div>

      <KeyField value={region.data.key} does="mutes and unmutes this region" taken={takenKeys} onChange={(key) => onChange({ key })} />

      <div className="field">
        <span className="field-label">Sample</span>
        <div className="row">
          <span className={`sample-name${missing ? ' warn' : ''}`} title={sample?.name}>
            {sample ? (missing ? `${sample.name} is missing` : sample.name) : 'None: tones use the synth'}
          </span>
          <button onClick={() => fileRef.current?.click()}>{sample ? 'Replace…' : 'Load…'}</button>
          {sample && <button onClick={() => onChange({ sample: undefined })}>Remove</button>}
        </div>
        <span className="muted">
          {missing
            ? "This browser doesn't have the file any more, so tones use the synth. Load it again to bring it back."
            : 'Tones in this region play the sample, pitched as if it were recorded at C4.'}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          aria-label="Sample file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onLoadSample(file);
          }}
        />
      </div>

      <p className="muted">
        Blocks inside play in this region's tuning and through its mix and effects; move one out and it changes. Drag
        the tab to move the region with everything in it, or its edges to resize it.
      </p>
      <div className="row">
        <button className="danger" onClick={onDelete}>
          Delete region
        </button>
      </div>
    </div>
  );
}
