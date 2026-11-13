import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { memo, useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { BOX_HEIGHT, GRID, MAX_SPAN, MIN_SPAN, PX_PER_BEAT, formatBeats, patternFrame, spanOf } from '../engine/geometry';
import { instrumentById } from '../engine/instruments';
import { PatternFigure, scaleSteps } from './figures';
import { compilePattern } from '../engine/pattern';
import { compile, run, type Target } from '../engine/script';
import { describePitch } from '../engine/tuning';
import { isBlock, type BlockNode, type CanvasNode, type LinkEdge } from '../piece';
import { blockColor, useBlockTuning, useSettings } from '../settings';

function BlockView(props: NodeProps<BlockNode>) {
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
  const shape = useMemo(() => {
    const out = run(compile(data.code ?? '', 'block'), 1, () => 0);
    return { fast: out.fast, rev: out.rev, transpose: out.transpose };
  }, [data.code]);
  const notes = useMemo(() => pattern.notes(0, 0, 1, shape), [pattern, shape]);
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
        root={data.degree + shape.transpose}
      />
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
