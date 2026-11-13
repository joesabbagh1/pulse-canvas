import type { CSSProperties } from 'react';
import { NoteControl, Pitch, pitchT, type SurfaceProps } from './note';

export function Bars({ notes, variant, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { variant: string }) {
  return (
    <div className={`bars is-${variant}`} onContextMenu={onContextMenu} role="group" aria-label="Bars">
      {notes.map((note) => (
        <NoteControl
          key={note.degree}
          note={note}
          held={held.has(note.degree)}
          hint={hints.get(note.degree)}
          className="bar"
          style={{ '--reach': 1 - pitchT(note, notes) } as CSSProperties}
          onPointerDown={onPointerDown}
          onPointerEnd={onPointerEnd}
        />
      ))}
    </div>
  );
}

export function Kalimba({ notes, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps) {
  const placed = notes.map((note, index) => {
    if (index === 0) return { note, slot: 0 };
    const side = index % 2 === 1 ? 1 : -1;
    const step = Math.ceil(index / 2);
    return { note, slot: side * step };
  });
  const min = Math.min(...placed.map((item) => item.slot));
  return (
    <div className="kalimba" onContextMenu={onContextMenu} role="group" aria-label="Kalimba">
      <div className="kalimba-bridge" aria-hidden="true" />
      <div className="kalimba-tines">
        {placed
          .slice()
          .sort((a, b) => a.slot - b.slot)
          .map(({ note, slot }) => (
            <NoteControl
              key={note.degree}
              note={note}
              held={held.has(note.degree)}
              hint={hints.get(note.degree)}
              className="kalimba-tine"
              style={{ '--reach': 1 - pitchT(note, notes), order: slot - min } as CSSProperties}
              onPointerDown={onPointerDown}
              onPointerEnd={onPointerEnd}
            />
          ))}
      </div>
    </div>
  );
}

export function SteelPan({ notes, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps) {
  return (
    <div className="steel-pan" onContextMenu={onContextMenu} role="group" aria-label="Steel drum">
      {notes.map((note, index) => {
        const turns = Math.max(1, notes.length / 8);
        const angle = (index / notes.length) * Math.PI * 2 * turns - Math.PI / 2;
        const radius = 10 + (1 - pitchT(note, notes)) * 36;
        return (
          <NoteControl
            key={note.degree}
            note={note}
            held={held.has(note.degree)}
            hint={hints.get(note.degree)}
            className="pan-note"
            style={{ left: `${50 + Math.cos(angle) * radius}%`, top: `${50 + Math.sin(angle) * radius}%` }}
            onPointerDown={onPointerDown}
            onPointerEnd={onPointerEnd}
          >
            <Pitch note={note} hint={hints.get(note.degree)} />
          </NoteControl>
        );
      })}
    </div>
  );
}

export function Heads({ notes, variant, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { variant: string }) {
  return (
    <div className={`heads is-${variant}`} onContextMenu={onContextMenu} role="group" aria-label="Drums">
      {notes.map((note) => (
        <NoteControl
          key={note.degree}
          note={note}
          held={held.has(note.degree)}
          hint={hints.get(note.degree)}
          className="head"
          style={{ '--reach': 1 - pitchT(note, notes) } as CSSProperties}
          onPointerDown={onPointerDown}
          onPointerEnd={onPointerEnd}
        />
      ))}
    </div>
  );
}

export function Kettles(props: SurfaceProps) {
  return <Heads {...props} variant="kettle" />;
}

export function Stabs({ notes, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps) {
  return (
    <div className="stabs" onContextMenu={onContextMenu} role="group" aria-label="Orchestra hits">
      {notes.map((note) => (
        <NoteControl
          key={note.degree}
          note={note}
          held={held.has(note.degree)}
          hint={hints.get(note.degree)}
          className="stab"
          onPointerDown={onPointerDown}
          onPointerEnd={onPointerEnd}
        />
      ))}
    </div>
  );
}
