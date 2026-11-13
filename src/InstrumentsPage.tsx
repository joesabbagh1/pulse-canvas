import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CATEGORIES, instrumentById, instrumentsIn, type Instrument } from './engine/instruments';
import { PLAY_KEYS, degreeForKey, hintFor, initialFocus, notesInRange, playingFor, playingHint, shiftFocus, type PlayNote } from './engine/playing';
import { describePitch, type Scale } from './engine/tuning';
import { InstrumentSurface } from './instruments/Surface';
import { newId } from './piece';
import { MAX_TAKE_BEATS, MAX_TAKE_NOTES, clipTake, defaultTakeName, type Take, type TakeNote } from './takes';

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
  audio: number;
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
  notes: readonly PlayNote[];
  focus: number;
  onShift: (direction: -1 | 1) => void;
  onAttack: (instrumentId: string, degree: number, velocity: number) => number;
  onRelease: (id: number) => void;
  onSaveTake: (take: Take) => void;
  onPlace: (take: Take) => void;
}

/**
 * Pointer and computer-key performance. Note-ons and note-offs are beats on
 * the piece clock. A second Record press, 64 notes, or 32 beats ends the take.
 */
function useRecorder({
  bpm,
  snap,
  scale,
  instrument,
  takes,
  notes,
  focus,
  onShift,
  onAttack,
  onRelease,
  onSaveTake,
}: Omit<Props, 'onPlace' | 'rootHz'> & { instrument: Instrument }) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<ReadonlySet<number>>(() => new Set());
  const [padHeld, setPadHeld] = useState(false);
  const [progress, setProgress] = useState({ notes: 0, beat: 0 });

  const bpmRef = useRef(bpm);
  const snapRef = useRef(snap);
  const scaleRef = useRef(scale);
  const instrumentRef = useRef(instrument);
  const takesRef = useRef(takes);
  const onAttackRef = useRef(onAttack);
  const onReleaseRef = useRef(onRelease);
  const onSaveRef = useRef(onSaveTake);
  const notesRef = useRef(notes);
  const focusRef = useRef(focus);
  const onShiftRef = useRef(onShift);
  bpmRef.current = bpm;
  snapRef.current = snap;
  scaleRef.current = scale;
  instrumentRef.current = instrument;
  takesRef.current = takes;
  onAttackRef.current = onAttack;
  onReleaseRef.current = onRelease;
  onSaveRef.current = onSaveTake;
  notesRef.current = notes;
  focusRef.current = focus;
  onShiftRef.current = onShift;

  const recordingRef = useRef(false);
  const clock = useRef({ t: 0, beat: 0 });
  const holds = useRef(new Map<string, Hold>());
  const voices = useRef(new Map<string, OpenNote>());
  const pending = useRef<TakeNote[]>([]);
  const pointers = useRef(new Map<number, string>());
  const keyTokens = useRef(new Map<string, string>());

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
      if (token.startsWith('d:')) semis.add(Number(token.slice(2)));
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
    const audio = onAttackRef.current(instrumentRef.current.id, degree, velocity);
    holds.current.set(token, { count: 1, degree, audio });
    syncHeld();
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
    onReleaseRef.current(hold.audio);
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
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'x') {
        event.preventDefault();
        onShiftRef.current(key === 'x' ? 1 : -1);
        return;
      }
      if (!PLAY_KEYS.includes(key as (typeof PLAY_KEYS)[number])) return;
      event.preventDefault();
      const pitched = instrumentRef.current.pitched;
      const degree = pitched ? degreeForKey(key, focusRef.current, scaleRef.current, notesRef.current) : 0;
      if (degree === null) return;
      const token = pitched ? `d:${degree}` : `k:${key}`;
      keyTokens.current.set(key, token);
      pressRef.current(token, degree, 1);
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const token = keyTokens.current.get(key);
      if (!token) return;
      keyTokens.current.delete(key);
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
      releaseAllRef.current();
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

export function InstrumentsPage({ bpm, snap, scale, rootHz, takes, onAttack, onRelease, onSaveTake, onPlace }: Omit<Props, 'notes' | 'focus' | 'onShift'>) {
  const [instrumentId, setInstrumentId] = useState('tone');
  const [listOpen, setListOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const instrument = instrumentById(instrumentId) ?? instrumentById('tone')!;
  const playing = playingFor(instrument.id) ?? playingFor('tone')!;
  const notes = useMemo(
    () => ('low' in playing ? notesInRange(scale, rootHz, playing.low, playing.high) : []),
    [playing, rootHz, scale],
  );
  const [focus, setFocus] = useState(() => initialFocus(notes, scale));
  useEffect(() => {
    setFocus(initialFocus(notes, scale));
  }, [notes, scale]);
  const play = useRecorder({
    bpm,
    snap,
    scale,
    instrument,
    takes,
    notes,
    focus,
    onShift: (direction) => setFocus((current) => shiftFocus(current, scale, notes, direction)),
    onAttack,
    onRelease,
    onSaveTake,
  });
  const hue = CATEGORIES.find((category) => category.id === instrument.category)?.hue ?? 200;
  const swatch = { '--c': `hsl(${hue} 62% 58%)` } as CSSProperties;
  const root = describePitch(0, scale, rootHz);
  const hints = useMemo(() => {
    const out = new Map<number, string>();
    if (!instrument.pitched) return out;
    for (const note of notes) {
      const hint = hintFor(note.degree, focus, scale, notes);
      if (hint) out.set(note.degree, hint);
    }
    return out;
  }, [focus, instrument.pitched, notes, scale]);

  const choose = (id: string) => {
    if (id === instrument.id) return;
    play.stop();
    play.releaseAll();
    setInstrumentId(id);
  };

  const ignoreMenu = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className={`page instruments-page${listOpen ? '' : ' is-list-closed'}`}>
      {listOpen && (
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
      )}

      <div className="instrument-stage">
        <header className="instrument-intro">
          <div className="instrument-heading">
            <button type="button" className="catalog-toggle" aria-expanded={listOpen} onClick={() => setListOpen((open) => !open)}>
              {listOpen ? 'Hide list' : 'Instruments'}
            </button>
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
          <div className="instrument-surface" style={swatch}>
            <InstrumentSurface
              playing={playing}
              scale={scale}
              name={instrument.name}
              notes={notes}
              held={play.held}
              hints={hints}
              padHeld={play.padHeld}
              onPointerDown={play.onPointerDown}
              onPointerEnd={play.onPointerEnd}
              onContextMenu={ignoreMenu}
            />
          </div>

          <p className="muted instrument-keys">{playingHint(playing)}</p>

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
