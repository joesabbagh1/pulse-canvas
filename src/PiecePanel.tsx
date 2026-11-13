import { formatBeats } from './engine/geometry';
import type { Scale } from './engine/tuning';
import type { Loop } from './loops';
import { RootPicker, ScalePicker } from './ScalePicker';
import { useSettings } from './settings';
import { MOD } from './TopBar';
import { routeHref } from './ui/route';

interface Props {
  rootHz: number;
  scaleId: string;
  counts: { blocks: number; links: number; regions: number };
  loops: Loop[];
  onRoot: (hz: number) => void;
  onScale: (scaleId: string) => void;
  onImportScale: (scale: Scale) => void;
  onRemoveScale: (scaleId: string) => void;
}

const TIPS: [string, string][] = [
  ['Double-click', 'the canvas to add a tone'],
  ['Drag a ring', 'onto another block to link them'],
  ['Drag a link', 'to bend it: longer links take longer'],
  ['Double-click', 'a block to fire a pulse from it'],
  ['Backspace', 'deletes what is selected'],
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The sidebar with nothing selected: the piece as a whole. */
export function PiecePanel({ rootHz, scaleId, counts, loops, onRoot, onScale, onImportScale, onRemoveScale }: Props) {
  const { canvas, snap } = useSettings();
  return (
    <div className="inspector">
      <div className="inspector-title">Piece</div>
      <p className="muted">
        {plural(counts.blocks, 'block')} · {plural(counts.links, 'link')} · {plural(counts.regions, 'region')}
      </p>

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
      </div>

      <div className="field">
        <span className="field-label">Getting started</span>
        <ul className="tips">
          {TIPS.map(([what, does]) => (
            <li key={what + does}>
              <b>{what}</b> {does}
            </li>
          ))}
          <li>
            <kbd>Space</kbd> plays · <kbd>{MOD}Z</kbd> undoes
          </li>
        </ul>
        <a className="text-link" href={routeHref('guide')}>
          Read the guide →
        </a>
      </div>
    </div>
  );
}
