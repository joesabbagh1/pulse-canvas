import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from './engine/engine';
import { compileExpr } from './engine/fexpr';
import { CATEGORIES, instrumentsIn } from './engine/instruments';
import {
  MAX_CURVES,
  MAX_GRAPH_NOTES,
  compileCurves,
  graphNotes,
  xAt,
  type GraphCurve,
  type GraphSpec,
} from './engine/graph';
import type { BlockKind } from './engine/scheduler';
import { describePitch, type Scale } from './engine/tuning';
import type { SynthMachine } from './engine/synth';
import { graphPhrases, type Note } from './melody';
import { Slider } from './ui/Slider';
import { Select, type SelectGroup } from './ui/Select';
import { token } from './ui/theme';

// The graph page: functions of x on a window, swept by a pulse. The x axis is
// time — one sweep of the window takes `loopBeats` — and on every step each
// curve's y at the playhead becomes a note, through the live voices, in the
// piece's scale. It rides the piece's transport, so it layers over whatever
// the canvas is playing, and Send to canvas bakes one pass into blocks.

interface GraphPageProps {
  bpm: number;
  playing: boolean;
  scale: Scale;
  rootHz: number;
  machines: readonly SynthMachine[];
  graph: GraphSpec;
  engine: Engine;
  onGraph: (patch: Partial<GraphSpec>) => void;
  onCurve: (id: string, patch: Partial<GraphCurve>) => void;
  onAddCurve: () => void;
  onRemoveCurve: (id: string) => void;
  /** Starts the piece's transport if it isn't running. */
  onPlay: () => void;
  /** Places one pass of each curve as a loop of blocks on the canvas. */
  onSend: (rows: { kind: BlockKind; notes: Note[] }[]) => void;
}

const PRESETS = ['sin(x)', 'sin(x)+sin(3x)/3', 'floor(x)', 'abs(sin(x))-0.5', 'sign(sin(x))', 'tan(x)/4'];

const STEPS: { label: string; beats: number }[] = [
  { label: '1', beats: 1 },
  { label: '1/2', beats: 0.5 },
  { label: '1/4', beats: 0.25 },
  { label: '1/8', beats: 0.125 },
];

const LENGTHS: { label: string; beats: number | null }[] = [
  { label: 'Step', beats: null },
  { label: '1/4', beats: 0.25 },
  { label: '1/2', beats: 0.5 },
  { label: '1', beats: 1 },
  { label: '2', beats: 2 },
];

// The curves are told apart by their stroke, not a colour: ink is for pitch.
const dashOf = (index: number) => (index % 4 === 0 ? '' : index % 4 === 1 ? '7 5' : index % 4 === 2 ? '2 4' : '12 5 2 5');

/** A note the pager has scheduled, kept around to flash on the plot. */
interface FlashNote {
  beat: number;
  curve: number;
  x: number;
  y: number;
}

// Windows of notes are scheduled a quarter second of audio ahead, so a
// background tab (or a slow frame) can't leave a gap in the sweep.
const WINDOW_BEATS = 0.5;
const LOOKAHEAD_SECONDS = 0.25;

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}

function fmtTick(v: number, step: number): string {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** A number field that lets you type (a "-", a blank) without losing the value. */
function NumberField({ label, value, step, onValue }: { label: string; value: number; step: number; onValue: (v: number) => void }) {
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

function CurveSwatch({ index }: { index: number }) {
  const dash = dashOf(index);
  return (
    <svg className="graph-swatch" viewBox="0 0 28 8" width="28" height="8" aria-hidden="true">
      <line x1="1" y1="4" x2="27" y2="4" strokeWidth="2.5" strokeDasharray={dash || undefined} />
    </svg>
  );
}

export function GraphPage({
  bpm,
  playing,
  scale,
  rootHz,
  machines,
  graph,
  engine,
  onGraph,
  onCurve,
  onAddCurve,
  onRemoveCurve,
  onPlay,
  onSend,
}: GraphPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(() => graph.curves[0]?.id ?? null);
  useEffect(() => {
    if (selectedId && !graph.curves.some((curve) => curve.id === selectedId)) setSelectedId(graph.curves[0]?.id ?? null);
  }, [graph.curves, selectedId]);

  const curves = useMemo(() => compileCurves(graph), [graph]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashesRef = useRef<FlashNote[]>([]);
  const windowsRef = useRef(new Set<number>());

  const instrumentGroups = useMemo<SelectGroup[]>(
    () => [
      ...(machines.length ? [{ label: 'Machines', options: machines.map((m) => ({ value: m.id, label: m.name })) }] : []),
      ...CATEGORIES.map((category) => ({
        label: category.label,
        options: instrumentsIn(category.id).map((inst) => ({ value: inst.id, label: inst.name })),
      })),
    ],
    [machines],
  );

  // The pager: while the transport runs, keep scheduling windows of notes on
  // the audio clock, just ahead of the beat. Curves are read here, in the
  // page, never inside an audio timer; the engine only sees plain notes.
  useEffect(() => {
    if (!graph.run || !playing || !curves.length) {
      windowsRef.current.clear();
      flashesRef.current = [];
      return;
    }
    const spec = graph;
    const windows = windowsRef.current;
    windows.clear();
    flashesRef.current = [];
    const tick = () => {
      const from = engine.currentBeat();
      const horizon = engine.clock.beatAt(engine.heardNow() + LOOKAHEAD_SECONDS);
      const first = Math.floor(Math.max(from, 0) / WINDOW_BEATS) * WINDOW_BEATS;
      for (let start = first; start < horizon; start += WINDOW_BEATS) {
        const key = Math.round(start * 1000);
        if (windows.has(key)) continue;
        windows.add(key);
        const notes = graphNotes(spec, curves, start, start + WINDOW_BEATS);
        if (!notes.length) continue;
        const byCurve = new Map<number, typeof notes>();
        for (const note of notes) {
          const list = byCurve.get(note.curve) ?? [];
          list.push(note);
          byCurve.set(note.curve, list);
        }
        for (const [index, list] of byCurve) {
          const owner = curves.find((c) => c.index === index)!;
          engine.phraseAt(
            start,
            { id: `graph-${owner.curve.id}`, x: 0, y: 0, kind: owner.curve.kind as BlockKind, degree: 0, every: 0, scale, rootHz },
            list.map((note) => ({ degree: note.degree, beats: note.beats, at: note.beat - start, velocity: note.velocity })),
          );
        }
        const fired = notes.flatMap((note) => {
          const owner = curves.find((c) => c.index === note.curve);
          if (!owner) return [];
          const x = xAt(spec, note.beat);
          return [{ beat: note.beat, curve: note.curve, x, y: owner.fn(x) }];
        });
        flashesRef.current.push(...fired);
        if (flashesRef.current.length > 512) flashesRef.current.splice(0, flashesRef.current.length - 512);
      }
      for (const key of windows) {
        if ((key / 1000) + WINDOW_BEATS < from - 1) windows.delete(key);
      }
    };
    tick();
    const id = window.setInterval(tick, 50);
    return () => window.clearInterval(id);
  }, [graph, playing, curves, engine, scale, rootHz]);

  // The plot: drawn every animation frame at the position implied by the
  // audio clock. Drawing never drives timing; it only shows where the sweep is.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!w || !h) return;

      const { x0, x1, y0, y1, baseDegree, spanDegrees } = graph;
      const padL = 44;
      const padR = 52;
      const padT = 12;
      const padB = 24;
      const plotW = Math.max(1, w - padL - padR);
      const plotH = Math.max(1, h - padT - padB);
      const px = (x: number) => padL + ((x - x0) / (x1 - x0)) * plotW;
      const py = (y: number) => padT + ((y1 - y) / (y1 - y0)) * plotH;
      const ink = token('--ink-rgb');

      // Grid and ticks.
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      const xStep = niceStep(x1 - x0, Math.max(3, Math.floor(plotW / 90)));
      for (let v = Math.ceil(x0 / xStep) * xStep; v <= x1 + xStep * 1e-6; v += xStep) {
        const gx = px(v);
        ctx.strokeStyle = `rgb(${ink} / 0.07)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx, padT);
        ctx.lineTo(gx, padT + plotH);
        ctx.stroke();
        ctx.fillStyle = `rgb(${ink} / 0.55)`;
        ctx.fillText(fmtTick(v, xStep), gx, h - 8);
      }
      ctx.textAlign = 'right';
      const yStep = niceStep(y1 - y0, Math.max(2, Math.floor(plotH / 60)));
      for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1 + yStep * 1e-6; v += yStep) {
        const gy = py(v);
        ctx.strokeStyle = `rgb(${ink} / 0.07)`;
        ctx.beginPath();
        ctx.moveTo(padL, gy);
        ctx.lineTo(padL + plotW, gy);
        ctx.stroke();
        ctx.fillStyle = `rgb(${ink} / 0.55)`;
        ctx.fillText(fmtTick(v, yStep), padL - 6, gy + 3);
      }
      // The axes themselves, where zero sits inside the window.
      ctx.strokeStyle = `rgb(${ink} / 0.3)`;
      if (y0 <= 0 && 0 <= y1) {
        ctx.beginPath();
        ctx.moveTo(padL, py(0));
        ctx.lineTo(padL + plotW, py(0));
        ctx.stroke();
      }
      if (x0 <= 0 && 0 <= x1) {
        ctx.beginPath();
        ctx.moveTo(px(0), padT);
        ctx.lineTo(px(0), padT + plotH);
        ctx.stroke();
      }

      // Scale degrees: one row per degree the window is tall, named on the right.
      const rowPx = plotH / Math.max(1, spanDegrees);
      const stride = rowPx >= 7 ? 1 : Math.ceil(7 / rowPx);
      ctx.textAlign = 'left';
      for (let d = baseDegree; d <= baseDegree + spanDegrees; d += stride) {
        const gy = py(y0 + ((d - baseDegree) / spanDegrees) * (y1 - y0));
        ctx.strokeStyle = `rgb(${ink} / 0.045)`;
        ctx.beginPath();
        ctx.moveTo(padL, gy);
        ctx.lineTo(padL + plotW, gy);
        ctx.stroke();
        ctx.fillStyle = `rgb(${ink} / 0.4)`;
        const pitch = describePitch(d, scale, rootHz);
        ctx.fillText(`${pitch.name}${pitch.octave}`, padL + plotW + 6, gy + 3);
      }

      // The sweep.
      const beat = engine.clock.beatAt(engine.heardNow());
      const running = playing && graph.run;
      const phase = (((beat % graph.loopBeats) + graph.loopBeats) % graph.loopBeats) / graph.loopBeats;
      const headX = x0 + phase * (x1 - x0);
      const hx = px(headX);

      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, plotW, plotH);
      ctx.clip();

      if (running) {
        // A tail behind the playhead, like a pulse on a link.
        const tail = 72;
        const grad = ctx.createLinearGradient(hx - tail, 0, hx, 0);
        grad.addColorStop(0, `rgb(${ink} / 0)`);
        grad.addColorStop(1, `rgb(${ink} / 0.07)`);
        ctx.fillStyle = grad;
        ctx.fillRect(hx - tail, padT, tail, plotH);
      }

      // The curves, in the window, in ink, told apart by their stroke.
      const selectedIdx = graph.curves.findIndex((c) => c.id === selectedId);
      for (const { fn, index } of curves) {
        const strong = index === selectedIdx;
        ctx.strokeStyle = `rgb(${ink} / ${strong ? 1 : 0.8})`;
        ctx.lineWidth = strong ? 2.5 : 2;
        ctx.setLineDash(dashOf(index).split(' ').map(Number));
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let pen = false;
        for (let sx = padL; sx <= padL + plotW; sx += 2) {
          const xv = x0 + ((sx - padL) / plotW) * (x1 - x0);
          const yv = fn(xv);
          if (Number.isFinite(yv) && yv >= y0 && yv <= y1) {
            if (pen) ctx.lineTo(sx, py(yv));
            else ctx.moveTo(sx, py(yv));
            pen = true;
          } else {
            pen = false;
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (running) {
        // Note flashes: rings where the steps sounded, fading behind the sweep.
        const flash = flashesRef.current;
        let keep = 0;
        for (const f of flash) {
          const age = beat - f.beat;
          if (age < -0.05 || age > 1.5) continue;
          flash[keep++] = f;
          if (f.y < y0 || f.y > y1) continue;
          const alpha = Math.max(0, 0.35 * (1 - age / 1.5));
          ctx.strokeStyle = `rgb(${ink} / ${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px(f.x), py(f.y), 3.5 + age * 9, 0, Math.PI * 2);
          ctx.stroke();
        }
        flash.length = keep;

        // The playhead and a dot on every curve where it stands.
        ctx.strokeStyle = `rgb(${ink} / 0.5)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hx, padT);
        ctx.lineTo(hx, padT + plotH);
        ctx.stroke();
        for (const { fn } of curves) {
          const yv = fn(headX);
          if (!Number.isFinite(yv) || yv < y0 || yv > y1) continue;
          ctx.fillStyle = `rgb(${ink} / 0.14)`;
          ctx.beginPath();
          ctx.arc(hx, py(yv), 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgb(${ink} / 1)`;
          ctx.beginPath();
          ctx.arc(hx, py(yv), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graph, curves, playing, engine, scale, rootHz, selectedId]);

  const steps = Math.round(graph.loopBeats / graph.stepBeats);
  const rows = useMemo(() => graphPhrases(graph, curves), [graph, curves]);
  const sendable = rows.length > 0 && steps <= MAX_GRAPH_NOTES;

  const root = describePitch(0, scale, rootHz);
  const runHint = graph.run
    ? playing
      ? 'Sweeping — the graph plays with the piece.'
      : 'Press Play to start the sweep.'
    : 'Run turns the sweep on; Play is the transport.';

  const autoFit = () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const { fn } of curves) {
      for (let i = 0; i <= 512; i++) {
        const y = fn(graph.x0 + (i / 512) * (graph.x1 - graph.x0));
        if (Number.isFinite(y)) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.1;
    const round = (v: number) => Math.round(v * 100) / 100;
    onGraph({ y0: round(lo - pad), y1: round(hi + pad) });
  };

  const toggleRun = () => {
    if (graph.run) {
      onGraph({ run: false });
      return;
    }
    onGraph({ run: true });
    if (!playing) onPlay();
  };

  return (
    <div className="page graph-page">
      <aside className="graph-rail" aria-label="Graph curves">
        <h1>Graph</h1>
        <p className="muted">
          Functions of x, swept left to right by the pulse. Each step sounds the y it finds, in {scale.name}. Root {root.name}
          <sub>{root.octave}</sub> · {bpm} BPM.
        </p>
        {graph.curves.map((curve, index) => {
          const compiled = compileExpr(curve.expr);
          const selected = curve.id === selectedId;
          return (
            <div key={curve.id} className={`graph-curve${selected ? ' is-on' : ''}`}>
              <div className="graph-curve-head">
                <button type="button" className="graph-curve-select" aria-pressed={selected} onClick={() => setSelectedId(curve.id)}>
                  <CurveSwatch index={index} />
                  <span>y{index + 1}</span>
                </button>
                <button
                  type="button"
                  className="graph-curve-remove"
                  aria-label={`Remove y${index + 1}`}
                  disabled={graph.curves.length <= 1}
                  onClick={() => onRemoveCurve(curve.id)}
                >
                  ×
                </button>
              </div>
              <textarea
                className="code graph-expr"
                aria-label={`Function for y${index + 1}`}
                rows={2}
                spellCheck={false}
                value={curve.expr}
                onChange={(e) => onCurve(curve.id, { expr: e.target.value })}
              />
              {compiled.error && <p className="code-errors warn">{compiled.error}</p>}
              <Select
                ariaLabel={`Instrument for y${index + 1}`}
                value={curve.kind}
                searchable
                groups={instrumentGroups}
                onChange={(kind) => onCurve(curve.id, { kind })}
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
                  onChange={(level) => onCurve(curve.id, { level })}
                />
                <Slider
                  label="Shift"
                  value={curve.shift}
                  min={-24}
                  max={24}
                  step={1}
                  reset={0}
                  format={(v) => `${v > 0 ? '+' : ''}${v}`}
                  onChange={(shift) => onCurve(curve.id, { shift })}
                />
              </div>
            </div>
          );
        })}
        <button type="button" className="graph-add" disabled={graph.curves.length >= MAX_CURVES} onClick={onAddCurve}>
          Add curve
        </button>
        <section className="graph-presets">
          <h2>Presets</h2>
          <div className="graph-chips">
            {PRESETS.map((expr) => (
              <button type="button" key={expr} className="chip" onClick={() => selectedId && onCurve(selectedId, { expr })}>
                {expr}
              </button>
            ))}
          </div>
          <p className="muted">
            Write any function of x: + - * / % ^, sin cos tan, floor abs sqrt min max mod, pi e. Neighbours multiply: 3sin(x).
          </p>
        </section>
      </aside>

      <div className="graph-stage">
        <header className="graph-toolbar">
          <button type="button" className={`graph-run${graph.run ? ' is-on' : ''}`} aria-pressed={graph.run} onClick={toggleRun}>
            {graph.run ? 'Sweeping' : 'Run'}
          </button>
          <button
            type="button"
            className="play"
            disabled={!sendable}
            title={steps > MAX_GRAPH_NOTES ? 'Too many notes for one pass — coarsen the step or shorten the loop' : 'Place one pass of each curve on the canvas'}
            onClick={() => onSend(rows)}
          >
            Send to canvas
          </button>
          <span className="muted graph-hint">{runHint}</span>
        </header>

        <div className="graph-plot-wrap">
          <canvas ref={canvasRef} className="graph-plot" role="img" aria-label="The curves on the window, swept by the pulse" />
        </div>

        <div className="graph-config" aria-label="Graph settings">
          <div className="graph-config-group">
            <Slider
              label="Loop"
              value={graph.loopBeats}
              min={2}
              max={64}
              step={0.5}
              reset={16}
              format={(v) => `${v} beats`}
              onChange={(loopBeats) => onGraph({ loopBeats })}
            />
            <div className="field">
              <span className="field-label">Step</span>
              <div className="segmented" role="group" aria-label="Step">
                {STEPS.map((step) => (
                  <button
                    type="button"
                    key={step.label}
                    className={graph.stepBeats === step.beats ? 'is-on' : ''}
                    aria-pressed={graph.stepBeats === step.beats}
                    onClick={() => onGraph({ stepBeats: step.beats })}
                  >
                    {step.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Note length</span>
              <div className="segmented" role="group" aria-label="Note length">
                {LENGTHS.map((length) => (
                  <button
                    type="button"
                    key={length.label}
                    className={graph.lengthBeats === length.beats ? 'is-on' : ''}
                    aria-pressed={graph.lengthBeats === length.beats}
                    onClick={() => onGraph({ lengthBeats: length.beats })}
                  >
                    {length.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="graph-config-group">
            <NumberField label="x from" value={graph.x0} step={0.5} onValue={(x0) => onGraph({ x0 })} />
            <NumberField label="x to" value={graph.x1} step={0.5} onValue={(x1) => onGraph({ x1 })} />
            <NumberField label="y from" value={graph.y0} step={0.5} onValue={(y0) => onGraph({ y0 })} />
            <NumberField label="y to" value={graph.y1} step={0.5} onValue={(y1) => onGraph({ y1 })} />
            <button type="button" className="graph-fit" onClick={autoFit}>
              Fit y
            </button>
          </div>
          <div className="graph-config-group">
            <Slider
              label="Bottom degree"
              value={graph.baseDegree}
              min={-24}
              max={24}
              step={1}
              reset={-4}
              format={(v) => `${v}`}
              onChange={(baseDegree) => onGraph({ baseDegree })}
            />
            <Slider
              label="Degrees tall"
              value={graph.spanDegrees}
              min={1}
              max={48}
              step={1}
              reset={16}
              format={(v) => `${v}`}
              onChange={(spanDegrees) => onGraph({ spanDegrees })}
            />
            <span className="muted graph-range">
              {(() => {
                const bottom = describePitch(graph.baseDegree, scale, rootHz);
                const top = describePitch(graph.baseDegree + graph.spanDegrees, scale, rootHz);
                return `${bottom.name}${bottom.octave} to ${top.name}${top.octave}`;
              })()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
