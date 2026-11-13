import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CATEGORIES, instrumentById, instrumentsIn, type Instrument } from './engine/instruments';
import { describePitch, type Scale } from './engine/tuning';
import { newId } from './piece';
import {
  MAX_TAKE_BEATS,
  MAX_TAKE_NOTES,
  clipTake,
  defaultTakeName,
  keyDegree,
  type Take,
  type TakeNote,
} from './takes';

// Two octaves, C to C: 15 white keys. The black keys sit in the C-major groups
// of two and three. Computer keys cover the lower octave, the same way a
// piano roll does: a s d f g h j k white, w e t y u black.
const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];
const WHITES: number[] = [];
for (let octave = 0; octave < 2; octave++) for (const step of WHITE_STEPS) WHITES.push(octave * 12 + step);
WHITES.push(24);

const BLACKS = [1, 3, 6, 8, 10, 13, 15, 18, 20, 22].map((semi) => {
  let index = 0;
  for (let i = 0; i < WHITES.length; i++) if (WHITES[i] < semi) index = i;
  return { semi, left: ((index + 1) / WHITES.length) * 100 };
});

const COMPUTER_WHITE: Record<string, number> = { a: 0, s: 2, d: 4, f: 5, g: 7, h: 9, j: 11, k: 12 };
const COMPUTER_BLACK: Record<string, number> = { w: 1, e: 3, t: 6, y: 8, u: 10 };
const KEY_HINT = new Map<number, string>([
  [0, 'A'],
  [2, 'S'],
  [4, 'D'],
  [5, 'F'],
  [7, 'G'],
  [9, 'H'],
  [11, 'J'],
  [12, 'K'],
  [1, 'W'],
  [3, 'E'],
  [6, 'T'],
  [8, 'Y'],
  [10, 'U'],
]);

function computerSemitone(key: string): number | null {
  const letter = key.toLowerCase();
  if (letter in COMPUTER_WHITE) return COMPUTER_WHITE[letter];
  if (letter in COMPUTER_BLACK) return COMPUTER_BLACK[letter];
  return null;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input[type="text"], input[type="number"], select, textarea');

function velocityFrom(event: { pointerType: string; pressure: number }): number {
  // A mouse reports a fake pressure. A pen's pressure is the velocity.
  if (event.pointerType === 'pen' && event.pressure > 0 && event.pressure <= 1) return event.pressure;
  return 1;
}

interface Hold {
  count: number;
  degree: number;
}

interface OpenNote {
  beat: number;
  velocity: number;
  degree: number;
}

interface Props {
  bpm: number;
  snap: boolean;
  scale: Scale;
  rootHz: number;
  takes: readonly Take[];
  onPlay: (instrumentId: string, degree: number) => void;
  onSaveTake: (take: Take) => void;
  onPlace: (take: Take) => void;
}

/**
 * Pointer and computer-key performance. Note-ons and note-offs are beats on
 * the piece clock. A second Record press, 64 notes, or 32 beats ends the take.
 */
function useRecorder({ bpm, snap, scale, instrument, takes, onPlay, onSaveTake }: Omit<Props, 'onPlace' | 'rootHz'> & { instrument: Instrument }) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<ReadonlySet<number>>(() => new Set());
  const [padHeld, setPadHeld] = useState(false);
  const [progress, setProgress] = useState({ notes: 0, beat: 0 });

  const bpmRef = useRef(bpm);
  const snapRef = useRef(snap);
  const scaleRef = useRef(scale);
  const instrumentRef = useRef(instrument);
  const takesRef = useRef(takes);
  const onPlayRef = useRef(onPlay);
  const onSaveRef = useRef(onSaveTake);
  bpmRef.current = bpm;
  snapRef.current = snap;
  scaleRef.current = scale;
  instrumentRef.current = instrument;
  takesRef.current = takes;
  onPlayRef.current = onPlay;
  onSaveRef.current = onSaveTake;

  const recordingRef = useRef(false);
  const clock = useRef({ t: 0, beat: 0 });
  const holds = useRef(new Map<string, Hold>());
  const voices = useRef(new Map<string, OpenNote>());
  const pending = useRef<TakeNote[]>([]);
  const pointers = useRef(new Map<number, string>());

  const readBeat = () => {
    const now = performance.now();
    const elapsed = Math.max(0, (now - clock.current.t) / 1000) * (bpmRef.current / 60);
    const beat = clock.current.beat + elapsed;
    clock.current = { t: now, beat };
    return beat;
  };

  const syncHeld = () => {
    const semis = new Set<number>();
    let pad = false;
    for (const token of holds.current.keys()) {
      if (token.startsWith('s:')) semis.add(Number(token.slice(2)));
      else pad = true;
    }
    setHeld(semis);
    setPadHeld(pad);
  };

  const syncProgress = (beat: number) => {
    setProgress({ notes: pending.current.length + voices.current.size, beat });
  };

  const flush = (): TakeNote[] => {
    const end = readBeat();
    for (const voice of voices.current.values()) {
      pending.current.push({
        beat: voice.beat,
        beats: Math.max(0, end - voice.beat),
        degree: voice.degree,
        velocity: voice.velocity,
      });
    }
    voices.current.clear();
    pending.current.sort((a, b) => a.beat - b.beat);
    const notes = clipTake(pending.current, snapRef.current);
    pending.current = [];
    return notes;
  };

  const build = (notes: TakeNote[]): Take => {
    const inst = instrumentRef.current;
    return {
      id: newId('take'),
      name: defaultTakeName(inst.name, takesRef.current, inst.id),
      instrument: inst.id,
      notes,
    };
  };

  const stop = () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    const notes = flush();
    setRecording(false);
    setProgress({ notes: 0, beat: 0 });
    if (notes.length) onSaveRef.current(build(notes));
  };

  const press = (token: string, degree: number, velocity: number) => {
    const hold = holds.current.get(token);
    if (hold) {
      hold.count += 1;
      return;
    }
    holds.current.set(token, { count: 1, degree });
    syncHeld();
    onPlayRef.current(instrumentRef.current.id, degree);
    if (!recordingRef.current) return;
    const beat = readBeat();
    if (beat >= MAX_TAKE_BEATS || pending.current.length + voices.current.size >= MAX_TAKE_NOTES) {
      stop();
      return;
    }
    voices.current.set(token, { beat, velocity, degree });
    syncProgress(beat);
  };

  const release = (token: string) => {
    const hold = holds.current.get(token);
    if (!hold) return;
    hold.count -= 1;
    if (hold.count > 0) return;
    holds.current.delete(token);
    syncHeld();
    const voice = voices.current.get(token);
    voices.current.delete(token);
    if (!voice || !recordingRef.current) return;
    const end = readBeat();
    pending.current.push({
      beat: voice.beat,
      beats: Math.max(0, end - voice.beat),
      degree: voice.degree,
      velocity: voice.velocity,
    });
    syncProgress(end);
    if (pending.current.length >= MAX_TAKE_NOTES || end >= MAX_TAKE_BEATS) stop();
  };

  const releaseAll = () => {
    for (const token of [...holds.current.keys()]) release(token);
  };

  const start = () => {
    if (recordingRef.current) return;
    pending.current = [];
    voices.current.clear();
    clock.current = { t: performance.now(), beat: 0 };
    recordingRef.current = true;
    setRecording(true);
    for (const [token, hold] of holds.current) {
      if (voices.current.size >= MAX_TAKE_NOTES) break;
      voices.current.set(token, { beat: 0, velocity: 1, degree: hold.degree });
    }
    syncProgress(0);
  };

  const stopRef = useRef(stop);
  const releaseAllRef = useRef(releaseAll);
  const pressRef = useRef(press);
  const releaseRef = useRef(release);
  const flushRef = useRef(flush);
  const buildRef = useRef(build);
  stopRef.current = stop;
  releaseAllRef.current = releaseAll;
  pressRef.current = press;
  releaseRef.current = release;
  flushRef.current = flush;
  buildRef.current = build;

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      if (!recordingRef.current) return;
      const beat = readBeat();
      syncProgress(beat);
      if (beat >= MAX_TAKE_BEATS) stopRef.current();
    }, 80);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const semi = computerSemitone(event.key);
      if (semi === null) return;
      event.preventDefault();
      const pitched = instrumentRef.current.pitched;
      const token = pitched ? `s:${semi}` : `k:${event.key.toLowerCase()}`;
      const degree = pitched ? keyDegree(semi, scaleRef.current) : 0;
      pressRef.current(token, degree, 1);
    };
    const up = (event: KeyboardEvent) => {
      const semi = computerSemitone(event.key);
      if (semi === null) return;
      const pitched = instrumentRef.current.pitched;
      const token = pitched ? `s:${semi}` : `k:${event.key.toLowerCase()}`;
      releaseRef.current(token);
    };
    const blur = () => releaseAllRef.current();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      if (!recordingRef.current) return;
      recordingRef.current = false;
      const notes = flushRef.current();
      if (notes.length) onSaveRef.current(buildRef.current(notes));
    };
    // Listeners read the latest handlers through refs.
  }, []);

  const onPointerDown = (event: ReactPointerEvent, token: string, degree: number) => {
    // Right-click (and ctrl-click, which is a right-click on a Mac) does not play.
    if (event.button !== 0 || event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, token);
    press(token, degree, velocityFrom(event));
  };

  const onPointerEnd = (event: ReactPointerEvent) => {
    const token = pointers.current.get(event.pointerId);
    if (!token) return;
    pointers.current.delete(event.pointerId);
    release(token);
  };

  return {
    recording,
    held,
    padHeld,
    progress,
    toggle: () => (recordingRef.current ? stop() : start()),
    stop,
    releaseAll,
    onPointerDown,
    onPointerEnd,
  };
}

export function InstrumentsPage({ bpm, snap, scale, rootHz, takes, onPlay, onSaveTake, onPlace }: Props) {
  const [instrumentId, setInstrumentId] = useState('tone');
  const instrument = instrumentById(instrumentId) ?? instrumentById('tone')!;
  const play = useRecorder({ bpm, snap, scale, instrument, takes, onPlay, onSaveTake });
  const hue = CATEGORIES.find((category) => category.id === instrument.category)?.hue ?? 200;
  const swatch = { '--c': `hsl(${hue} 62% 58%)` } as CSSProperties;
  const root = describePitch(0, scale, rootHz);

  const labels = useMemo(() => {
    const out = new Map<number, { name: string; octave: number; degree: number }>();
    for (let semi = 0; semi <= 24; semi++) {
      const degree = instrument.pitched ? keyDegree(semi, scale) : 0;
      const pitch = describePitch(degree, scale, rootHz);
      out.set(semi, { name: pitch.name, octave: pitch.octave, degree });
    }
    return out;
  }, [instrument.pitched, rootHz, scale]);

  const choose = (id: string) => {
    if (id === instrument.id) return;
    play.stop();
    play.releaseAll();
    setInstrumentId(id);
  };

  const ignoreMenu = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className="page instruments-page">
      <aside className="instrument-catalog" aria-label="Instruments">
        <h1 data-n="04">Instruments</h1>
        {CATEGORIES.map((category, family) => (
          <section key={category.id} className="instrument-family">
            <h2 data-n={String(family + 1).padStart(2, '0')}>{category.label}</h2>
            {instrumentsIn(category.id).map((item, index) => (
              <button
                type="button"
                key={item.id}
                data-n={String(index + 1).padStart(2, '0')}
                className={`instrument-choice${item.id === instrument.id ? ' is-on' : ''}`}
                aria-pressed={item.id === instrument.id}
                onClick={() => choose(item.id)}
              >
                <span className="dock-swatch" style={{ '--c': `hsl(${category.hue} 62% 58%)` } as CSSProperties} aria-hidden="true" />
                <span className="instrument-choice-name">{item.name}</span>
              </button>
            ))}
          </section>
        ))}
      </aside>

      <div className="instrument-stage">
        <header className="instrument-intro">
          <div className="instrument-heading">
            <span className="dock-swatch" style={swatch} aria-hidden="true" />
            <h2>{instrument.name}</h2>
          </div>
          <p className="muted">{instrument.hint}</p>
          <p className="muted">
            Root {root.name}
            <sub>{root.octave}</sub>
            {' · '}
            {scale.name}
            {' · '}
            {bpm} BPM. Notes snap to {snap ? '¼' : '1/16'} beats. A take holds {MAX_TAKE_NOTES} notes or {MAX_TAKE_BEATS} beats.
          </p>
        </header>

        <div className="instrument-player">
          {instrument.pitched ? (
            <div className="piano" onContextMenu={ignoreMenu} aria-label="Keyboard" role="group">
              <div className="piano-whites">
                {WHITES.map((semi) => {
                  const label = labels.get(semi)!;
                  const hint = KEY_HINT.get(semi);
                  return (
                    <div
                      key={semi}
                      role="button"
                      aria-label={`${label.name}${label.octave}${hint ? `, key ${hint}` : ''}`}
                      aria-pressed={play.held.has(semi)}
                      title={`${label.name}${label.octave} · degree ${label.degree}${hint ? ` · ${hint}` : ''}`}
                      className={`piano-white${play.held.has(semi) ? ' is-down' : ''}`}
                      onPointerDown={(event) => play.onPointerDown(event, `s:${semi}`, label.degree)}
                      onPointerUp={play.onPointerEnd}
                      onPointerCancel={play.onPointerEnd}
                      onLostPointerCapture={play.onPointerEnd}
                    >
                      <span className="piano-note">
                        {label.name}
                        <sub>{label.octave}</sub>
                      </span>
                      {hint && <span className="piano-hint">{hint}</span>}
                    </div>
                  );
                })}
              </div>
              {BLACKS.map(({ semi, left }) => {
                const label = labels.get(semi)!;
                const hint = KEY_HINT.get(semi);
                return (
                  <div
                    key={semi}
                    role="button"
                    aria-label={`${label.name}${label.octave}${hint ? `, key ${hint}` : ''}`}
                    aria-pressed={play.held.has(semi)}
                    title={`${label.name}${label.octave} · degree ${label.degree}${hint ? ` · ${hint}` : ''}`}
                    className={`piano-black${play.held.has(semi) ? ' is-down' : ''}`}
                    style={{ left: `${left}%` }}
                    onPointerDown={(event) => play.onPointerDown(event, `s:${semi}`, label.degree)}
                    onPointerUp={play.onPointerEnd}
                    onPointerCancel={play.onPointerEnd}
                    onLostPointerCapture={play.onPointerEnd}
                  >
                    <span className="piano-note">
                      {label.name}
                      <sub>{label.octave}</sub>
                    </span>
                    {hint && <span className="piano-hint">{hint}</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              role="button"
              className={`drum-pad${play.padHeld ? ' is-down' : ''}`}
              style={swatch}
              aria-label={`Play ${instrument.name}`}
              aria-pressed={play.padHeld}
              onContextMenu={ignoreMenu}
              onPointerDown={(event) => play.onPointerDown(event, `p:${event.pointerId}`, 0)}
              onPointerUp={play.onPointerEnd}
              onPointerCancel={play.onPointerEnd}
              onLostPointerCapture={play.onPointerEnd}
            >
              {instrument.name}
            </div>
          )}

          <p className="muted instrument-keys">
            {instrument.pitched
              ? 'A S D F G H J K play the white keys, W E T Y U the black ones. Pointer down sounds, pointer up ends the note.'
              : 'Tap the pad, or play it from A S D F G H J K and W E T Y U.'}
          </p>

          <div className="row">
            <button type="button" className={`rec${play.recording ? ' is-on' : ''}`} aria-pressed={play.recording} onClick={play.toggle}>
              {play.recording ? `Stop ${play.progress.beat.toFixed(1)}` : 'Record'}
            </button>
            {play.recording && (
              <span className="muted">
                {play.progress.notes} / {MAX_TAKE_NOTES} notes
              </span>
            )}
          </div>
        </div>

        <section className="instrument-takes" aria-label="Takes">
          <h2>Takes</h2>
          {takes.length === 0 ? (
            <p className="muted">Record a performance, then place it on the canvas.</p>
          ) : (
            <ul className="take-list">
              {[...takes].reverse().map((take) => (
                <li key={take.id} className="take-row">
                  <div className="take-copy">
                    <div className="take-name">{take.name}</div>
                    <div className="muted">
                      {take.notes.length} {take.notes.length === 1 ? 'note' : 'notes'}
                    </div>
                  </div>
                  <button type="button" className="play" onClick={() => onPlace(take)} disabled={take.notes.length === 0}>
                    Use on canvas
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
