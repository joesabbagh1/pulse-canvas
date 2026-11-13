import { Panel, useReactFlow, useStore } from '@xyflow/react';
import type { BlockKind } from '../engine/scheduler';

const KINDS: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: 'start', label: 'Start', hint: 'Sends out a pulse when you press play' },
  { kind: 'tone', label: 'Tone', hint: 'A sustained pitch from the scale' },
  { kind: 'pluck', label: 'Pluck', hint: 'A plucked string, pitched from the scale' },
  { kind: 'bass', label: 'Bass', hint: 'A low voice of its own, pitched from the scale' },
  { kind: 'kick', label: 'Kick', hint: 'A bass drum' },
  { kind: 'snare', label: 'Snare', hint: 'A snare drum' },
  { kind: 'hat', label: 'Hat', hint: 'A hi-hat' },
];

/** The palette along the bottom: click to drop a block (or region) in the middle of the view. */
export function AddDock({ onAdd, onAddRegion }: { onAdd: (kind: BlockKind) => void; onAddRegion: () => void }) {
  return (
    <Panel position="bottom-center" className="dock" aria-label="Add to the canvas">
      <span className="dock-label">Add</span>
      {KINDS.map(({ kind, label, hint }) => (
        <button key={kind} className={`dock-item dock-${kind}`} onClick={() => onAdd(kind)} title={`${label}: ${hint}`} aria-label={`Add ${label.toLowerCase()}`}>
          <span className="dock-swatch" aria-hidden="true" />
          <span className="dock-text">{label}</span>
        </button>
      ))}
      <span className="dock-divider" aria-hidden="true" />
      <button
        className="dock-item dock-region"
        onClick={onAddRegion}
        title="Region: gives the blocks inside it their own tuning and sound. Wraps the selected blocks, if any."
        aria-label="Add region"
      >
        <span className="dock-swatch" aria-hidden="true" />
        <span className="dock-text">Region</span>
      </button>
    </Panel>
  );
}

/** Zoom out, the zoom level (click for 100%), zoom in, and fit everything in view. */
export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <Panel position="bottom-right" className="zoom" aria-label="Zoom">
      <button className="icon" onClick={() => void zoomOut({ duration: 150 })} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <button className="zoom-level" onClick={() => void zoomTo(1, { duration: 150 })} title="Zoom to 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon" onClick={() => void zoomIn({ duration: 150 })} aria-label="Zoom in" title="Zoom in">
        +
      </button>
      <button className="icon" onClick={() => void fitView({ padding: 0.25, duration: 300 })} aria-label="Fit to view" title="Fit everything in view">
        ⤢
      </button>
    </Panel>
  );
}
