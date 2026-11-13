import type { ReactNode } from 'react';
import { CODE_REFERENCE } from './CodeField';
import { MOD } from './TopBar';
import { routeHref } from './ui/route';

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

const Keys = ({ k }: { k: string }) => (
  <>
    {k.split(' ').map((part, i) => (
      <kbd key={i}>{part}</kbd>
    ))}
  </>
);

const SECTIONS: Section[] = [
  {
    id: 'idea',
    title: 'The idea',
    body: (
      <>
        <p>
          Blocks make sounds, links are paths, and pulses travel along the links. <b>Distance is time</b>: a longer link
          means a pulse arrives later, so moving a block changes the rhythm while it plays.
        </p>
        <p>
          A closed circle of links is a <b>loop</b>: a pulse goes round it forever, and its total length is how long one
          trip takes. Each loop shows its length (↻) on the canvas. Loops of different lengths drift against each other,
          which is where most of the music comes from.
        </p>
      </>
    ),
  },
  {
    id: 'start',
    title: 'Getting started',
    body: (
      <ol>
        <li>
          Open <a href={routeHref('examples')}>an example</a>, or start from the canvas you have.
        </li>
        <li>
          Press <b>Play</b> (or <kbd>Space</kbd>). Every <b>Start</b> block sends out a pulse.
        </li>
        <li>Drag blocks around while it plays and listen to the rhythm change.</li>
        <li>Click anything to change it in the panel on the right.</li>
      </ol>
    ),
  },
  {
    id: 'canvas',
    title: 'On the canvas',
    body: (
      <table className="guide-table">
        <tbody>
          <tr>
            <td>Add a block</td>
            <td>Double-click empty canvas, or use the Add bar at the bottom.</td>
          </tr>
          <tr>
            <td>Sounds</td>
            <td>
              <b>Tone</b> is the sustained synth, <b>pluck</b> a string, and <b>bass</b> a low voice of its own. <b>Kick</b>,{' '}
              <b>snare</b> and <b>hat</b> are drums. A region's sample replaces its tones; pluck and bass keep their voices.
            </td>
          </tr>
          <tr>
            <td>Link two blocks</td>
            <td>Drag from a block's outer ring onto another block. Let go on empty canvas to grow a new block there.</td>
          </tr>
          <tr>
            <td>Bend a link</td>
            <td>Drag the link. Drag a bend to move it; double-click it to remove it. Or type an exact length in the panel.</td>
          </tr>
          <tr>
            <td>Fire a pulse</td>
            <td>Double-click a block while playing (when stopped, it plays the block's sound).</td>
          </tr>
          <tr>
            <td>Select several</td>
            <td>Shift-drag a box round them. Dragging them together keeps their links' bends.</td>
          </tr>
          <tr>
            <td>Move around</td>
            <td>Drag empty canvas to pan, scroll or pinch to zoom; the buttons at the bottom right zoom and fit.</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    id: 'tuning',
    title: 'Tuning and regions',
    body: (
      <>
        <p>
          With nothing selected, the panel sets the piece's <b>key and scale</b>. Pitches are scale degrees, so changing
          the scale retunes everything. Any scale menu can <b>import a Scala .scl file</b>, and any key menu can take its
          reference pitch from a <b>.kbm</b> file.
        </p>
        <p>
          A <b>region</b> gives part of the canvas its own key and scale, mix (level, pan, mute), effects (tone, echo,
          reverb) and sample. A block belongs to the region its centre is in, so dragging it across a border retunes it.
          Adding a region wraps the selected blocks; drag its name tab to move it with everything inside.
        </p>
      </>
    ),
  },
  {
    id: 'code',
    title: 'Code',
    body: (
      <>
        <p>
          Blocks and links can carry a few lines of code that decide what happens to each pulse. It's a small language of
          its own, so a shared piece can't run anything else. Lines run top to bottom; <code>#</code> starts a comment.
        </p>
        <table className="guide-table code-table">
          <tbody>
            {CODE_REFERENCE.map(([cmd, what, only]) => (
              <tr key={cmd}>
                <td>
                  <code>{cmd}</code>
                </td>
                <td>
                  {what}
                  {only && <span className="muted"> (blocks only)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          A <code>transpose</code> travels with the pulse, so in a loop it adds up on every pass; <code>transpose to</code>{' '}
          sets it outright instead. Conditions combine: <code>every 2: chance 50%: transpose +7</code>.
        </p>
      </>
    ),
  },
  {
    id: 'files',
    title: 'Save, share and record',
    body: (
      <ul>
        <li>The canvas saves itself in this browser as you work.</li>
        <li>
          <b>File → Save</b> downloads the piece with its samples; <b>File → Open</b> loads one.
        </li>
        <li>
          <b>Share</b> copies a link holding the whole piece. Nothing is uploaded, but samples are too big for a link, so
          send a file when they matter.
        </li>
        <li>
          <b>● Rec</b> records what you hear to a WAV file, until you press it again.
        </li>
      </ul>
    ),
  },
  {
    id: 'keys',
    title: 'Keyboard shortcuts',
    body: (
      <table className="guide-table keys-table">
        <tbody>
          {[
            ['Space', 'Play or stop'],
            [`${MOD}Z`, 'Undo'],
            [`${MOD}⇧Z`, 'Redo'],
            [`${MOD}S`, 'Save to a file'],
            [`${MOD}O`, 'Open a file'],
            ['Backspace', 'Delete the selection'],
            ['?', 'This guide'],
            ['Esc', 'Back to the canvas'],
          ].map(([k, does]) => (
            <tr key={k}>
              <td>
                <Keys k={k} />
              </td>
              <td>{does}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
];

// The contents list scrolls rather than linking with #ids, since the URL
// fragment holds the page itself.
export function GuidePage() {
  return (
    <div className="page guide-page">
      <nav className="guide-toc" aria-label="Guide sections">
        {SECTIONS.map((s) => (
          <button key={s.id} className="toc-link" onClick={() => document.getElementById(`guide-${s.id}`)?.scrollIntoView({ behavior: 'smooth' })}>
            {s.title}
          </button>
        ))}
      </nav>
      <article className="guide">
        <header className="page-header">
          <h1>Guide</h1>
          <p className="muted">Everything Pulse Canvas does, in a few minutes' reading.</p>
        </header>
        {SECTIONS.map((s) => (
          <section key={s.id} id={`guide-${s.id}`}>
            <h2>{s.title}</h2>
            {s.body}
          </section>
        ))}
      </article>
    </div>
  );
}
