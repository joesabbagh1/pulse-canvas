import { useReactFlow, useStore, useStoreApi } from '@xyflow/react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Engine } from '../engine/engine';
import { instrumentById } from '../engine/instruments';
import { formatBeats, linkPath, nearestSegment, type XY } from '../engine/geometry';
import {
  MIN_WAVE_WIDTH,
  MAX_WAVE_POINTS,
  baselineY,
  motionBeats,
  polylineY,
  simplifyStroke,
  waveBounds,
  type Wave,
} from '../engine/wave';

// Screen pixels a press must travel before it becomes a drag, so a click still
// just selects the wave.
const DRAG_THRESHOLD = 4;

function swallowNextClick() {
  const swallow = (e: MouseEvent) => e.stopPropagation();
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 0);
}

interface Props {
  waves: Wave[];
  selectedId: string | null;
  snap: boolean;
  /** Pencil is on: a drag on empty canvas draws a cycle. */
  drawing: boolean;
  /** Beats is showing: waves stay visible, faintly, and can't be grabbed. */
  ghost: boolean;
  engine: Engine;
  onSelect: (id: string | null) => void;
  onPoints: (id: string, points: XY[]) => void;
  /** A finished pencil stroke, already thinned. */
  onCreate: (points: XY[]) => void;
}

/** Waves drawn over the canvas, in screen space, following pan and zoom. */
export function WaveLayer({ waves, selectedId, snap, drawing, ghost, engine, onSelect, onPoints, onCreate }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const store = useStoreApi();
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<XY[] | null>(null);
  const wavesRef = useRef(waves);
  wavesRef.current = waves;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const flowRef = useRef(screenToFlowPosition);
  flowRef.current = screenToFlowPosition;
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const sx = (x: number) => x * zoom + tx;
  const sy = (y: number) => y * zoom + ty;

  useEffect(() => {
    if (!drawing) return;
    const root = svgRef.current?.closest('.react-flow');
    if (!(root instanceof HTMLElement)) return;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (!target?.classList.contains('react-flow__pane')) return;
      e.preventDefault();
      e.stopPropagation();
      onSelectRef.current(null);
      const pts = [flowRef.current({ x: e.clientX, y: e.clientY })];
      setDraft(pts.slice());
      const move = (ev: PointerEvent) => {
        const p = flowRef.current({ x: ev.clientX, y: ev.clientY });
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
        pts.push(p);
        setDraft(pts.slice());
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        setDraft(null);
        swallowNextClick();
        const simplified = simplifyStroke(pts);
        if (simplified.length >= 2 && waveBounds(simplified).width >= MIN_WAVE_WIDTH) onCreateRef.current(simplified);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };
    root.addEventListener('pointerdown', down, true);
    return () => root.removeEventListener('pointerdown', down, true);
  }, [drawing]);

  // The dot rides the motion. Drawing follows the audio clock; it never drives it.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const svg = svgRef.current;
      if (!svg) return;
      const [vx, vy, z] = store.getState().transform;
      const beat = engine.playing ? engine.clock.beatAt(engine.heardNow()) : 0;
      for (const dot of svg.querySelectorAll<SVGCircleElement>('[data-playhead]')) {
        const wave = wavesRef.current.find((w) => w.id === dot.getAttribute('data-playhead'));
        if (!wave) continue;
        const head = playheadAt(wave, beat, snapRef.current);
        if (!head) continue;
        dot.setAttribute('cx', String(head.x * z + vx));
        dot.setAttribute('cy', String(head.y * z + vy));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, store]);

  return (
    <svg ref={svgRef} className={`wave-layer${ghost ? ' is-ghost' : ''}${drawing ? ' is-drawing' : ''}`}>
      {waves.map((wave) => (
        <WaveShape
          key={wave.id}
          wave={wave}
          selected={wave.id === selectedId}
          snap={snap}
          interactive={!ghost}
          engine={engine}
          sx={sx}
          sy={sy}
          onSelect={onSelect}
          onPoints={onPoints}
        />
      ))}
      {draft && draft.length > 1 && (
        <path className="wave-stroke wave-draft" d={screenLine(draft, sx, sy)} />
      )}
    </svg>
  );
}

function screenLine(points: readonly XY[], sx: (x: number) => number, sy: (y: number) => number) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
}

function playheadAt(wave: Wave, beat: number, snap: boolean): XY | null {
  if (wave.role !== 'motion') return null;
  const { minX, width } = waveBounds(wave.points);
  const beats = motionBeats(wave.points, snap);
  if (width < MIN_WAVE_WIDTH || beats <= 0) return null;
  const phase = (((beat % beats) + beats) % beats) / beats;
  const x = minX + phase * width;
  return { x, y: polylineY(wave.points, x) };
}

function WaveShape({
  wave,
  selected,
  snap,
  interactive,
  engine,
  sx,
  sy,
  onSelect,
  onPoints,
}: {
  wave: Wave;
  selected: boolean;
  snap: boolean;
  interactive: boolean;
  engine: Engine;
  sx: (x: number) => number;
  sy: (y: number) => number;
  onSelect: (id: string | null) => void;
  onPoints: (id: string, points: XY[]) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  const { points, role } = wave;
  if (points.length < 2) return null;
  const bounds = waveBounds(points);
  const base = baselineY(points);
  const line = screenLine(points, sx, sy);
  const who = wave.instrument ? instrumentById(wave.instrument)?.short || instrumentById(wave.instrument)?.name : '';
  const label = who ? (role === 'cycle' ? who : `${who} ${formatBeats(motionBeats(points, snap), snap)}`) : role === 'cycle' ? 'cycle' : formatBeats(motionBeats(points, snap), snap);
  const labelY = Math.min(sy(base), sy(bounds.minY)) - 8;
  const head = playheadAt(wave, engine.playing ? engine.clock.beatAt(engine.heardNow()) : 0, snap);

  // Pressing a point drags it. Pressing the line and pulling inserts a point
  // there. Pressing the name moves the whole drawing.
  const onPointerDown = (e: ReactPointerEvent<SVGGElement>) => {
    if (!interactive || e.button !== 0 || endDrag.current) return;
    e.stopPropagation();
    const target = e.target as Element;
    const moving = target.hasAttribute('data-move');
    const attr = target.getAttribute('data-point');
    let index = attr === null ? -1 : Number(attr);
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const grab = screenToFlowPosition({ x: startX, y: startY });
    const origin = points.map((p) => ({ ...p }));
    const path = linkPath(points[0], points[points.length - 1], points.slice(1, -1), 0);
    const segment = nearestSegment(path, grab);
    let dragging = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      if (!dragging) {
        dragging = true;
        if (!selected) onSelect(wave.id);
        if (index < 0 && !moving) {
          if (origin.length >= MAX_WAVE_POINTS) return;
          index = segment + 1;
          // The inserted point was grabbed where the pointer went down, so the
          // delta below keeps it under the pointer.
          origin.splice(index, 0, { ...grab });
        }
      }
      if (moving) {
        const dx = p.x - grab.x;
        const dy = p.y - grab.y;
        onPoints(wave.id, origin.map((q) => ({ x: q.x + dx, y: q.y + dy })));
        return;
      }
      if (index < 0) return;
      const at = { x: origin[index].x + (p.x - grab.x), y: origin[index].y + (p.y - grab.y) };
      onPoints(wave.id, origin.map((q, i) => (i === index ? at : q)));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      endDrag.current?.();
      if (!dragging) onSelect(wave.id);
      else swallowNextClick();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    endDrag.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      endDrag.current = null;
    };
  };

  const onDoubleClick = (e: ReactMouseEvent<SVGGElement>) => {
    const attr = (e.target as Element).getAttribute('data-point');
    if (attr === null || points.length <= 2) return;
    e.stopPropagation();
    const index = Number(attr);
    onPoints(wave.id, points.filter((_, i) => i !== index));
  };

  return (
    <g
      className={`wave wave-${role}${selected ? ' is-selected' : ''}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <path className="wave-fill" d={`${line} L ${sx(bounds.maxX).toFixed(1)} ${sy(base).toFixed(1)} L ${sx(bounds.minX).toFixed(1)} ${sy(base).toFixed(1)} Z`} />
      <line className="wave-base" x1={sx(bounds.minX)} y1={sy(base)} x2={sx(bounds.maxX)} y2={sy(base)} />
      <path className="wave-hit" d={line} />
      <path className="wave-stroke" d={line} />
      <text className="wave-label" data-move="" x={sx(bounds.minX)} y={labelY} textAnchor="start">
        {label}
      </text>
      {interactive &&
        selected &&
        points.map((p, i) => (
          <g key={i}>
            <circle className="wave-point" cx={sx(p.x)} cy={sy(p.y)} r={3.5} />
            <circle className="wave-point-hit" data-point={i} cx={sx(p.x)} cy={sy(p.y)} r={10} />
          </g>
        ))}
      {head && <circle className="wave-playhead" data-playhead={wave.id} cx={sx(head.x)} cy={sy(head.y)} r={4} />}
    </g>
  );
}
