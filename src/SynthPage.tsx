import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { confirmDialog } from './ui/Confirm';
import { DEFAULT_PATCH, machineInstrument, machineShort, PRESETS, type SynthMachine } from './engine/synth';
import { hintFor, initialFocus, notesInRange, playingFor, playingHint, shiftFocus, type PlayNote } from './engine/playing';
import { describePitch, type Scale } from './engine/tuning';
import { InstrumentSurface } from './instruments/Surface';
import { useRecorder } from './InstrumentsPage';
import { MAX_TAKE_NOTES, type Take } from './takes';
import { SynthPatchFields } from './SynthPatchFields';

// The synth workbench: this piece's machines on the left, one machine's patch
// and its keyboard on the right. A machine is a piece-level instrument (see
// engine/synth.ts), so what's edited here is what blocks play on the canvas.

interface SynthPageProps {
  bpm: number;
  snap: boolean;
  scale: Scale;
  rootHz: number;
  machines: readonly SynthMachine[];
  takes: readonly Take[];
  /** Adds a machine from a preset (or the default patch) and returns its id. */
  onAdd: (presetId?: string) => string;
  onEdit: (id: string, patch: Partial<SynthMachine>) => void;
  /** Blocks playing the machine are retargeted to the plain tone. */
  onRemove: (id: string) => void;
  onAttack: (instrumentId: string, degree: number, velocity: number) => number;
  onRelease: (id: number) => void;
  onSaveTake: (take: Take) => void;
  onPlace: (take: Take) => void;
}

const HUE = 200;
const swatch = { '--c': `hsl(${HUE} 62% 58%)` } as CSSProperties;

/** A stand-in so the recorder hook can stay mounted while no machine exists. */
const SILENT_MACHINE: SynthMachine = { id: 'syn-none', name: 'Synth', short: 'synth', hint: '', patch: DEFAULT_PATCH };

export function SynthPage({ bpm, snap, scale, rootHz, machines, takes, onAdd, onEdit, onRemove, onAttack, onRelease, onSaveTake, onPlace }: SynthPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(() => machines[0]?.id ?? null);
  useEffect(() => {
    if (selectedId && !machines.some((machine) => machine.id === selectedId)) setSelectedId(machines[0]?.id ?? null);
  }, [machines, selectedId]);
  const machine = machines.find((item) => item.id === selectedId) ?? null;

  const instrument = machineInstrument(machine ?? SILENT_MACHINE);
  const playing = playingFor(instrument.id);
  const notes = useMemo<PlayNote[]>(
    () => (playing && 'low' in playing ? notesInRange(scale, rootHz, playing.low, playing.high) : []),
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
  const root = describePitch(0, scale, rootHz);

  const choose = (id: string) => {
    if (id === machine?.id) return;
    play.stop();
    play.releaseAll();
    setSelectedId(id);
  };

  const create = (presetId?: string) => {
    play.stop();
    play.releaseAll();
    setSelectedId(onAdd(presetId));
  };

  const remove = async () => {
    if (!machine) return;
    const ok = await confirmDialog({
      title: `Delete ${machine.name}?`,
      message: 'Blocks playing it will play the plain tone instead.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    onRemove(machine.id);
  };

  const ignoreMenu = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className="page instruments-page synth-page">
      <aside className="instrument-catalog" aria-label="Synth machines">
        <h1>Synth</h1>
        <section className="instrument-family">
          <h2>Machines</h2>
          {machines.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`instrument-choice${item.id === machine?.id ? ' is-on' : ''}`}
              aria-pressed={item.id === machine?.id}
              onClick={() => choose(item.id)}
            >
              <span className="dock-swatch" style={swatch} aria-hidden="true" />
              <span className="instrument-choice-name">{item.name}</span>
            </button>
          ))}
          {machines.length === 0 && <p className="muted">No machines yet. Add one from a preset below.</p>}
        </section>
        <section className="instrument-family">
          <h2>New from preset</h2>
          {PRESETS.map((preset) => (
            <button type="button" key={preset.id} className="instrument-choice" onClick={() => create(preset.id)} title={preset.hint}>
              <span className="dock-swatch" style={swatch} aria-hidden="true" />
              <span className="instrument-choice-name">{preset.name}</span>
            </button>
          ))}
        </section>
      </aside>

      <div className="instrument-stage">
        {!machine ? (
          <header className="instrument-intro">
            <div className="instrument-heading">
              <h2>No machine selected</h2>
            </div>
            <p className="muted">
              A synth machine is an instrument you design: a wave through a resonant filter and an envelope. Add one from a
              preset, then play it here and on the canvas — blocks can use it like any instrument.
            </p>
          </header>
        ) : (
          <>
            <header className="instrument-intro">
              <div className="instrument-heading">
                <span className="dock-swatch" style={swatch} aria-hidden="true" />
                <input
                  type="text"
                  aria-label="Machine name"
                  value={machine.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    // The block label follows the name until someone types their own.
                    const followed = machine.short === machine.name.trim().slice(0, 7);
                    onEdit(machine.id, followed ? { name, short: machineShort(name) } : { name });
                  }}
                  onBlur={(e) => !e.target.value.trim() && onEdit(machine.id, { name: 'Synth' })}
                />
              </div>
              <p className="muted">
                {machine.hint || 'A synth machine: a wave through a resonant low-pass and an envelope.'} Root {root.name}
                <sub>{root.octave}</sub>
                {' · '}
                {scale.name}
                {' · '}
                {bpm} BPM.
              </p>
            </header>

            <div className="synth-workbench">
              <div className="synth-patch" aria-label="Patch">
                <div className="field">
                  <span className="field-label">Block label</span>
                  <input
                    type="text"
                    aria-label="Block label"
                    value={machine.short}
                    maxLength={7}
                    placeholder="label"
                    onChange={(e) => onEdit(machine.id, { short: e.target.value })}
                    onBlur={(e) => onEdit(machine.id, { short: e.target.value.trim().slice(0, 7) || machine.name.slice(0, 7) })}
                  />
                </div>
                <SynthPatchFields patch={machine.patch} onChange={(patch) => onEdit(machine.id, { patch: { ...machine.patch, ...patch } })} />
                <div className="row">
                  <button type="button" className="danger" onClick={() => void remove()}>
                    Delete machine
                  </button>
                </div>
              </div>

              <div className="synth-player">
                <div className="instrument-player">
                  {playing && (
                    <div className="instrument-surface" style={swatch}>
                      <InstrumentSurface
                        playing={playing}
                        scale={scale}
                        name={instrument.name}
                        notes={notes}
                        held={play.held}
                        hints={hintsFor(notes, focus, scale, instrument.pitched)}
                        padHeld={play.padHeld}
                        onPointerDown={play.onPointerDown}
                        onPointerEnd={play.onPointerEnd}
                        onContextMenu={ignoreMenu}
                      />
                    </div>
                  )}
                  <p className="muted instrument-keys">{playing ? playingHint(playing) : ''}</p>
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
              </div>
            </div>
          </>
        )}

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
                    <div className="muted">{take.notes.length} {take.notes.length === 1 ? 'note' : 'notes'}</div>
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

function hintsFor(notes: readonly PlayNote[], focus: number, scale: Scale, pitched: boolean): Map<number, string> {
  const out = new Map<number, string>();
  if (!pitched) return out;
  for (const note of notes) {
    const hint = hintFor(note.degree, focus, scale, notes);
    if (hint) out.set(note.degree, hint);
  }
  return out;
}
