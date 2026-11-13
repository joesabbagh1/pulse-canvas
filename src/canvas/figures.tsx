import type { PatternNote } from '../engine/pattern';
import type { PatternFigure } from '../piece';
import type { Scale } from '../engine/tuning';

export const ROLL_HEIGHT = 64;

/** Integer rows from the lowest degree to the highest. One pitch is one row, not stretched to the edges. */
export function degreeGrid(degrees: readonly number[]): { lo: number; hi: number; rows: number } {
  if (!degrees.length) return { lo: 0, hi: 0, rows: 1 };
  const lo = Math.floor(Math.min(...degrees));
  const hi = Math.ceil(Math.max(...degrees));
  return { lo, hi, rows: Math.max(1, hi - lo + 1) };
}

interface FigureProps {
  figure: PatternFigure;
  notes: PatternNote[];
  width: number;
  span: number;
  color: string;
  /** Scale steps, for the wheel. */
  steps: number;
  /** The block's degree plus any transpose, so the wheel shows sounding pitch classes. */
  root: number;
}

/** The pattern as a drawing. Every note carries data-at so the traveling pulse can land on it. */
export function PatternFigure({ figure, notes, width, span, color, steps, root }: FigureProps) {
  const plot = Math.max(1, width - 26);
  const grid = degreeGrid(notes.map((n) => n.degree));
  const label = figure === 'fall' ? 'Wordfall' : figure === 'spiral' ? 'Spiral' : figure === 'wheel' ? 'Pitch wheel' : 'Piano roll';

  return (
    <svg className="box-strip" width={plot} height={ROLL_HEIGHT} aria-label={label} role="img">
      {figure === 'fall' ? (
        <Fall notes={notes} plot={plot} span={span} color={color} grid={grid} />
      ) : figure === 'spiral' ? (
        <Spiral notes={notes} plot={plot} color={color} />
      ) : figure === 'wheel' ? (
        <Wheel notes={notes} plot={plot} color={color} steps={steps} root={root} />
      ) : (
        <Roll notes={notes} plot={plot} span={span} color={color} grid={grid} />
      )}
    </svg>
  );
}

function Roll({
  notes,
  plot,
  span,
  color,
  grid,
}: {
  notes: PatternNote[];
  plot: number;
  span: number;
  color: string;
  grid: { lo: number; hi: number; rows: number };
}) {
  const rowH = ROLL_HEIGHT / grid.rows;
  const beats: number[] = [];
  for (let b = 1; b < span; b++) beats.push(b);
  return (
    <>
      {beats.map((b) => (
        <line key={b} className="box-beat" x1={(b / span) * plot} x2={(b / span) * plot} y1={0} y2={ROLL_HEIGHT} />
      ))}
      {grid.rows > 1 &&
        Array.from({ length: grid.rows - 1 }, (_, i) => (
          <line key={i} className="box-pitch" x1={0} x2={plot} y1={(i + 1) * rowH} y2={(i + 1) * rowH} />
        ))}
      {notes.map((n, i) => {
        const y = (grid.hi - n.degree) * rowH;
        const x = n.at * plot;
        const w = Math.max(2, Math.min(plot - x, n.span * plot) - 1);
        const h = Math.max(2, rowH - 1);
        return (
          <rect
            key={i}
            data-at={n.at}
            data-span={n.span}
            x={x}
            y={y + 0.5}
            width={Math.max(2, w)}
            height={h}
            fill={color}
            opacity={0.85}
          />
        );
      })}
    </>
  );
}

function Fall({
  notes,
  plot,
  span,
  color,
  grid,
}: {
  notes: PatternNote[];
  plot: number;
  span: number;
  color: string;
  grid: { lo: number; hi: number; rows: number };
}) {
  const colW = plot / grid.rows;
  const beats: number[] = [];
  for (let b = 1; b < span; b++) beats.push(b);
  return (
    <>
      {beats.map((b) => (
        <line key={b} className="box-beat" x1={0} x2={plot} y1={(b / span) * ROLL_HEIGHT} y2={(b / span) * ROLL_HEIGHT} />
      ))}
      {notes.map((n, i) => {
        const x = (n.degree - grid.lo) * colW;
        const y = n.at * ROLL_HEIGHT;
        const w = Math.max(2, colW - 1);
        const h = Math.max(2, Math.min(ROLL_HEIGHT - y, n.span * ROLL_HEIGHT) - 1);
        return (
          <g key={i}>
            <rect data-at={n.at} data-span={n.span} x={x + 0.5} y={y} width={w} height={h} fill={color} opacity={0.85} />
            {w > 14 && h > 11 && (
              <text className="box-label" x={x + w / 2} y={y + h / 2}>
                {n.degree}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}

function pointAt(at: number, cx: number, cy: number, r0: number, r1: number) {
  const t = Math.min(1, Math.max(0, at));
  const a = t * Math.PI * 2 - Math.PI / 2;
  const r = r0 + t * (r1 - r0);
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

function Spiral({ notes, plot, color }: { notes: PatternNote[]; plot: number; color: string }) {
  const cx = plot / 2;
  const cy = ROLL_HEIGHT / 2;
  const r1 = Math.min(plot, ROLL_HEIGHT) / 2 - 5;
  const r0 = Math.max(4, r1 * 0.28);
  const guide = Array.from({ length: 72 }, (_, i) => pointAt(i / 71, cx, cy, r0, r1));
  return (
    <>
      <path className="box-pitch" d={guide.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')} fill="none" />
      {notes.map((n, i) => {
        const steps = 6;
        const pts = Array.from({ length: steps + 1 }, (_, k) => pointAt(n.at + (n.span * k) / steps, cx, cy, r0, r1));
        const at = pointAt(n.at, cx, cy, r0, r1);
        return (
          <g key={i}>
            <path d={pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')} fill="none" stroke={color} strokeWidth={3} />
            <Mark at={n.at} span={n.span} cx={at.x} cy={at.y} color={color} />
          </g>
        );
      })}
    </>
  );
}

function Wheel({
  notes,
  plot,
  color,
  steps,
  root,
}: {
  notes: PatternNote[];
  plot: number;
  color: string;
  steps: number;
  root: number;
}) {
  const side = Math.min(plot, ROLL_HEIGHT);
  const cx = plot / 2;
  const cy = ROLL_HEIGHT / 2;
  const r = side / 2 - 4;
  const count = Math.max(1, steps);
  const angle = (degree: number) => {
    const klass = ((Math.round(root + degree) % count) + count) % count;
    return (klass / count) * Math.PI * 2 - Math.PI / 2;
  };
  return (
    <>
      <circle className="box-pitch" cx={cx} cy={cy} r={r} fill="none" />
      {Array.from({ length: count }, (_, k) => {
        const a = (k / count) * Math.PI * 2 - Math.PI / 2;
        return (
          <line
            key={k}
            className="box-pitch"
            x1={cx + Math.cos(a) * (r - 4)}
            y1={cy + Math.sin(a) * (r - 4)}
            x2={cx + Math.cos(a) * r}
            y2={cy + Math.sin(a) * r}
          />
        );
      })}
      {notes.map((n, i) => {
        const a = angle(n.degree);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth={1.5} opacity={0.7} />
            <Mark at={n.at} span={n.span} cx={x} cy={y} color={color} />
          </g>
        );
      })}
    </>
  );
}

/** The point the pulse jumps to: the start of the note, not the middle of its bar. */
function Mark({ at, span, cx, cy, color }: { at: number; span: number; cx: number; cy: number; color: string }) {
  return <circle data-at={at} data-span={span} cx={cx} cy={cy} r={2.5} fill={color} />;
}

export function scaleSteps(scale: Scale): number {
  return Math.max(1, scale.cents.length);
}
