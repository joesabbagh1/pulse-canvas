import type { XY } from './engine/geometry';

// A closed circle of links is a loop, and its total length is how long one
// trip round takes, which is what you compose with: a 2-beat drum loop against
// a 3¾-beat melody. This finds the loops so the canvas can label them. It's
// geometry only: delays in code aren't counted.
//
// A dense web of links can hold a huge number of loops, so the search stops
// at MAX_LOOPS, at MAX_BLOCKS blocks per loop, and after MAX_STEPS steps.

const MAX_LOOPS = 24;
const MAX_BLOCKS = 32;
const MAX_STEPS = 20_000;

export interface LoopLink {
  source: string;
  target: string;
  beats: number;
}

export interface Loop {
  /** The blocks in order round the loop. */
  blocks: string[];
  beats: number;
  /** Where to label it: the middle of its blocks. */
  at: XY;
}

/** Each loop once, starting from its earliest block in `positions`. */
export function findLoops(positions: ReadonlyMap<string, XY>, links: readonly LoopLink[]): Loop[] {
  const order = new Map([...positions.keys()].map((id, i) => [id, i]));
  const out = new Map<string, LoopLink[]>();
  for (const l of links) {
    if (!order.has(l.source) || !order.has(l.target)) continue;
    const list = out.get(l.source);
    if (list) list.push(l);
    else out.set(l.source, [l]);
  }

  const loops: Loop[] = [];
  let steps = 0;
  for (const [start, first] of order) {
    const path = [start];
    const onPath = new Set(path);
    // Only blocks later than `start` may join, so each loop is found once.
    const walk = (block: string, beats: number) => {
      for (const { target, beats: b } of out.get(block) ?? []) {
        if (++steps > MAX_STEPS || loops.length >= MAX_LOOPS) return;
        if (target === start) {
          loops.push({ blocks: [...path], beats: beats + b, at: middle(path, positions) });
        } else if (order.get(target)! > first && !onPath.has(target) && path.length < MAX_BLOCKS) {
          path.push(target);
          onPath.add(target);
          walk(target, beats + b);
          path.pop();
          onPath.delete(target);
        }
      }
    };
    walk(start, 0);
  }
  return loops;
}

function middle(ids: string[], positions: ReadonlyMap<string, XY>): XY {
  let x = 0;
  let y = 0;
  for (const id of ids) {
    const p = positions.get(id)!;
    x += p.x;
    y += p.y;
  }
  return { x: x / ids.length, y: y / ids.length };
}
