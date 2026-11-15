import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { memo, useMemo, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { BOX_HEIGHT, GRID, MAX_SPAN, MIN_SPAN, PX_PER_BEAT, formatBeats, patternFrame, spanOf } from '../engine/geometry';
import { blockGraphNotes, compileCurves, DEFAULT_BLOCK_GRAPH, xAt } from '../engine/graph';
import { instrumentById } from '../engine/instruments';
import { PatternFigure, scaleSteps } from './figures';
import { livePass, subscribeLive } from './livePass';
import { compilePattern } from '../engine/pattern';
import { compile, run, type Target } from '../engine/script';
import { describePitch } from '../engine/tuning';
import { dashOf } from '../GraphFields';
import { isBlock, type BlockNode, type CanvasNode, type LinkEdge } from '../piece';
import { blockColor, useBlockTuning, useSettings } from '../settings';

function BlockView(props: NodeProps<BlockNode>) {
  if (props.data.graph !== undefined) return <GraphBox {...props} />;
  return props.data.pattern === undefined ? <Disc {...props} /> : <PatternBox {...props} />;
}

// A block is a disc inside a ring. Drag the disc to move the block; drag the
// ring to pull out a link. While a link is being dragged, the whole block
// becomes a drop target (React Flow only enables a handle's pointer events
// when it can accept the connection in progress).
function Disc({ id, data, selected }: NodeProps<BlockNode>) {
  const { scale, rootHz } = useBlockTuning(id);
  const badge = useCodeBadge(data.code, 'block');
  const style = { '--c': blockColor(data.kind, data.degree, scale) } as CSSProperties;

  const inst = data.kind === 'start' ? undefined : instrumentById(data.kind);
  let label: ReactNode;
  if (data.kind === 'start') {
    label = (
      <>
        <span className="block-note">▶</span>
        <span className="block-sub">{data.every ? `every ${data.every}` : 'once'}</span>
      </>
    );
  } else if (inst?.pitched) {
    const pitch = describePitch(data.degree, scale, rootHz);
    label = (
      <>
        <span className="block-note">
          {pitch.name}
          <sub>{pitch.octave}</sub>
        </span>
        {pitch.offset !== 0 ? (
          <span className="block-sub">
            {pitch.offset > 0 ? '+' : '−'}
            {Math.abs(pitch.offset)}¢
          </span>
        ) : (
          inst.short && <span className="block-sub">{inst.short}</span>
        )}
      </>
    );
  } else {
    label = <span className="block-word">{inst?.short || inst?.name || data.kind}</span>;
  }

  return (
    <div className={`block block-${data.kind}${selected ? ' is-selected' : ''}`} style={style}>
      <Handle type="source" position={Position.Right} className="block-ring" isConnectableEnd={false} />
      <div className="block-core">{label}</div>
      {data.kind === 'start' && data.key && (
        <kbd className="block-key" title={`Press ${data.key.toUpperCase()} to fire it`}>
          {data.key.toUpperCase()}
        </kbd>
      )}
      {badge && (
        <span className={`block-code ${badge.className}`} title={badge.title}>
          ƒ
        </span>
      )}
      <Handle type="target" position={Position.Left} className="block-drop" isConnectableStart={false} />
    </div>
  );
}

// A pattern block is a box as wide as its length in beats. The pattern is
// typed straight into it, and the drawing underneath is the figure chosen for
// it. Pulses come in at the left edge and leave on the right.
function PatternBox({ id, data, selected }: NodeProps<BlockNode>) {
  const { scale } = useBlockTuning(id);
  const { updateNodeData } = useReactFlow<CanvasNode, LinkEdge>();
  const badge = useCodeBadge(data.code, 'block');
  const span = spanOf(data);
  const width = span * PX_PER_BEAT;
  const source = data.pattern ?? '';
  const pattern = useMemo(() => compilePattern(source), [source]);
  const resting = useMemo(() => {
    const out = run(compile(data.code ?? '', 'block'), 1, () => 0);
    return { fast: out.fast, rev: out.rev, transpose: out.transpose };
  }, [data.code]);
  const passing = useSyncExternalStore(subscribeLive, () => livePass(id), () => null);
  const shape = passing ?? resting;
  const notes = useMemo(() => pattern.notes(passing?.cycle ?? 0, 0, 1, shape), [pattern, shape, passing?.cycle]);
  const inst = data.kind === 'start' ? undefined : instrumentById(data.kind);
  const color = blockColor(data.kind, data.degree, scale);

  return (
    <div
      className={`box${selected ? ' is-selected' : ''}${pattern.error ? ' has-error' : ''}`}
      style={{ '--c': color, width, height: BOX_HEIGHT } as CSSProperties}
      title={pattern.error ?? undefined}
    >
      <div className="box-head">
        <span className="box-name">{inst?.short || inst?.name || data.kind}</span>
        {badge && (
          <span className={`box-code ${badge.className}`} title={badge.title}>
            ƒ
          </span>
        )}
        <input
          className="box-level nodrag nopan"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={data.level ?? 1}
          aria-label="Level"
          title="How loud this pattern is"
          onChange={(e) => {
            const level = Math.min(1, Math.max(0, Number(e.target.value)));
            updateNodeData(id, { level: level >= 0.999 ? undefined : level });
          }}
        />
        <input
          className="box-level nodrag nopan"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={data.tone ?? 1}
          aria-label="Filter"
          title="How open this pattern's filter is. Fully right is bright."
          onChange={(e) => {
            const tone = Math.min(1, Math.max(0, Number(e.target.value)));
            updateNodeData(id, { tone: tone >= 0.999 ? undefined : tone });
          }}
        />
        <span className="box-beats" title="Its length in beats: how long a pulse takes to cross it">
          {formatBeats(span, true)}
        </span>
      </div>
      <div className="box-line">
        <div className="box-mirror" aria-hidden="true">
          <span className="box-before" />
          <mark className="box-hit" />
          <span className="box-after" />
        </div>
        <input
          className="box-text nodrag nopan"
          type="text"
          value={source}
          placeholder="0 2 4"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Pattern"
          aria-invalid={!!pattern.error}
          onChange={(e) => updateNodeData(id, { pattern: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      </div>
      <PatternFigure
        figure={data.figure ?? 'roll'}
        notes={notes}
        width={width}
        span={span}
        color={color}
        steps={scaleSteps(scale)}
        root={data.degree + (passing?.shift ?? resting.transpose)}
      />
      <Resize id={id} span={span} />
      <span className="box-port box-in" aria-hidden="true" />
      <Handle type="source" position={Position.Right} className="box-port box-out" isConnectableEnd={false} title="Drag to link it on" />
      <Handle type="target" position={Position.Left} className="box-drop" isConnectableStart={false} />
    </div>
  );
}

// A graph block is a box as wide as its sweep: one pass from the left edge to
// the right is one sweep of the math window, a note on every step. The curves
// are drawn on the box in ink, told apart like the page does it, and the pulse
// glides along them (PulseLayer reads the same paths through data-pts).
const GRAPH_STRIP_H = 88;

function GraphBox({ id, data, selected }: NodeProps<BlockNode>) {
  const { scale } = useBlockTuning(id);
  const { updateNodeData } = useReactFlow<CanvasNode, LinkEdge>();
  const badge = useCodeBadge(data.code, 'block');
  const span = spanOf(data);
  const width = span * PX_PER_BEAT;
  const graph = data.graph ?? DEFAULT_BLOCK_GRAPH;
  const curves = useMemo(() => compileCurves({ ...graph, loopBeats: 1, run: false }), [graph]);
  const notes = useMemo(() => blockGraphNotes(graph, curves, span, 0, span), [graph, curves, span]);
  const stripW = Math.max(8, width - 26);
  const stripH = GRAPH_STRIP_H;
  const color = blockColor(data.kind, data.degree, scale);
  const yToU = (y: number) => stripH * (1 - (y - graph.y0) / (graph.y1 - graph.y0));

  // Each curve's polyline in strip units, in runs: a y outside the window
  // breaks the line, the way the page's plot lifts its pen.
  const polylines = curves.map(({ fn }) => {
    const runs: [number, number][][] = [];
    let pts: [number, number][] | null = null;
    const N = 64;
    for (let j = 0; j <= N; j++) {
      const ux = Math.round(((j / N) * stripW) * 10) / 10;
      const y = fn(xAt({ ...graph, loopBeats: span, run: false }, (j / N) * span));
      if (Number.isFinite(y) && y >= graph.y0 && y <= graph.y1) {
        const point: [number, number] = [ux, Math.round(yToU(y) * 10) / 10];
        if (pts) pts.push(point);
        else pts = [point];
      } else if (pts) {
        runs.push(pts);
        pts = null;
      }
    }
    if (pts) runs.push(pts);
    return runs;
  });

  // One mark per note, thinned when the grid is dense, so the flash rings have
  // somewhere to land — the same contract the figures' notes carry.
  const markStride = Math.max(1, Math.ceil(notes.length / 128));
  const marks = notes
    .filter((_, i) => i % markStride === 0)
    .map((note) => {
      const owner = curves.find((c) => c.index === note.curve);
      if (!owner) return null;
      const at = note.beat / span;
      const y = owner.fn(xAt({ ...graph, loopBeats: span, run: false }, note.beat));
      if (!Number.isFinite(y) || y < graph.y0 || y > graph.y1) return null;
      return {
        at,
        spanU: note.beats / span,
        x: at * stripW,
        y: yToU(y),
        fill: blockColor(owner.curve.kind, data.degree + note.degree, scale),
      };
    });

  // The pitch rows: one line per scale degree the window is tall, thinned.
  const rowPx = stripH / Math.max(1, graph.spanDegrees);
  const rowStride = rowPx >= 5 ? 1 : Math.ceil(5 / rowPx);

  return (
    <div
      className={`box graph-box${selected ? ' is-selected' : ''}`}
      style={{ '--c': color, width, height: BOX_HEIGHT } as CSSProperties}
      title={graph.curves.map((c) => `y = ${c.expr}`).join('\n')}
    >
      <div className="box-head">
        <span className="box-name">Graph</span>
        {badge && (
          <span className={`box-code ${badge.className}`} title={badge.title}>
            ƒ
          </span>
        )}
        <input
          className="box-level nodrag nopan"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={data.level ?? 1}
          aria-label="Level"
          title="How loud this graph is"
          onChange={(e) => {
            const level = Math.min(1, Math.max(0, Number(e.target.value)));
            updateNodeData(id, { level: level >= 0.999 ? undefined : level });
          }}
        />
        <input
          className="box-level nodrag nopan"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={data.tone ?? 1}
          aria-label="Filter"
          title="How open this graph's filter is. Fully right is bright."
          onChange={(e) => {
            const tone = Math.min(1, Math.max(0, Number(e.target.value)));
            updateNodeData(id, { tone: tone >= 0.999 ? undefined : tone });
          }}
        />
        <span className="box-beats" title="Its length in beats: how long one sweep of the window takes">
          {formatBeats(span, true)}
        </span>
      </div>
      <svg className="box-strip graph-strip" width={stripW} height={stripH} viewBox={`0 0 ${stripW} ${stripH}`} data-w={stripW} data-h={stripH}>
        {Array.from({ length: Math.floor(graph.spanDegrees / rowStride) + 1 }, (_, i) => graph.baseDegree + i * rowStride)
          .filter((degree) => degree <= graph.baseDegree + graph.spanDegrees)
          .map((degree) => {
          const uy = yToU(graph.y0 + ((degree - graph.baseDegree) / graph.spanDegrees) * (graph.y1 - graph.y0));
          return <line key={degree} className={degree === 0 ? 'graph-axis' : 'graph-row'} x1={0} x2={stripW} y1={uy} y2={uy} />;
        })}
        {curves.map(({ curve, index }, i) =>
          polylines[i].map((pts, k) => (
            <path
              key={`${curve.id}-${k}`}
              className="graph-curve-line"
              d={pts.map(([x, y], j) => `${j === 0 ? 'M' : 'L'}${x},${y}`).join('')}
              strokeDasharray={dashOf(index) || undefined}
              data-pts={pts.map(([x, y]) => `${x},${y}`).join(' ')}
            />
          )),
        )}
        {marks.map((mark, i) =>
          mark ? (
            <circle key={i} className="graph-mark" data-at={mark.at} data-span={mark.spanU} cx={mark.x} cy={mark.y} r={2.5} fill={mark.fill} />
          ) : null,
        )}
      </svg>
      <Resize id={id} span={span} />
      <span className="box-port box-in" aria-hidden="true" />
      <Handle type="source" position={Position.Right} className="box-port box-out" isConnectableEnd={false} title="Drag to link it on" />
      <Handle type="target" position={Position.Left} className="box-drop" isConnectableStart={false} />
    </div>
  );
}

/** Dragging the grip changes how long the box is, and leaves its left edge where it is. */
function Resize({ id, span }: { id: string; span: number }) {
  const { getNode, setNodes, getZoom } = useReactFlow<CanvasNode, LinkEdge>();
  const { snap } = useSettings();
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const node = getNode(id);
    if (!node || !isBlock(node)) return;
    const zoom = getZoom() || 1;
    const originX = e.clientX;
    const left = node.position.x - (span * PX_PER_BEAT) / 2;
    const y = node.position.y;
    const move = (ev: PointerEvent) => {
      let beats = (span * PX_PER_BEAT + (ev.clientX - originX) / zoom) / PX_PER_BEAT;
      beats = snap ? Math.round(beats / GRID) * GRID : Math.round(beats * 100) / 100;
      beats = Math.min(MAX_SPAN, Math.max(MIN_SPAN, beats));
      const frame = patternFrame({ pattern: '', beats })!;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== id || !isBlock(n)) return n;
          // A stale measured width puts the box's origin away from its ports, so the link misses the edge.
          const { measured: _measured, ...rest } = n;
          return { ...rest, position: { x: left + frame.width / 2, y }, width: frame.width, height: frame.height, data: { ...n.data, beats } };
        }),
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <span
      className="box-resize nodrag nopan"
      title="Drag to change its length"
      aria-label="Drag to change the pattern length"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

export const BlockNodeView = memo(BlockView);

/** Marks a block or link that has code, in warning colour if it has mistakes. */
export function useCodeBadge(code: string | undefined, target: Target) {
  return useMemo(() => {
    if (!code?.trim()) return null;
    const { errors } = compile(code, target);
    return { className: errors.length ? 'has-code has-errors' : 'has-code', title: errors.length ? 'Code has mistakes' : 'Has code' };
  }, [code, target]);
}
