import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { HitVariant } from '../engine/playing';

function Icon({ variant }: { variant: HitVariant }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const shapes: Record<HitVariant, ReactNode> = {
    snare: (
      <>
        <ellipse cx="40" cy="28" rx="22" ry="8" />
        <path d="M18 28 v16 c0 6 10 10 22 10 s22-4 22-10 V28" />
        <path d="M20 36 h40 M22 42 h36" />
      </>
    ),
    hat: (
      <>
        <ellipse cx="40" cy="30" rx="24" ry="7" />
        <ellipse cx="40" cy="38" rx="24" ry="7" />
        <path d="M40 45 v10" />
      </>
    ),
    'open-hat': (
      <>
        <ellipse cx="40" cy="24" rx="24" ry="7" />
        <ellipse cx="40" cy="42" rx="24" ry="7" />
        <path d="M40 49 v8" />
      </>
    ),
    wood: (
      <>
        <rect x="18" y="26" width="44" height="22" rx="3" />
        <path d="M18 34 h44" />
      </>
    ),
    taiko: (
      <>
        <ellipse cx="40" cy="36" rx="26" ry="18" />
        <ellipse cx="40" cy="36" rx="10" ry="7" />
        <path d="M14 28 h-6 M66 28 h6 M14 44 h-6 M66 44 h6" />
      </>
    ),
    'reverse-cymbal': (
      <>
        <path d="M16 44 Q40 18 64 44" />
        <path d="M28 40 h24" />
        <path d="M40 44 v8" />
      </>
    ),
    clap: (
      <>
        <path d="M22 40 c0-14 8-20 12-20 c2 6 2 12 0 18" />
        <path d="M34 22 c6-2 14 2 16 12 c2 8-2 16-8 18" />
        <path d="M46 20 c8 2 12 12 8 22" />
      </>
    ),
    crash: (
      <>
        <ellipse cx="40" cy="34" rx="26" ry="8" />
        <path d="M40 34 l8-16" />
        <path d="M40 42 v10" />
      </>
    ),
    ride: (
      <>
        <ellipse cx="40" cy="34" rx="26" ry="8" />
        <circle cx="40" cy="34" r="3" />
        <path d="M40 42 v10" />
      </>
    ),
    tambourine: (
      <>
        <circle cx="40" cy="36" r="18" />
        <circle cx="28" cy="24" r="3" />
        <circle cx="52" cy="24" r="3" />
        <circle cx="22" cy="40" r="3" />
        <circle cx="58" cy="40" r="3" />
      </>
    ),
    cowbell: (
      <>
        <path d="M28 22 h24 l6 34 H22 Z" />
        <path d="M26 22 h28" />
      </>
    ),
    shaker: (
      <>
        <path d="M34 18 h12 l4 8 v28 l-10 8 l-10-8 V26 Z" />
        <path d="M32 30 h16 M32 38 h16" />
      </>
    ),
    stick: (
      <>
        <path d="M18 50 L58 18" />
        <circle cx="58" cy="18" r="4" />
      </>
    ),
    rain: (
      <>
        <path d="M24 22 c8 10 8 10 0 20 M40 16 c8 10 8 10 0 20 M56 24 c8 10 8 10 0 20" />
      </>
    ),
    fret: (
      <>
        <path d="M16 28 h48 M16 40 h48 M16 52 h48" />
        <path d="M28 20 v40 M52 20 v40" />
      </>
    ),
    breath: (
      <>
        <path d="M20 40 c8-16 32-16 40 0 c-8 6-32 6-40 0" />
        <path d="M30 40 h6 M44 40 h6" />
      </>
    ),
    sea: (
      <>
        <path d="M12 32 c8 8 12 8 18 0 s12-8 18 0 s10 8 18 0" />
        <path d="M12 46 c8 8 12 8 18 0 s12-8 18 0 s10 8 18 0" />
      </>
    ),
    bird: (
      <>
        <path d="M18 40 c10-16 18-16 22 0 c8-14 20-10 22 4 c-12 2-20 8-24 16 c-4-8-12-14-20-20" />
      </>
    ),
    phone: (
      <>
        <path d="M28 18 h16 a6 6 0 0 1 6 6 v28 a6 6 0 0 1-6 6 H28 a6 6 0 0 1-6-6 V24 a6 6 0 0 1 6-6" />
        <path d="M32 50 h16" />
      </>
    ),
    helicopter: (
      <>
        <path d="M16 28 h48" />
        <path d="M40 28 v8" />
        <ellipse cx="40" cy="46" rx="16" ry="8" />
        <path d="M40 46 v10" />
      </>
    ),
    applause: (
      <>
        <path d="M24 46 c0-12 6-18 10-18 c2 8 2 14 0 20" />
        <path d="M34 28 c4-6 12-4 14 6 v16" />
        <path d="M48 24 c6 0 10 8 8 18" />
        <path d="M22 48 c8 10 28 10 36-2" />
      </>
    ),
    gun: (
      <>
        <path d="M18 34 h28 v10 H30 l-4 10 h-8 Z" />
        <path d="M46 36 h16" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" {...common}>
      {shapes[variant]}
    </svg>
  );
}

export function Hit({
  variant,
  name,
  held,
  onPointerDown,
  onPointerEnd,
  onContextMenu,
}: {
  variant: HitVariant;
  name: string;
  held: boolean;
  onPointerDown: (event: ReactPointerEvent, token: string, degree: number) => void;
  onPointerEnd: (event: ReactPointerEvent) => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      className={`hit is-${variant}${held ? ' is-down' : ''}`}
      aria-label={`Play ${name}`}
      aria-pressed={held}
      onContextMenu={onContextMenu}
      onPointerDown={(event) => onPointerDown(event, `p:${event.pointerId}`, 0)}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      <Icon variant={variant} />
      <span>{name}</span>
    </div>
  );
}
