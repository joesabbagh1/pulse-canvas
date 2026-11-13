import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { PlayNote } from '../engine/playing';

export interface SurfaceProps {
  notes: readonly PlayNote[];
  held: ReadonlySet<number>;
  hints: ReadonlyMap<number, string>;
  onPointerDown: (event: ReactPointerEvent, token: string, degree: number) => void;
  onPointerEnd: (event: ReactPointerEvent) => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
}

export function pitchText(note: PlayNote): string {
  const cents = note.offset === 0 ? '' : note.offset > 0 ? ` +${note.offset}` : ` ${note.offset}`;
  return `${note.name}${note.octave}${cents}`;
}

export function Pitch({ note, hint }: { note: PlayNote; hint?: string }) {
  return (
    <span className="pitch">
      <span className="pitch-name">
        {note.name}
        <sub>{note.octave}</sub>
      </span>
      {hint && <span className="pitch-hint">{hint}</span>}
    </span>
  );
}

export function NoteControl({
  note,
  held,
  hint,
  className,
  style,
  children,
  onPointerDown,
  onPointerEnd,
}: {
  note: PlayNote;
  held: boolean;
  hint?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onPointerDown: SurfaceProps['onPointerDown'];
  onPointerEnd: SurfaceProps['onPointerEnd'];
}) {
  const label = pitchText(note);
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`${label}${hint ? `, key ${hint}` : ''}`}
      aria-pressed={held}
      title={`${label} · degree ${note.degree}${hint ? ` · ${hint}` : ''}`}
      className={`note-control${className ? ` ${className}` : ''}${held ? ' is-down' : ''}${hint ? ' is-hint' : ''}`}
      style={style}
      onPointerDown={(event) => onPointerDown(event, `d:${note.degree}`, note.degree)}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      {children ?? <Pitch note={note} hint={hint} />}
    </div>
  );
}

/** 0 is the lowest note, 1 is the highest. */
export function pitchT(note: PlayNote, notes: readonly PlayNote[]): number {
  if (notes.length < 2) return 0.5;
  const low = notes[0].hz;
  const high = notes[notes.length - 1].hz;
  if (!(high > low) || !(note.hz > 0)) return 0.5;
  return Math.min(1, Math.max(0, Math.log(note.hz / low) / Math.log(high / low)));
}
