import { createContext, useContext } from 'react';
import { useStore } from '@xyflow/react';
import { DEFAULT_SCALE_ID, ROOT_HZ, SCALES, describePitch, scaleById, type Scale, type Tuning } from './engine/tuning';
import { CATEGORIES, instrumentById } from './engine/instruments';
import type { BlockKind } from './engine/scheduler';
import { regionTuning, type CanvasNode } from './piece';
import { regionAt } from './regions';

/** `canvas` is the tuning outside every region. */
export const SettingsContext = createContext<{ canvas: Tuning; scales: readonly Scale[]; snap: boolean }>({
  canvas: { scale: scaleById(DEFAULT_SCALE_ID), rootHz: ROOT_HZ },
  scales: SCALES,
  snap: true,
});

export const useSettings = () => useContext(SettingsContext);

/** The tuning a block plays in, which changes as it moves between regions. */
export function useBlockTuning(id: string): Tuning {
  const { canvas, scales } = useSettings();
  // The region node itself only changes identity when that region is edited.
  const region = useStore((s) => {
    const self = s.nodeLookup.get(id);
    return self && regionAt(s.nodes as CanvasNode[], self.position);
  });
  return regionTuning(region, canvas, scales);
}

/** Pitched blocks are coloured by pitch class, lighter as they go up in octave. */
function pitchColor(degree: number, scale: Scale, hueShift: number, lightShift: number) {
  const pitch = describePitch(degree, scale);
  const hue = (((200 + pitch.pitchClass * 300 + hueShift) % 360) + 360) % 360;
  const light = Math.min(82, Math.max(36, 64 + (pitch.octave - 4) * 9 + lightShift));
  return `hsl(${hue} 75% ${light}%)`;
}

// The original eight keep the colours the demo was drawn with. Everything else
// takes its family hue and, when it has a pitch, lightens as it goes up.
const LEGACY_SHIFT: Partial<Record<string, [number, number]>> = {
  tone: [0, 0],
  pluck: [150, 6],
  bass: [40, -16],
  jawharp: [200, 0],
  khuur: [178, -14],
};
const LEGACY_FLAT: Partial<Record<string, string>> = {
  kick: '#ff6b4a',
  snare: '#e2b15a',
  hat: '#3ccfc1',
  start: 'var(--ink)',
};

export function blockColor(kind: BlockKind, degree: number, scale: Scale): string {
  const flat = LEGACY_FLAT[kind];
  if (flat) return flat;
  const shift = LEGACY_SHIFT[kind];
  if (shift) return pitchColor(degree, scale, shift[0], shift[1]);
  const inst = instrumentById(kind);
  const hue = CATEGORIES.find((c) => c.id === inst?.category)?.hue ?? 200;
  if (!inst?.pitched) return `hsl(${hue} 55% 58%)`;
  return pitchColor(degree, scale, hue - 200, 0);
}

/** Each scale gets its own region tint, so regions in the same tuning match. */
export function regionColor(scaleId: string): string {
  let h = 0;
  for (const ch of scaleId) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 66%)`;
}
