import { useEffect, useState, type CSSProperties } from 'react';
import { CodeField } from './CodeField';
import { KeyField } from './KeyField';
import { GRID, MAX_SPAN, MIN_SPAN, formatBeats, parseLength, spanOf } from './engine/geometry';
import { PATTERN_REFERENCE, compilePattern, starterPattern } from './engine/pattern';
import { CATEGORIES, instrumentById, instrumentsIn } from './engine/instruments';
import { hasPitch, type BlockKind } from './engine/scheduler';
import type { SynthMachine } from './engine/synth';
import { describePitch, type Scale, type Tuning } from './engine/tuning';
import type { WaveRole } from './engine/wave';
import type { BlockData, BlockNode, PatternFigure, RegionData, RegionNode } from './piece';
import { RegionInspector } from './RegionInspector';
import { SynthPatchFields } from './SynthPatchFields';
import { blockColor, useSettings } from './settings';
import { Select } from './ui/Select';

const REPEATS = [0, 1, 2, 4, 8];

interface Props {
  node?: BlockNode;
  /** The tuning the selected block plays in, and the region it comes from. */
  nodeTuning?: { tuning: Tuning; region?: string };
  region?: RegionNode;
  /** `minBeats` is the straight line between its blocks: as short as it can get. */
  link?: { beats: number; minBeats: number; bends: number; code: string };
  /** A selected drawing. `place` is the region it sounds in; null is the canvas. */
  wave?: { role: WaveRole; beats: number; place: string | null; heard: boolean; sampled: boolean; points: number; instrument: string };
  /** This piece's synth machines, as choices alongside the catalog. */
  machines: readonly SynthMachine[];
  playing: boolean;
  onChange: (id: string, patch: Partial<BlockData>) => void;
  onLinkCode: (code: string) => void;
  onLinkLength: (beats: number) => void;
  onRegionChange: (id: string, patch: Partial<RegionData>) => void;
  onImportScale: (scale: Scale) => void;
  onRemoveScale: (scaleId: string) => void;
  onLoadSample: (regionId: string, file: File) => void;
  /** Performance keys already given to something other than the selection. */
  takenKeys: ReadonlyMap<string, string>;
  onFire: (id: string) => void;
  onStraighten: () => void;
  onDelete: () => void;
  onWaveRole: (role: WaveRole) => void;
  onWaveInstrument: (id: string) => void;
  /** Makes a machine from the default patch and returns its id. */
  onCreateMachine: () => string;
  onEditMachine: (id: string, patch: Partial<SynthMachine>) => void;
}

/** The piece's machines as a picker group, with a way to make a new one. */
function machineGroups(machines: readonly SynthMachine[], onCreate?: () => void) {
  const group = { label: 'Synth machines', options: machines.map((machine) => ({ value: machine.id, label: machine.name })) };
  const actions = onCreate ? [{ value: '__new-synth__', label: 'New synth machine…', action: onCreate }] : [];
  return [group, ...(actions.length ? [{ options: actions }] : [])];
}

export function Inspector(props: Props) {
  const { node, nodeTuning, region, link, wave, playing, onChange, onLinkCode, onLinkLength, onRegionChange, onImportScale, onRemoveScale, onLoadSample } =
    props;
  const { onFire, onStraighten, onDelete, onWaveRole, onWaveInstrument, takenKeys, machines, onCreateMachine, onEditMachine } = props;
  const { snap } = useSettings();

  if (wave) {
    const place = wave.place ?? 'the canvas';
    const aimed = wave.instrument ? instrumentById(wave.instrument) : undefined;
    const who = aimed?.name ?? 'this instrument';
    return (
      <div className="inspector">
        <div className="inspector-title">
          Wave
        </div>
        <div className="segmented">
          <button className={wave.role === 'cycle' ? 'is-on' : ''} onClick={() => onWaveRole('cycle')}>
            Cycle
          </button>
          <button className={wave.role === 'motion' ? 'is-on' : ''} onClick={() => onWaveRole('motion')}>
            Cutoff
          </button>
        </div>
        <Select
          ariaLabel="Wave instrument"
          value={wave.instrument}
          onChange={onWaveInstrument}
          groups={[
            { options: [{ value: '', label: 'This region' }] },
            ...machineGroups(machines),
            ...CATEGORIES.map((category) => ({
              label: category.label,
              options: instrumentsIn(category.id).map((inst) => ({ value: inst.id, label: inst.name })),
            })),
          ]}
        />
        {wave.role === 'cycle' ? (
          <p className="muted">
            {aimed
              ? `One period of the ${who} for ${place}. The drawing replaces that instrument's tone.`
              : `One period of the tone for ${place}. Up from the dashed line is the top of the wave.`}
            {!aimed && wave.sampled && ' This region plays a sample, so the cycle stays quiet until the sample is removed.'}
            {aimed && !aimed.pitched && ` ${who} has no tone for a cycle to replace. A cutoff can still belong to it.`}
            {!wave.heard && (aimed ? aimed.pitched : !wave.sampled) && ' A newer cycle on this same target is the one you hear.'}
          </p>
        ) : (
          <p className="muted">
            {aimed
              ? `A ${formatBeats(wave.beats, snap)}-beat loop on the ${who} filter for ${place}. The width is the loop, and the height bends that instrument's cutoff around the Tone slider. The other instruments stay on the region filter.`
              : `A ${formatBeats(wave.beats, snap)}-beat loop on the filter for ${place}. The width is the loop, and the height bends the cutoff${wave.place ? " around that region's Tone slider." : ' around fully open. Put it in a region to bend it around the Tone slider.'} Motions on the region add together.`}
          </p>
        )}
        <p className="muted">
          {wave.points} {wave.points === 1 ? 'point' : 'points'}. Drag one to move it, drag the line to add one, double-click one to remove it.
          Drag the name to move the whole wave.
        </p>
        <div className="row">
          <button className="danger" onClick={onDelete}>
            Delete wave
          </button>
        </div>
      </div>
    );
  }

  if (region) {
    return (
      <RegionInspector
        region={region}
        onChange={(patch) => onRegionChange(region.id, patch)}
        onImportScale={onImportScale}
        onRemoveScale={onRemoveScale}
        onLoadSample={(file) => onLoadSample(region.id, file)}
        onDelete={onDelete}
        takenKeys={takenKeys}
      />
    );
  }

  if (link) {
    return (
      <div className="inspector">
        <div className="inspector-title">
          Link
        </div>
        <LengthField
          beats={link.beats}
          minBeats={link.minBeats}
          snap={snap}
          onSet={onLinkLength}
          hint="How long a pulse takes to travel it. Type a length, or drag the link to bend it."
        />
        {link.bends > 0 && (
          <p className="muted">
            {link.bends === 1 ? '1 bend' : `${link.bends} bends`}. Drag one to move it; double-click it to remove it.
          </p>
        )}
        <CodeField value={link.code} target="link" onChange={onLinkCode} />
        <div className="row">
          {link.bends > 0 && <button onClick={onStraighten}>Straighten</button>}
          <button className="danger" onClick={onDelete}>
            Delete link
          </button>
        </div>
      </div>
    );
  }
  if (!node || !nodeTuning) return null;

  const { tuning } = nodeTuning;
  const { kind, degree, every } = node.data;
  const pitch = describePitch(degree, tuning.scale, tuning.rootHz);
  const machine = machines.find((item) => item.id === kind);
  const set = (patch: Partial<BlockData>) => onChange(node.id, patch);

  return (
    <div className="inspector" style={{ '--c': blockColor(kind, degree, tuning.scale) } as CSSProperties}>
      <div className="inspector-title">
        <span className="swatch" /> Block
      </div>

      <Select
        ariaLabel="Instrument"
        searchable
        value={kind}
        onChange={(value) => set(value === 'start' ? { kind: 'start', pattern: undefined, beats: undefined } : { kind: value as BlockKind })}
        groups={[
          { options: [{ value: 'start', label: 'Start' }] },
          ...machineGroups(machines, () => set({ kind: onCreateMachine() as BlockKind })),
          ...CATEGORIES.map((category) => ({
            label: category.label,
            options: instrumentsIn(category.id).map((inst) => ({ value: inst.id, label: inst.name })),
          })),
        ]}
      />
      {kind !== 'start' && instrumentById(kind) && <span className="muted">{instrumentById(kind)?.hint}</span>}

      {machine && (
        <div className="machine-patch">
          <SynthPatchFields patch={machine.patch} onChange={(patch) => onEditMachine(machine.id, { patch: { ...machine.patch, ...patch } })} />
        </div>
      )}

      {hasPitch(kind) && (
        <div className="field">
          <span className="field-label">Pitch</span>
          <div className="stepper">
            <button onClick={() => set({ degree: degree - 1 })} aria-label="Lower pitch">
              −
            </button>
            <span className="stepper-value">
              {pitch.name}
              <sub>{pitch.octave}</sub>
              {pitch.offset !== 0 && <small> {pitch.offset > 0 ? '+' : '−'}{Math.abs(pitch.offset)}¢</small>}
            </span>
            <button onClick={() => set({ degree: degree + 1 })} aria-label="Raise pitch">
              +
            </button>
          </div>
          <span className="muted">
            degree {degree} of {tuning.scale.name}
            {nodeTuning.region && <>, from region “{nodeTuning.region}”</>}
          </span>
        </div>
      )}

      {kind === 'start' && (
        <div className="field">
          <span className="field-label">Emit a pulse</span>
          <div className="segmented">
            {REPEATS.map((r) => (
              <button key={r} className={r === every ? 'is-on' : ''} onClick={() => set({ every: r })}>
                {r === 0 ? 'once' : r}
              </button>
            ))}
          </div>
          <span className="muted">{every ? `every ${every} beats while playing` : 'once, when you press play'}</span>
        </div>
      )}

      {kind === 'start' && (
        <KeyField value={node.data.key} does="fires this block while playing" taken={takenKeys} onChange={(key) => set({ key })} />
      )}

      {kind !== 'start' && (
        <PatternFields
          pattern={node.data.pattern}
          beats={spanOf(node.data)}
          figure={node.data.figure ?? 'roll'}
          snap={snap}
          onPattern={(pattern) => set(pattern === undefined ? { pattern: undefined, beats: undefined, figure: undefined } : { pattern, beats: spanOf({ pattern, beats: node.data.beats }) })}
          onBeats={(beats) => set({ beats })}
          onFigure={(figure) => set({ figure: figure === 'roll' ? undefined : figure })}
          starter={starterPattern(kind)}
        />
      )}

      <CodeField value={node.data.code ?? ''} target="block" onChange={(code) => set({ code })} />

      <div className="row">
        <button onClick={() => onFire(node.id)} disabled={!playing} title="Same as double-clicking the block">
          Fire pulse
        </button>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

const EPS = 1e-6;

// A link's length: type it ("1¾", "7/4", "1.75") or step it a quarter beat at
// a time, and the link bends to fit. It can't get shorter than the straight
// line between its blocks, so that's the floor, and the field says so.
const FIGURES: { id: PatternFigure; label: string; hint: string }[] = [
  { id: 'roll', label: 'Roll', hint: 'Bars. Time runs left to right and pitch runs up.' },
  { id: 'fall', label: 'Fall', hint: 'The same bars stood on end, each one labeled with its degree.' },
  { id: 'spiral', label: 'Spiral', hint: 'One turn of the spiral is one pass.' },
  { id: 'wheel', label: 'Wheel', hint: 'Where each note sits in the octave.' },
];

function PatternFields({
  pattern,
  beats,
  figure,
  snap,
  starter,
  onPattern,
  onBeats,
  onFigure,
}: {
  pattern: string | undefined;
  beats: number;
  figure: PatternFigure;
  snap: boolean;
  starter: string;
  onPattern: (pattern: string | undefined) => void;
  onBeats: (beats: number) => void;
  onFigure: (figure: PatternFigure) => void;
}) {
  const on = pattern !== undefined;
  const error = on ? compilePattern(pattern).error : null;
  return (
    <div className="field">
      <span className="field-label">Pattern</span>
      <div className="segmented" role="group" aria-label="Block shape">
        <button className={on ? '' : 'is-on'} aria-pressed={!on} onClick={() => on && onPattern(undefined)}>
          Disc
        </button>
        <button className={on ? 'is-on' : ''} aria-pressed={on} onClick={() => !on && onPattern(starter)}>
          Pattern
        </button>
      </div>
      {on && (
        <>
          <input
            type="text"
            aria-label="Pattern"
            aria-invalid={!!error}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="0 2 4"
            value={pattern}
            onChange={(e) => onPattern(e.target.value)}
          />
          <LengthField
            beats={beats}
            minBeats={MIN_SPAN}
            maxBeats={MAX_SPAN}
            snap={snap}
            onSet={(next) => onBeats(snap ? Math.round(next / GRID) * GRID : next)}
            hint="How long a pulse takes to cross the box. Drag its right edge, or type a length."
          />
          <div className="segmented" role="group" aria-label="Pattern drawing">
            {FIGURES.map((item) => (
              <button key={item.id} className={figure === item.id ? 'is-on' : ''} aria-pressed={figure === item.id} title={item.hint} onClick={() => onFigure(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          {error ? (
            <span className="warn">{error}</span>
          ) : (
            <details className="code-help">
              <summary className="muted">What can a pattern say?</summary>
              <dl>
                {PATTERN_REFERENCE.map(([example, what]) => (
                  <div key={example}>
                    <dt>
                      <code>{example}</code>
                    </dt>
                    <dd className="muted">{what}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted">One pass lasts the length of the box. The next pulse plays the next pass, so &lt;0 2 4&gt; alternates.</p>
            </details>
          )}
        </>
      )}
      {!on && <span className="muted">A pattern is a box: the pulse plays it while crossing, then goes on.</span>}
    </div>
  );
}

function LengthField({
  beats,
  minBeats,
  maxBeats = Infinity,
  snap,
  onSet,
  hint,
}: {
  beats: number;
  minBeats: number;
  maxBeats?: number;
  snap: boolean;
  onSet: (beats: number) => void;
  hint: string;
}) {
  const shown = formatBeats(beats, snap);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  // The shortest settable length, rounded up so the message never names one
  // that's still too short.
  const floor = snap ? Math.ceil(minBeats / GRID - EPS) * GRID : Math.ceil(minBeats * 100 - EPS) / 100;
  const apply = (value: number) => {
    if (!(value > 0)) return setError('Type a length in beats, like 1¾, 7/4 or 1.75.');
    if (value < minBeats - EPS) {
      return setError(
        maxBeats < Infinity
          ? `The shortest is ${formatBeats(minBeats, snap)}.`
          : `It can't be shorter than ${formatBeats(floor, snap)} without moving a block.`,
      );
    }
    if (value > maxBeats + EPS) return setError(`The longest is ${formatBeats(maxBeats, snap)}.`);
    setError('');
    onSet(value);
  };
  const shorter = Math.floor(beats / GRID - EPS) * GRID;
  const longer = Math.ceil(beats / GRID + EPS) * GRID;

  return (
    <div className="field">
      <span className="field-label">Length</span>
      <div className="length-row">
        <button className="icon" aria-label="Shorter" title="A quarter beat shorter" disabled={shorter < minBeats - EPS} onClick={() => apply(shorter)}>
          −
        </button>
        <input
          className="length-input"
          type="text"
          inputMode="decimal"
          aria-label="Length in beats"
          value={text}
          onFocus={(e) => {
            setEditing(true);
            e.target.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (text.trim() !== shown) apply(parseLength(text));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setText(shown);
              setError('');
              setEditing(false);
            }
          }}
        />
        <span className="muted">beats</span>
        <button className="icon" aria-label="Longer" title="A quarter beat longer" disabled={longer > maxBeats + EPS} onClick={() => apply(longer)}>
          +
        </button>
      </div>
      {error ? <span className="warn">{error}</span> : <span className="muted">{hint}</span>}
    </div>
  );
}
