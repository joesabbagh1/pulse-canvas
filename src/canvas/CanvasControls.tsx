import { Panel, useReactFlow, useStore } from '@xyflow/react';
import type { BlockKind } from '../engine/scheduler';
import type { Stamp } from '../engine/wave';

export type Layer = 'beats' | 'waves';

const STAMPS: { stamp: Stamp; label: string; hint: string }[] = [
  { stamp: 'saw', label: 'Saw', hint: 'A bright ramp. Drag the points to bend it' },
  { stamp: 'square', label: 'Square', hint: 'A hollow pulse' },
  { stamp: 'sine', label: 'Sine', hint: 'A plain tone, ready to mess up' },
  { stamp: 'decay', label: 'Decay', hint: 'A cutoff sweep, two beats long. Width is the loop' },
];

const KINDS: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: 'start', label: 'Start', hint: 'Sends out a pulse when you press play' },
  { kind: 'tone', label: 'Tone', hint: 'A sustained pitch from the scale' },
  { kind: 'pluck', label: 'Pluck', hint: 'A plucked string, pitched from the scale' },
  { kind: 'bass', label: 'Bass', hint: 'A low voice of its own, pitched from the scale' },
  { kind: 'jawharp', label: 'Jaw harp', hint: 'A plucked metal tongue. The note is one of its harmonics' },
  { kind: 'khuur', label: 'Khuur', hint: 'A morin khuur: bowed horsehead fiddle, with a drone a fifth away' },
  { kind: 'kick', label: 'Kick', hint: 'A bass drum' },
  { kind: 'snare', label: 'Snare', hint: 'A snare drum' },
  { kind: 'hat', label: 'Hat', hint: 'A hi-hat' },
];

/** The palette along the bottom. Beats drops blocks; Waves draws the synth. */
export function AddDock({
  layer,
  pencil,
  onLayer,
  onPencil,
  onAdd,
  onAddRegion,
  onStamp,
}: {
  layer: Layer;
  pencil: boolean;
  onLayer: (layer: Layer) => void;
  onPencil: () => void;
  onAdd: (kind: BlockKind) => void;
  onAddRegion: () => void;
  onStamp: (stamp: Stamp) => void;
}) {
  return (
    <Panel position="bottom-center" className="dock" aria-label="Add to the canvas">
      <div className="dock-layers" role="group" aria-label="Layer">
        <button className={layer === 'beats' ? 'is-on' : ''} aria-pressed={layer === 'beats'} onClick={() => onLayer('beats')}>
          Beats
        </button>
        <button className={layer === 'waves' ? 'is-on' : ''} aria-pressed={layer === 'waves'} onClick={() => onLayer('waves')}>
          Waves
        </button>
      </div>
      <span className="dock-divider" aria-hidden="true" />
      {layer === 'beats' ? (
        <>
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
        </>
      ) : (
        <>
          <button
            className={`dock-item dock-pencil${pencil ? ' is-on' : ''}`}
            aria-pressed={pencil}
            onClick={onPencil}
            title="Pencil: drag on empty canvas to draw a cycle. Turn it off to pan with the left button."
            aria-label="Draw a wave"
          >
            <StampIcon stamp="pencil" />
            <span className="dock-text">Pencil</span>
          </button>
          {STAMPS.map(({ stamp, label, hint }) => (
            <button key={stamp} className={`dock-item dock-${stamp}`} onClick={() => onStamp(stamp)} title={`${label}: ${hint}`} aria-label={`Add ${label.toLowerCase()}`}>
              <StampIcon stamp={stamp} />
              <span className="dock-text">{label}</span>
            </button>
          ))}
        </>
      )}
    </Panel>
  );
}

function StampIcon({ stamp }: { stamp: Stamp | 'pencil' }) {
  const d =
    stamp === 'pencil'
      ? 'M3 13 L11 3 L13 5 L5 15 Z M3 13 L2 15 L4 14 Z'
      : stamp === 'saw'
        ? 'M2 12 L14 4'
        : stamp === 'square'
          ? 'M2 4 H8 V12 H14'
          : stamp === 'sine'
            ? 'M2 8 C4 8 4 3 6 3 S8 13 10 13 S12 8 14 8'
            : 'M2 4 C5 4 6 12 14 12';
  return (
    <svg className="dock-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
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
