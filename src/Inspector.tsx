import { useEffect, useState, type CSSProperties } from 'react';
import { CodeField } from './CodeField';
import { KeyField } from './KeyField';
import { GRID, formatBeats, parseLength } from './engine/geometry';
import { hasPitch, type BlockKind } from './engine/scheduler';
import { describePitch, type Scale, type Tuning } from './engine/tuning';
import type { BlockData, BlockNode, RegionData, RegionNode } from './piece';
import { RegionInspector } from './RegionInspector';
import { blockColor, useSettings } from './settings';

const KINDS: { kind: BlockKind; label: string }[] = [
  { kind: 'start', label: 'Start' },
  { kind: 'tone', label: 'Tone' },
  { kind: 'pluck', label: 'Pluck' },
  { kind: 'bass', label: 'Bass' },
  { kind: 'kick', label: 'Kick' },
  { kind: 'snare', label: 'Snare' },
  { kind: 'hat', label: 'Hat' },
];
const REPEATS = [0, 1, 2, 4, 8];

interface Props {
  node?: BlockNode;
  /** The tuning the selected block plays in, and the region it comes from. */
  nodeTuning?: { tuning: Tuning; region?: string };
  region?: RegionNode;
  /** `minBeats` is the straight line between its blocks: as short as it can get. */
  link?: { beats: number; minBeats: number; bends: number; code: string };
  playing: boolean;
  onChange: (id: string, patch: Partial<BlockData>) => void;
  onLinkCode: (code: string) => void;
  onLinkLength: (beats: number) => void;
  onRegionChange: (id: string, patch: Partial<RegionData>) => void;
  onImportScale: (scale: Scale) => void;
  onRemoveScale: (scaleId: string) => void;
  onLoadSample: (regionId: string, file: File) => void;
  /** Performance keys already given to something other than the selection. */
  takenKeys: ReadonlyMap<string, string>;
  onFire: (id: string) => void;
  onStraighten: () => void;
  onDelete: () => void;
}

export function Inspector(props: Props) {
  const { node, nodeTuning, region, link, playing, onChange, onLinkCode, onLinkLength, onRegionChange, onImportScale, onRemoveScale, onLoadSample } =
    props;
  const { onFire, onStraighten, onDelete, takenKeys } = props;
  const { snap } = useSettings();

  if (region) {
    return (
      <RegionInspector
        region={region}
        onChange={(patch) => onRegionChange(region.id, patch)}
        onImportScale={onImportScale}
        onRemoveScale={onRemoveScale}
        onLoadSample={(file) => onLoadSample(region.id, file)}
        onDelete={onDelete}
        takenKeys={takenKeys}
      />
    );
  }

  if (link) {
    return (
      <div className="inspector">
        <div className="inspector-title">Link</div>
        <LengthField beats={link.beats} minBeats={link.minBeats} snap={snap} onSet={onLinkLength} />
        {link.bends > 0 && (
          <p className="muted">
            {link.bends === 1 ? '1 bend' : `${link.bends} bends`}. Drag one to move it; double-click it to remove it.
          </p>
        )}
        <CodeField value={link.code} target="link" onChange={onLinkCode} />
        <div className="row">
          {link.bends > 0 && <button onClick={onStraighten}>Straighten</button>}
          <button className="danger" onClick={onDelete}>
            Delete link
          </button>
        </div>
      </div>
    );
  }
  if (!node || !nodeTuning) return null;

  const { tuning } = nodeTuning;
  const { kind, degree, every } = node.data;
  const pitch = describePitch(degree, tuning.scale, tuning.rootHz);
  const set = (patch: Partial<BlockData>) => onChange(node.id, patch);

  return (
    <div className="inspector" style={{ '--c': blockColor(kind, degree, tuning.scale) } as CSSProperties}>
      <div className="inspector-title">
        <span className="swatch" /> Block
      </div>

      <div className="segmented">
        {KINDS.map((k) => (
          <button key={k.kind} className={k.kind === kind ? 'is-on' : ''} onClick={() => set({ kind: k.kind })}>
            {k.label}
          </button>
        ))}
      </div>

      {hasPitch(kind) && (
        <div className="field">
          <span className="field-label">Pitch</span>
          <div className="stepper">
            <button onClick={() => set({ degree: degree - 1 })} aria-label="Lower pitch">
              −
            </button>
            <span className="stepper-value">
              {pitch.name}
              <sub>{pitch.octave}</sub>
              {pitch.offset !== 0 && <small> {pitch.offset > 0 ? '+' : '−'}{Math.abs(pitch.offset)}¢</small>}
            </span>
            <button onClick={() => set({ degree: degree + 1 })} aria-label="Raise pitch">
              +
            </button>
          </div>
          <span className="muted">
            degree {degree} of {tuning.scale.name}
            {nodeTuning.region && <>, from region “{nodeTuning.region}”</>}
          </span>
        </div>
      )}

      {kind === 'start' && (
        <div className="field">
          <span className="field-label">Emit a pulse</span>
          <div className="segmented">
            {REPEATS.map((r) => (
              <button key={r} className={r === every ? 'is-on' : ''} onClick={() => set({ every: r })}>
                {r === 0 ? 'once' : r}
              </button>
            ))}
          </div>
          <span className="muted">{every ? `every ${every} beats while playing` : 'once, when you press play'}</span>
        </div>
      )}

      {kind === 'start' && (
        <KeyField value={node.data.key} does="fires this block while playing" taken={takenKeys} onChange={(key) => set({ key })} />
      )}

      <CodeField value={node.data.code ?? ''} target="block" onChange={(code) => set({ code })} />

      <div className="row">
        <button onClick={() => onFire(node.id)} disabled={!playing} title="Same as double-clicking the block">
          Fire pulse
        </button>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

const EPS = 1e-6;

// A link's length: type it ("1¾", "7/4", "1.75") or step it a quarter beat at
// a time, and the link bends to fit. It can't get shorter than the straight
// line between its blocks, so that's the floor, and the field says so.
function LengthField({ beats, minBeats, snap, onSet }: { beats: number; minBeats: number; snap: boolean; onSet: (beats: number) => void }) {
  const shown = formatBeats(beats, snap);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  // The shortest settable length, rounded up so the message never names one
  // that's still too short.
  const floor = snap ? Math.ceil(minBeats / GRID - EPS) * GRID : Math.ceil(minBeats * 100 - EPS) / 100;
  const apply = (value: number) => {
    if (!(value > 0)) return setError('Type a length in beats, like 1¾, 7/4 or 1.75.');
    if (value < minBeats - EPS) return setError(`It can't be shorter than ${formatBeats(floor, snap)} without moving a block.`);
    setError('');
    onSet(value);
  };
  const shorter = Math.floor(beats / GRID - EPS) * GRID;
  const longer = Math.ceil(beats / GRID + EPS) * GRID;

  return (
    <div className="field">
      <span className="field-label">Length</span>
      <div className="length-row">
        <button className="icon" aria-label="Shorter" title="A quarter beat shorter" disabled={shorter < minBeats - EPS} onClick={() => apply(shorter)}>
          −
        </button>
        <input
          className="length-input"
          type="text"
          inputMode="decimal"
          aria-label="Length in beats"
          value={text}
          onFocus={(e) => {
            setEditing(true);
            e.target.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (text.trim() !== shown) apply(parseLength(text));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setText(shown);
              setError('');
              setEditing(false);
            }
          }}
        />
        <span className="muted">beats</span>
        <button className="icon" aria-label="Longer" title="A quarter beat longer" onClick={() => apply(longer)}>
          +
        </button>
      </div>
      {error ? (
        <span className="warn">{error}</span>
      ) : (
        <span className="muted">How long a pulse takes to travel it. Type a length, or drag the link to bend it.</span>
      )}
    </div>
  );
}
