import { NodeResizer, type NodeProps } from '@xyflow/react';
import { memo, type CSSProperties } from 'react';
import { scaleById } from '../engine/tuning';
import type { RegionNode } from '../piece';
import { MIN_REGION } from '../regions';
import { regionColor, useSettings } from '../settings';

// A tinted rectangle behind the blocks. Only its name tab and, once selected,
// its resize handles take the pointer; everywhere else clicks reach the canvas,
// so blocks can be added and linked inside a region as anywhere else.
function RegionView({ data, selected }: NodeProps<RegionNode>) {
  const { scales } = useSettings();
  const scale = scaleById(data.scaleId, scales);
  const style = { '--c': regionColor(scale.id) } as CSSProperties;

  return (
    <div className={`region${selected ? ' is-selected' : ''}${data.mix.mute ? ' is-muted' : ''}`} style={style}>
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_REGION}
        minHeight={MIN_REGION}
        lineClassName="region-edge"
        handleClassName="region-corner"
      />
      <div className="region-tab" title="Drag to move the region and everything in it">
        <span className="region-name">{data.name}</span>
        <span className="region-scale">{scale.name}</span>
        {data.sample && (
          <span className="region-flag" title={`Tones play ${data.sample.name}`}>
            ♪
          </span>
        )}
        {data.mix.mute && <span className="region-flag">muted</span>}
        {data.key && <kbd className="region-key">{data.key.toUpperCase()}</kbd>}
      </div>
    </div>
  );
}

export const RegionNodeView = memo(RegionView);
