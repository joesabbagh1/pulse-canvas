import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import { compile, type Target } from '../engine/script';
import { describePitch } from '../engine/tuning';
import type { BlockNode } from '../piece';
import { blockColor, useBlockTuning } from '../settings';

// A block is a disc inside a ring. Drag the disc to move the block; drag the
// ring to pull out a link. While a link is being dragged, the whole block
// becomes a drop target (React Flow only enables a handle's pointer events
// when it can accept the connection in progress).
function BlockView({ id, data, selected }: NodeProps<BlockNode>) {
  const { scale, rootHz } = useBlockTuning(id);
  const badge = useCodeBadge(data.code, 'block');
  const style = { '--c': blockColor(data.kind, data.degree, scale) } as CSSProperties;

  let label: ReactNode;
  switch (data.kind) {
    case 'tone':
    case 'pluck':
    case 'bass': {
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
            data.kind !== 'tone' && <span className="block-sub">{data.kind}</span>
          )}
        </>
      );
      break;
    }
    case 'start':
      label = (
        <>
          <span className="block-note">▶</span>
          <span className="block-sub">{data.every ? `every ${data.every}` : 'once'}</span>
        </>
      );
      break;
    default:
      label = <span className="block-word">{data.kind}</span>;
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

export const BlockNodeView = memo(BlockView);

/** Marks a block or link that has code, in warning colour if it has mistakes. */
export function useCodeBadge(code: string | undefined, target: Target) {
  return useMemo(() => {
    if (!code?.trim()) return null;
    const { errors } = compile(code, target);
    return { className: errors.length ? 'has-code has-errors' : 'has-code', title: errors.length ? 'Code has mistakes' : 'Has code' };
  }, [code, target]);
}
