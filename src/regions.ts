import type { XY } from './engine/geometry';
import type { CanvasNode, RegionNode } from './piece';

// Region membership is spatial, like everything else on the canvas: a block
// plays in the scale of the region its centre is in, so dragging a block across
// a region's border retunes it, mid-performance if you like.

/** Low enough to stay under links even when React Flow raises it on selection. */
export const REGION_Z = -2000;
export const MIN_REGION = 120;

export function regionRect(r: RegionNode) {
  return {
    x: r.position.x,
    y: r.position.y,
    w: r.width ?? r.measured?.width ?? 0,
    h: r.height ?? r.measured?.height ?? 0,
  };
}

function contains(r: RegionNode, p: XY) {
  const { x, y, w, h } = regionRect(r);
  return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}

/** The region a point is in. Where regions overlap the smallest wins, so a region inside another overrides it. */
export function regionAt(nodes: readonly CanvasNode[], p: XY): RegionNode | undefined {
  let best: RegionNode | undefined;
  let bestArea = Infinity;
  for (const n of nodes) {
    if (n.type !== 'region' || !contains(n, p)) continue;
    const { w, h } = regionRect(n);
    if (w * h < bestArea) {
      best = n;
      bestArea = w * h;
    }
  }
  return best;
}

/** What moves with a region: blocks centred in it, and regions wholly inside it. */
export function regionContents(nodes: readonly CanvasNode[], region: RegionNode): CanvasNode[] {
  const { w, h } = regionRect(region);
  return nodes.filter((n) => {
    if (n.id === region.id) return false;
    if (n.type === 'block') return contains(region, n.position);
    const r = regionRect(n);
    return contains(region, r) && contains(region, { x: r.x + r.w, y: r.y + r.h }) && r.w * r.h < w * h;
  });
}
