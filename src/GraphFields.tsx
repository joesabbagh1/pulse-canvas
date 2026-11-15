import { useEffect, useState } from 'react';
import { compileExpr } from './engine/fexpr';
import type { GraphCurve } from './engine/graph';
import { CATEGORIES, instrumentsIn } from './engine/instruments';
import type { SynthMachine } from './engine/synth';
import { Slider } from './ui/Slider';
import { Select, type SelectGroup } from './ui/Select';

// The pieces the graph surfaces share: the Graph page's rail and the canvas
// box's inspector panel edit the same curves of y = f(x) with the same
// widgets, and the box itself draws them with the same stroke vocabulary.

// The curves are told apart by their stroke, not a colour: ink is for pitch.
export const dashOf = (index: number) => (index % 4 === 0 ? '' : index % 4 === 1 ? '7 5' : index % 4 === 2 ? '2 4' : '12 5 2 5');

export const PRESETS = ['sin(x)', 'sin(x)+sin(3x)/3', 'floor(x)', 'abs(sin(x))-0.5', 'sign(sin(x))', 'tan(x)/4'];

export const STEPS: { label: string; beats: number }[] = [
  { label: '1', beats: 1 },
  { label: '1/2', beats: 0.5 },
  { label: '1/4', beats: 0.25 },
  { label: '1/8', beats: 0.125 },
];

export const LENGTHS: { label: string; beats: number | null }[] = [
  { label: 'Step', beats: null },
  { label: '1/4', beats: 0.25 },
  { label: '1/2', beats: 0.5 },
  { label: '1', beats: 1 },
  { label: '2', beats: 2 },
];

export function instrumentGroupsFor(machines: readonly SynthMachine[]): SelectGroup[] {
  return [
    ...(machines.length ? [{ label: 'Machines', options: machines.map((m) => ({ value: m.id, label: m.name })) }] : []),
    ...CATEGORIES.map((category) => ({
      label: category.label,
      options: instrumentsIn(category.id).map((inst) => ({ value: inst.id, label: inst.name })),
    })),
  ];
}

export function CurveSwatch({ index }: { index: number }) {
  const dash = dashOf(index);
  return (
    <svg className="graph-swatch" viewBox="0 0 28 8" width="28" height="8" aria-hidden="true">
      <line x1="1" y1="4" x2="27" y2="4" strokeWidth="2.5" strokeDasharray={dash || undefined} />
    </svg>
  );
}

/** A number field that lets you type (a "-", a blank) without losing the value. */
export function NumberField({ label, value, step, onValue }: { label: string; value: number; step: number; onValue: (v: number) => void }) {
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    const typed = Number(text);
    if (!(Number.isFinite(typed) && typed === value)) setText(String(value));
    // Only the value coming back changed should rewrite the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        aria-label={label}
        value={text}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onValue(n);
        }}
      />
    </label>
  );
}

/** One curve: its function, its instrument, and how loud and how high it plays. */
export function CurveCard({
  index,
  curve,
  selected,
  machines,
  canRemove = true,
  follow,
  onSelect,
  onRemove,
  onCurve,
}: {
  index: number;
  curve: GraphCurve;
  selected?: boolean;
  machines: readonly SynthMachine[];
  canRemove?: boolean;
  /** Set on a block: the label for "follow the block's instrument" (kind ''). */
  follow?: string;
  onSelect?: () => void;
  onRemove?: () => void;
  onCurve: (patch: Partial<GraphCurve>) => void;
}) {
  const compiled = compileExpr(curve.expr);
  return (
    <div className={`graph-curve${selected ? ' is-on' : ''}`}>
      <div className="graph-curve-head">
        {onSelect && (
          <button type="button" className="graph-curve-select" aria-pressed={selected} onClick={onSelect}>
            <CurveSwatch index={index} />
            <span>y{index + 1}</span>
          </button>
        )}
        {!onSelect && (
          <span className="graph-curve-select">
            <CurveSwatch index={index} />
            <span>y{index + 1}</span>
          </span>
        )}
        {onRemove && (
          <button type="button" className="graph-curve-remove" aria-label={`Remove y${index + 1}`} disabled={!canRemove} onClick={onRemove}>
            ×
          </button>
        )}
      </div>
      <textarea
        className="code graph-expr"
        aria-label={`Function for y${index + 1}`}
        rows={2}
        spellCheck={false}
        value={curve.expr}
        onChange={(e) => onCurve({ expr: e.target.value })}
      />
      {compiled.error && <p className="code-errors warn">{compiled.error}</p>}
      <Select
        ariaLabel={`Instrument for y${index + 1}`}
        value={curve.kind}
        searchable
        groups={follow ? [{ options: [{ value: '', label: follow }] }, ...instrumentGroupsFor(machines)] : instrumentGroupsFor(machines)}
        onChange={(kind) => onCurve({ kind })}
      />
      <div className="graph-curve-sliders">
        <Slider
          label="Level"
          value={curve.level}
          min={0}
          max={1}
          step={0.05}
          reset={0.9}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(level) => onCurve({ level })}
        />
        <Slider
          label="Shift"
          value={curve.shift}
          min={-24}
          max={24}
          step={1}
          reset={0}
          format={(v) => `${v > 0 ? '+' : ''}${v}`}
          onChange={(shift) => onCurve({ shift })}
        />
      </div>
    </div>
  );
}
