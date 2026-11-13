import type { CSSProperties } from 'react';
import type { PlayNote } from '../engine/playing';
import { NoteControl, Pitch, pitchT, type SurfaceProps } from './note';

function Hole({ note, notes, held, hints, onPointerDown, onPointerEnd }: SurfaceProps & { note: PlayNote }) {
  return (
    <NoteControl
      note={note}
      held={held.has(note.degree)}
      hint={hints.get(note.degree)}
      className="wind-hole"
      style={{ '--reach': pitchT(note, notes) } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerEnd={onPointerEnd}
    >
      <Pitch note={note} hint={hints.get(note.degree)} />
    </NoteControl>
  );
}

export function Pipes({ notes, variant, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { variant: 'pan' | 'calliope' | 'bottle' }) {
  return (
    <div className={`pipes is-${variant}`} onContextMenu={onContextMenu} role="group" aria-label={variant === 'bottle' ? 'Bottles' : 'Pipes'}>
      {notes.map((note) => (
        <NoteControl
          key={note.degree}
          note={note}
          held={held.has(note.degree)}
          hint={hints.get(note.degree)}
          className="pipe"
          style={{ '--reach': 1 - pitchT(note, notes) } as CSSProperties}
          onPointerDown={onPointerDown}
          onPointerEnd={onPointerEnd}
        />
      ))}
    </div>
  );
}

export function Tongue({ notes, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps) {
  return (
    <div className="tongue" onContextMenu={onContextMenu} role="group" aria-label="Jaw harp">
      <div className="tongue-frame" aria-hidden="true" />
      <div className="tongue-blade">
        {notes.map((note) => (
          <NoteControl
            key={note.degree}
            note={note}
            held={held.has(note.degree)}
            hint={hints.get(note.degree)}
            className="tongue-note"
            onPointerDown={onPointerDown}
            onPointerEnd={onPointerEnd}
          />
        ))}
      </div>
    </div>
  );
}

export function WindBody({ notes, variant, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { variant: string }) {
  const play = { notes, held, hints, onPointerDown, onPointerEnd, onContextMenu };
  if (variant === 'harmonica') {
    const blow = notes.filter((_, index) => index % 2 === 0);
    const draw = notes.filter((_, index) => index % 2 === 1);
    return (
      <div className="wind is-harmonica" onContextMenu={onContextMenu} role="group" aria-label="Harmonica">
        <div className="harm-row">
          <span className="harm-label">Draw</span>
          {draw.map((note) => (
            <Hole key={note.degree} note={note} {...play} />
          ))}
        </div>
        <div className="harm-row">
          <span className="harm-label">Blow</span>
          {blow.map((note) => (
            <Hole key={note.degree} note={note} {...play} />
          ))}
        </div>
      </div>
    );
  }
  const upright = variant !== 'flute' && variant !== 'piccolo';
  return (
    <div className={`wind is-${variant}${upright ? ' is-upright' : ''}`} onContextMenu={onContextMenu} role="group" aria-label="Wind instrument">
      {variant === 'bagpipe' && (
        <div className="bag-drones" aria-hidden="true">
          <span />
          <span />
        </div>
      )}
      <div className="wind-body">
        <span className="wind-bell" aria-hidden="true" />
        <div className="wind-holes">
          {notes.map((note) => (
            <Hole key={note.degree} note={note} {...play} />
          ))}
        </div>
      </div>
    </div>
  );
}
