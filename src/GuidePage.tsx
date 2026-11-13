import type { ReactNode } from 'react';
import { CODE_REFERENCE } from './CodeField';
import { MAX_TAKE_BEATS, MAX_TAKE_NOTES } from './takes';
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
        <p>
          They come back into line after the least common multiple of their lengths: a 2-beat loop against a 3¾-beat
          one lines up every 30 beats, and that's when the whole piece repeats. The panel says when, and while playing
          the status shows which beat of that cycle you're on.
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
          <a href={routeHref('canvases')}>Canvases</a> lists every piece in this browser. Open one, or start from the canvas you have. An <a href={routeHref('examples')}>example</a> loads into the canvas that is open.
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
              <b>Instruments</b> opens the families: keyboards, bowed and plucked strings, winds, brass, percussion,
              voice, and synths. Each one has its own playing surface, covering every scale note in its range, and a
              note holds until the key comes up. <b>Tone</b> is the sustained synth. A drawn cycle or a region's sample
              replaces it; every other instrument keeps its own voice.
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
    id: 'instruments',
    title: 'Instruments',
    body: (
      <>
        <p>
          <b>Instruments</b> is where you play. The list on the left is the eight families. The surface on the right is
          that instrument: a keyboard, a fingerboard, a fretboard, strings, pipes, a wind or brass body, bars, a grid, a
          staff, or the instrument itself when it has one sound.
        </p>
        <p>
          The notes are the scale degrees that fall inside the instrument's range, at the piece's key. A violin in major
          runs from G3 to E7. A tuba sits low. A pentatonic harp has fewer strings than a major one. A maqam note that
          falls between the piano keys is its own key, hole, or fret.
        </p>
        <p>
          Pointer down starts the note and pointer up ends it. While the key is held, a sustained instrument keeps
          sounding, and a pluck rings until you let go. A mallet rings for its decay. A drum or an effect plays its whole
          hit, so a short tap does not cut it off. Pen pressure is the loudness.
        </p>
        <p>
          <Keys k="A S D F G H J K W E T Y U" /> play the scale notes of the octave in view, in order. <Keys k="Z" /> and{' '}
          <Keys k="X" /> move that octave. <b>Record</b> writes the performance as a take: up to {MAX_TAKE_NOTES} notes or {MAX_TAKE_BEATS} beats,
          snapped to the grid. <b>Use on canvas</b> lays the take out as linked blocks.
        </p>
      </>
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
          reverb), groove (swing on 8ths or 16ths, and humanize) and sample. Groove moves when notes sound, never when
          pulses arrive, so loops stay in time however much swing is on. A block belongs to the region its centre is in, so dragging it across a border retunes it.
          Adding a region wraps the selected blocks; drag its name tab to move it with everything inside.
        </p>
      </>
    ),
  },
  {
    id: 'waves',
    title: 'Waves',
    body: (
      <>
        <p>
          <a href={routeHref('waves')}>Waves</a> is its own page. The canvas is where notes and time live; Waves is where
          the synth is drawn. A wave belongs to the region its middle sits in, and it moves when that region moves.
        </p>
        <p>
          A <b>cycle</b> is one period of an oscillator. Left on the region, it replaces Tone. Aim it at an instrument,
          and it replaces that instrument's tone instead: a violin, a flute, the jaw harp. Up from the dashed line is the
          top of the wave. <b>Saw</b>, <b>square</b> and <b>sine</b> drop a shape; the <b>pencil</b> draws one. Drag a
          point to reshape it, drag the line to add a point, double-click a point to remove it, and drag the name to move
          the whole drawing. When one target has several cycles, the newest one is the one you hear. A loaded sample
          still plays instead of Tone.
        </p>
        <p>
          A <b>cutoff</b> motion loops, and its width is the loop in beats — the same pixels-to-beats rule as a link.{' '}
          <b>Decay</b> drops a two-beat sweep. On the region, height bends the Tone filter around the Tone slider. Aim it
          at one instrument and only that instrument's filter moves. Motions on the same target add together. A dot rides
          the line while it plays. Turn the pencil off (or drag with the middle button) to pan. The notes keep firing
          from the canvas.
        </p>
      </>
    ),
  },
  {
    id: 'patterns',
    title: 'Patterns',
    body: (
      <>
        <p>
          A <b>pattern</b> block is a box as wide as its length. The code is typed in the box. A pulse goes in at the
          left, plays the pattern while it crosses, and leaves at the right. Drag the right edge to change that length.
        </p>
        <p>
          The instrument on the block is the one that plays. The text is{' '}
          <a href="https://strudel.cc/learn/mini-notation/">Strudel mini-notation</a> for the rhythm and the pitch:
          numbers are scale degrees above the block's own pitch, and a word such as <code>bd</code> is just a hit of
          that same instrument. <code>[bd sd]</code> squeezes into one step, <code>hh*4</code> is four times as fast,{' '}
          <code>bd(3,8)</code> spreads 3 hits over 8 steps, and <code>&lt;0 2 4&gt;</code> plays one per pulse, in turn.
        </p>
        <p>
          Add one from the bar, or select a block and switch it from <b>Disc</b> to <b>Pattern</b>. <code>fast</code>,{' '}
          <code>slow</code> and <code>rev</code> in its code change how that pass plays, and the drawing follows. Under
          the code it can be a <b>roll</b> of bars, the same roll stood on end, a <b>spiral</b>, or a <b>pitch wheel</b>.
          The notation is parsed, never run as JavaScript. <code>scale minor</code>, <code>octave -1</code> and{' '}
          <code>sound piano</code> can lead the line, and the level slider sets how loud it is. The filter slider beside it
          darkens only this pattern. While a pulse is inside, the drawing and the lit word follow that pass, including{' '}
          <code>every</code> and <code>chance</code>. The sounding word lights up, and a small wave of that box's notes
          draws along its bottom. The mix panel can also scroll a spectrogram. A shared piece still can't run its own
          drawing code or Hydra.
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
    id: 'live',
    title: 'Playing live',
    body: (
      <>
        <p>
          Select a <b>start</b> block or a <b>region</b> and give it a <b>performance key</b>: any letter or digit. While
          playing, a start block's key sends out a pulse each time you press it, and a region's key mutes and unmutes it.
          Keys show on the canvas and in the panel; with <b>● Rec</b> on, what you play is recorded. The panel at the
          bottom left draws the whole mix, as a wave or as frequency bands.
        </p>
        <p>
          <b>Deck</b> lets an AI play the open canvas. Cursor starts the deck for this project; otherwise run <code>npm run deck</code> beside the app. The Deck light in
          the bar comes on when the page is connected. Press <b>Play</b> once so the browser allows sound. After that
          the deck can start and stop, fire blocks, ride a region's mix, and move blocks. A link's length is how long a
          pulse takes, so moving a block changes the rhythm while it plays.
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
            ['A–Z, 0–9', 'Performance keys you have given to start blocks and regions'],
            ['A S D F G H J K', 'On Instruments, the scale notes of the octave in view'],
            ['W E T Y U', 'On Instruments, the rest of that octave'],
            ['Z / X', 'On Instruments, the octave below or above'],
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
