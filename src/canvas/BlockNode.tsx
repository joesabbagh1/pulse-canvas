import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { memo, useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { BOX_HEIGHT, GRID, MAX_SPAN, MIN_SPAN, PX_PER_BEAT, formatBeats, patternFrame, spanOf } from '../engine/geometry';
import { instrumentById } from '../engine/instruments';
import { compilePattern, type PatternNote } from '../engine/pattern';
import { compile, type Target } from '../engine/script';
import { describePitch, type Scale } from '../engine/tuning';
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

const STRIP_HEIGHT = 26;

// A pattern block is a box as wide as its length in beats. The pattern is
// typed straight into it, and the strip underneath shows where each note of
// the first pass falls, so the box reads left to right in time like a link
// does. Pulses come in at the left edge and leave from the port on the right.
function PatternBox({ id, data, selected }: NodeProps<BlockNode>) {
  const { scale } = useBlockTuning(id);
  const { updateNodeData } = useReactFlow<CanvasNode, LinkEdge>();
  const badge = useCodeBadge(data.code, 'block');
  const span = spanOf(data);
  const width = span * PX_PER_BEAT;
  const source = data.pattern ?? '';
  const pattern = useMemo(() => compilePattern(source), [source]);
  const notes = useMemo(() => pattern.notes(0), [pattern]);
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
        <span className="box-beats" title="Its length in beats: how long a pulse takes to cross it">
          {formatBeats(span, true)}
        </span>
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
      <NoteStrip notes={notes} width={width} span={span} color={color} scale={scale} />
      <Resize id={id} span={span} />
      <span className="box-port box-in" aria-hidden="true" />
      <Handle type="source" position={Position.Right} className="box-port box-out" isConnectableEnd={false} title="Drag to link it on" />
      <Handle type="target" position={Position.Left} className="box-drop" isConnectableStart={false} />
    </div>
  );
}

/** Where the notes of one pass fall across the box. */
function NoteStrip({ notes, width, span, color, scale }: { notes: PatternNote[]; width: number; span: number; color: string; scale: Scale }) {
  const lanes = useMemo(() => {
    const own = [...new Set(notes.filter((n) => !n.kind).map((n) => n.degree))].sort((a, b) => b - a).map((d) => `d${d}`);
    const named = [...new Set(notes.filter((n) => n.kind).map((n) => `${n.kind}:${n.degree}`))];
    return [...own, ...named];
  }, [notes]);
  const lane = Math.min(7, STRIP_HEIGHT / Math.max(1, lanes.length));
  const top = (STRIP_HEIGHT - lane * lanes.length) / 2;
  const beats: number[] = [];
  for (let b = 1; b < span; b++) beats.push(b);

  return (
    <svg className="box-strip" width={width} height={STRIP_HEIGHT} aria-hidden="true">
      {beats.map((b) => (
        <line key={b} className="box-beat" x1={b * PX_PER_BEAT} x2={b * PX_PER_BEAT} y1={0} y2={STRIP_HEIGHT} />
      ))}
      {notes.map((n, i) => {
        const row = lanes.indexOf(n.kind ? `${n.kind}:${n.degree}` : `d${n.degree}`);
        const x = n.at * width;
        const w = Math.min(Math.max(3, n.span * width - 2), Math.max(0, width - x));
        if (w <= 0) return null;
        return <rect key={i} x={x} y={top + row * lane} width={w} height={Math.max(1.5, lane - 1)} fill={n.kind ? blockColor(n.kind, n.degree, scale) : color} />;
      })}
    </svg>
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
