import { ViewportPortal } from '@xyflow/react';
import { BLOCK_R, formatBeats, type XY } from '../engine/geometry';
import type { Loop } from '../loops';
import { useSettings } from '../settings';

// A label is nudged down until it clears every block (a loop laid out in a
// line has its middle on a block) and every label already placed (a loop and
// its reverse share a middle).
const NUDGE = 22;
const clear = (at: XY, p: XY, dx: number, dy: number) => Math.abs(p.x - at.x) >= dx || Math.abs(p.y - at.y) >= dy;

/** Each loop's length, written in the middle of it. */
export function LoopLabels({ loops, blocks }: { loops: Loop[]; blocks: XY[] }) {
  const { snap } = useSettings();
  const placed: XY[] = [];
  return (
    <ViewportPortal>
      {loops.map((loop) => {
        const at = { ...loop.at };
        while (
          !blocks.every((b) => clear(at, b, BLOCK_R + 24, BLOCK_R + 10)) ||
          !placed.every((p) => clear(at, p, 40, NUDGE))
        ) {
          at.y += NUDGE / 2;
        }
        placed.push(at);
        return (
          <div
            key={loop.blocks.join('>')}
            className="loop-label"
            style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)` }}
          >
            ↻ {formatBeats(loop.beats, snap)}
          </div>
        );
      })}
    </ViewportPortal>
  );
}
