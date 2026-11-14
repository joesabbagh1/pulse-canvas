import { EXAMPLES, type Example } from './examples';
import { MOD } from './TopBar';

// Ready-made patches, one per tradition. Opening one replaces the canvas
// (after a confirm, and undoably) and takes you to it: pick a tradition, land
// in its tuning, press play.
export function ExamplesPage({ onOpen }: { onOpen: (example: Example) => void }) {
  return (
    <div className="page">
      <div className="page-body">
        <header className="page-header">
          <h1>Examples</h1>
          <p className="muted">Ready-made patches in different tunings. Opening one replaces the canvas; {MOD}Z brings yours back.</p>
        </header>
        <div className="examples-grid">
          {EXAMPLES.map((example) => (
            <article key={example.id} className="example-card">
              <div className="example-body">
                <div className="example-tradition">{example.tradition}</div>
                <h2>{example.title}</h2>
                <p className="muted">{example.description}</p>
                <div className="example-scales">
                  {example.scales.map((s) => (
                    <span key={s} className="example-scale-chip" title={s}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <footer className="example-footer">
                <span className="example-meta muted">
                  {example.piece.bpm} BPM · {example.piece.blocks.length} blocks
                  {example.piece.regions.length > 0 &&
                    ` · ${example.piece.regions.length} region${example.piece.regions.length === 1 ? '' : 's'}`}
                </span>
                <button className="play" onClick={() => onOpen(example)}>
                  Open
                </button>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
