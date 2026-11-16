/** Placing items on the field: rotation, flips, bounds. Pure functions. */
import { extent, type Point } from '../shared/lp2.ts';
import { FIELD, type Item, type VectorItem } from './model.ts';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Maps a point inside the item's own box (0..w, 0..h, in mm) onto the field. */
export function toField(item: Item): (u: number, v: number) => Point {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return (u, v) => {
    let px = u - item.w / 2;
    let py = v - item.h / 2;
    if (item.flipX) px = -px;
    if (item.flipY) py = -py;
    return [cx + px * cos - py * sin, cy + px * sin + py * cos];
  };
}

/** The axis-aligned box the item covers on the field once rotated. */
export function itemBounds(item: Item): Box {
  if (!item.rotation) return { x: item.x, y: item.y, w: item.w, h: item.h };
  const t = toField(item);
  const corners = [t(0, 0), t(item.w, 0), t(item.w, item.h), t(0, item.h)];
  return boundsOfPoints(corners);
}

export function boundsOfPoints(points: Point[]): Box {
  const e = extent(points);
  return { x: e.x0, y: e.y0, w: e.x1 - e.x0, h: e.y1 - e.y0 };
}

/** An outline's paths in field millimetres, with size, flips and rotation applied. */
export function placedPaths(item: VectorItem): Point[][] {
  const sx = item.w / item.naturalW;
  const sy = item.h / item.naturalH;
  const t = toField(item);
  return item.paths.map((p) => p.map(([u, v]) => t(u * sx, v * sy)));
}

export function boundsOf(items: Item[]): Box | null {
  if (!items.length) return null;
  const boxes = items.map(itemBounds);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function insideField(item: Item): boolean {
  const b = itemBounds(item);
  const e = 1e-6;
  return b.x >= -e && b.y >= -e && b.x + b.w <= FIELD.w + e && b.y + b.h <= FIELD.h + e;
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Moves an item so its (rotated) bounds line up with the field. */
export function alignToField(item: Item, how: Align): { x: number; y: number } {
  const b = itemBounds(item);
  const dx = { left: -b.x, hcenter: (FIELD.w - b.w) / 2 - b.x, right: FIELD.w - b.w - b.x } as Record<string, number>;
  const dy = { top: -b.y, vcenter: (FIELD.h - b.h) / 2 - b.y, bottom: FIELD.h - b.h - b.y } as Record<string, number>;
  return { x: item.x + (dx[how] ?? 0), y: item.y + (dy[how] ?? 0) };
}

/** Moves a group together so its combined bounds line up with the field. */
export function alignGroupToField(items: Item[], how: Align): Map<string, { x: number; y: number }> {
  const b = boundsOf(items);
  const out = new Map<string, { x: number; y: number }>();
  if (!b) return out;
  const dx = { left: -b.x, hcenter: (FIELD.w - b.w) / 2 - b.x, right: FIELD.w - b.w - b.x }[how as 'left'] ?? 0;
  const dy = { top: -b.y, vcenter: (FIELD.h - b.h) / 2 - b.y, bottom: FIELD.h - b.h - b.y }[how as 'top'] ?? 0;
  for (const i of items) out.set(i.id, { x: i.x + dx, y: i.y + dy });
  return out;
}

/** Douglas-Peucker: keeps the points needed to stay within `tol` of the original line. */
export function simplifyPath(points: Point[], tol: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
