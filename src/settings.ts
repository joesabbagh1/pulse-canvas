import { createContext, useContext } from 'react';
import { useStore } from '@xyflow/react';
import { DEFAULT_SCALE_ID, ROOT_HZ, SCALES, describePitch, scaleById, type Scale, type Tuning } from './engine/tuning';
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

export function blockColor(kind: BlockKind, degree: number, scale: Scale): string {
  switch (kind) {
    case 'tone':
      return pitchColor(degree, scale, 0, 0);
    case 'pluck':
      return pitchColor(degree, scale, 150, 6);
    case 'bass':
      return pitchColor(degree, scale, 40, -16);
    case 'jawharp':
      return pitchColor(degree, scale, 200, 0);
    case 'khuur':
      return pitchColor(degree, scale, 178, -14);
    case 'kick':
      return '#ff6b4a';
    case 'snare':
      return '#e2b15a';
    case 'hat':
      return '#3ccfc1';
    case 'start':
      return '#f2f2f5';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Each scale gets its own region tint, so regions in the same tuning match. */
export function regionColor(scaleId: string): string {
  let h = 0;
  for (const ch of scaleId) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 66%)`;
}
