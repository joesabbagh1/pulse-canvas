import {
  BaseEdge,
  useInternalNode,
  useReactFlow,
  useStore,
  type ConnectionLineComponentProps,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { memo, useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  BLOCK_R,
  PARALLEL_OFFSET,
  formatBeats,
  linkBeats,
  linkPath,
  nearestSegment,
  pointAt,
  slicePath,
  type LinkPath,
  type XY,
} from '../engine/geometry';
import { bendsOf, type BlockNode, type LinkEdge } from '../piece';
import { useCodeBadge } from './BlockNode';
import { useSettings } from '../settings';

const ARROW_LEN = 9;
const ARROW_HALF = 4.5;
// Screen pixels a press on a link must travel before it becomes a bend drag,
// so a plain click still just selects the link.
const DRAG_THRESHOLD = 4;

function center(node: InternalNode): XY {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2,
  };
}

/** The link between the two block rims, its arrowhead and label spot. */
function shape(path: LinkPath, endGap: number) {
  const { len } = path;
  const tip = pointAt(path, len - endGap);
  const base = pointAt(path, len - endGap - ARROW_LEN);
  // Aim the arrow from base to tip, so it stays attached even across a corner.
  const ax = tip.x - base.x;
  const ay = tip.y - base.y;
  const alen = Math.hypot(ax, ay) || 1;
  const nx = -ay / alen;
  const ny = ax / alen;
  const mid = pointAt(path, len / 2);
  const points = slicePath(path, BLOCK_R, len - endGap - ARROW_LEN);
  return {
    path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
    arrow: `M ${tip.x} ${tip.y} L ${base.x + nx * ARROW_HALF} ${base.y + ny * ARROW_HALF} L ${base.x - nx * ARROW_HALF} ${base.y - ny * ARROW_HALF} Z`,
    labelX: mid.x - mid.uy * 13,
    labelY: mid.y + mid.ux * 13,
    visible: len > BLOCK_R + endGap + ARROW_LEN + 4,
  };
}

// The click that ends a drag would otherwise land on whatever is under the
// pointer, and a click on empty canvas clears the selection.
function swallowNextClick() {
  const swallow = (e: MouseEvent) => e.stopPropagation();
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 0);
}

function LinkView({ id, source, target, selected, data }: EdgeProps<LinkEdge>) {
  const from = useInternalNode<BlockNode>(source);
  const to = useInternalNode<BlockNode>(target);
  const hasStraightReverse = useStore((s) =>
    s.edges.some((e) => e.source === target && e.target === source && !bendsOf(e as LinkEdge).length),
  );
  const { snap } = useSettings();
  const { screenToFlowPosition, setNodes, setEdges, updateEdgeData } = useReactFlow<BlockNode, LinkEdge>();
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);
  const badge = useCodeBadge(data?.code, 'link');
  if (!from || !to) return null;

  const bends = data?.bends ?? [];
  const path = linkPath(center(from), center(to), bends, hasStraightReverse ? PARALLEL_OFFSET : 0);
  const s = shape(path, BLOCK_R + 2);
  if (!s.visible) return null;

  const setBends = (update: (bends: XY[]) => XY[]) => updateEdgeData(id, (edge) => ({ bends: update(bendsOf(edge)) }));
  // Selection goes through the same update queue as the bends. React Flow's
  // own selection helpers would race with it, and the bend update would undo them.
  const select = () => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((es) => es.map((e) => (!!e.selected === (e.id === id) ? e : { ...e, selected: e.id === id })));
  };

  // Pressing a bend drags it. Pressing the line itself and pulling inserts a
  // new bend on the nearest segment and drags that.
  const onPointerDown = (e: ReactPointerEvent<SVGGElement>) => {
    if (e.button !== 0 || endDrag.current) return;
    const attr = (e.target as Element).getAttribute('data-bend');
    let index = attr === null ? -1 : Number(attr);
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const grab = screenToFlowPosition({ x: startX, y: startY });
    const origin = index >= 0 ? bends[index] : grab;
    const segment = nearestSegment(path, grab);
    let dragging = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const at = { x: origin.x + p.x - grab.x, y: origin.y + p.y - grab.y };
      if (!dragging) {
        dragging = true;
        if (!selected) select();
        if (index < 0) {
          index = segment;
          setBends((bs) => [...bs.slice(0, index), at, ...bs.slice(index)]);
          return;
        }
      }
      setBends((bs) => bs.map((b, i) => (i === index ? at : b)));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      endDrag.current?.();
      if (dragging) swallowNextClick();
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
    const attr = (e.target as Element).getAttribute('data-bend');
    if (attr === null) return;
    e.stopPropagation();
    setBends((bs) => bs.filter((_, i) => i !== Number(attr)));
  };

  return (
    <g className={`link${selected ? ' is-selected' : ''}`} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
      <BaseEdge id={id} path={s.path} className="link-path" interactionWidth={18} />
      <path d={s.arrow} className="link-arrow" />
      <text x={s.labelX} y={s.labelY} className="link-label" textAnchor="middle" dominantBaseline="middle">
        {formatBeats(linkBeats(path.len, snap), snap)}
        {badge && (
          <tspan className={`link-code ${badge.className}`}> ƒ</tspan>
        )}
      </text>
      {bends.map((b, i) => (
        <g key={i}>
          <circle className="link-bend" cx={b.x} cy={b.y} r={3.5} />
          <circle className="link-bend-hit" data-bend={i} cx={b.x} cy={b.y} r={10} />
        </g>
      ))}
    </g>
  );
}

export const LinkEdgeView = memo(LinkView);

/** The line shown while dragging out a new link, labelled with its length in beats. */
export function LinkPreview({ fromNode, toNode, toX, toY }: ConnectionLineComponentProps) {
  const { snap } = useSettings();
  const end = toNode && toNode.id !== fromNode.id ? center(toNode) : { x: toX, y: toY };
  const path = linkPath(center(fromNode), end, [], 0);
  const s = shape(path, toNode ? BLOCK_R + 2 : 0);
  if (!s.visible) return null;

  return (
    <g className="link is-preview">
      <path d={s.path} className="link-path" />
      <path d={s.arrow} className="link-arrow" />
      <text x={s.labelX} y={s.labelY} className="link-label" textAnchor="middle" dominantBaseline="middle">
        {formatBeats(linkBeats(path.len, snap), snap)}
      </text>
    </g>
  );
}
