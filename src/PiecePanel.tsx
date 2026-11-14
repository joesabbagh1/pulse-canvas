import { formatBeats } from './engine/geometry';
import type { Scale } from './engine/tuning';
import { MAX_CYCLE_BEATS, type Cycle } from './cycle';
import type { Loop } from './loops';
import { RootPicker, ScalePicker } from './ScalePicker';
import { useSettings } from './settings';
import { MOD } from './TopBar';
import { routeHref } from './ui/route';

interface Props {
  rootHz: number;
  scaleId: string;
  counts: { blocks: number; links: number; regions: number; waves: number };
  /** The open canvas, from the list on the Canvases page. */
  canvasName: string;
  loops: Loop[];
  cycle: Cycle;
  bpm: number;
  bindings: { key: string; does: string }[];
  /** Which page this panel is sitting on. The tips follow the job of that page. */
  page?: 'canvas' | 'waves';
  onRoot: (hz: number) => void;
  onScale: (scaleId: string) => void;
  onImportScale: (scale: Scale) => void;
  onRemoveScale: (scaleId: string) => void;
}

const CANVAS_TIPS: [string, string][] = [
  ['Double-click', 'the canvas to add a tone'],
  ['Drag a ring', 'onto another block to link them'],
  ['Drag a link', 'to bend it: longer links take longer'],
  ['Double-click', 'a block to fire a pulse from it'],
  ['Backspace', 'deletes what is selected'],
];

const WAVE_TIPS: [string, string][] = [
  ['Pencil', 'drag empty space to draw a cycle'],
  ['Saw, square, sine', 'drop a tone shape'],
  ['Decay', 'drops a two-beat filter sweep'],
  ['Drag a point', 'to reshape it; double-click a point to remove it'],
  ['The middle', 'of a drawing picks the region it sounds in'],
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const COUNTS = [
  ['blocks', 'blocks'],
  ['links', 'links'],
  ['regions', 'regions'],
  ['waves', 'waves'],
] as const;

function duration(seconds: number) {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

// Travel time only: code that counts passes or delays can stretch it, so say "about".
function cycleText(cycle: Cycle, bpm: number) {
  switch (cycle.kind) {
    case 'repeats':
      return `Everything lines up again every ${formatBeats(cycle.beats, true)} ${cycle.beats === 1 ? 'beat' : 'beats'}, about ${duration((cycle.beats * 60) / bpm)} at ${bpm} BPM: the whole piece repeats.`;
    case 'drifts':
      return 'With free timing the loops never line up exactly, so the piece never quite repeats.';
    case 'too-long':
      return `The loops only line up again after more than ${MAX_CYCLE_BEATS.toLocaleString()} beats: in practice the piece never repeats.`;
    case 'none':
      return '';
  }
}

/** The sidebar with nothing selected: the piece as a whole. */
export function PiecePanel({ rootHz, scaleId, counts, loops, cycle, bpm, bindings, page = 'canvas', canvasName, onRoot, onScale, onImportScale, onRemoveScale }: Props) {
  const { canvas, snap } = useSettings();
  return (
    <div className="inspector">
      <div className="inspector-title">
        {canvasName}
      </div>
      <div className="meter" aria-label="Piece size">
        {COUNTS.map(([key, label]) => (
          <div key={key} className="meter-cell">
            <span className="meter-value">{counts[key]}</span>
            <span className="meter-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="field">
        <span className="field-label">Key and scale</span>
        <div className="tuning-row">
          <RootPicker value={rootHz} scale={canvas.scale} label="Key outside regions" onChange={onRoot} />
          <ScalePicker value={scaleId} label="Scale outside regions" onChange={onScale} onImport={onImportScale} onRemove={onRemoveScale} />
        </div>
        <span className="muted">For every block outside a region.</span>
      </div>

      <div className="field">
        <span className="field-label">Loops</span>
        {loops.length ? (
          <ul className="loop-list">
            {loops.map((loop) => (
              <li key={loop.blocks.join('>')}>
                <span className="loop-beats">↻ {formatBeats(loop.beats, snap)}</span>
                <span className="muted">
                  {formatBeats(loop.beats, snap) === '1' ? 'beat' : 'beats'} round {plural(loop.blocks.length, 'block')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted">None yet. Link the last block back to the first and a pulse goes round it forever.</span>
        )}
        {cycle.kind !== 'none' && <p className="cycle">{cycleText(cycle, bpm)}</p>}
      </div>

      {bindings.length > 0 && (
        <div className="field">
          <span className="field-label">Performance keys</span>
          <ul className="loop-list">
            {[...bindings]
              .sort((a, b) => a.key.localeCompare(b.key))
              .map((b) => (
                <li key={b.key}>
                  <kbd>{b.key.toUpperCase()}</kbd>
                  <span className="muted">{b.does}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="field">
        <span className="field-label">Getting started</span>
        <ul className="tips">
          {(page === 'waves' ? WAVE_TIPS : CANVAS_TIPS).map(([what, does]) => (
            <li key={what + does}>
              <b>{what}</b> {does}
            </li>
          ))}
          <li>
            <kbd>Space</kbd> plays · <kbd>{MOD}Z</kbd> undoes
          </li>
          {page === 'canvas' && (
            <li>
              <b>Give a key</b> to a start block or region to play it live
            </li>
          )}
        </ul>
        <a className="text-link" href={routeHref('canvases')}>
          All canvases
        </a>
        {page === 'waves' ? (
          <a className="text-link" href={routeHref('canvas')}>
            Notes and time stay on the canvas →
          </a>
        ) : (
          <a className="text-link" href={routeHref('waves')}>
            Draw the synth on the Waves page →
          </a>
        )}
        <a className="text-link" href={routeHref('guide')}>
          Read the guide →
        </a>
      </div>
    </div>
  );
}
