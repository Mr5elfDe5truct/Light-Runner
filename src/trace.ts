/**
 * Turns a black-and-white image into outlines (marching squares), so a picture can be engraved as
 * lines. Pure: works on a mask, no canvas needed.
 */
import type { Point } from '../shared/lp2.ts';
import { simplifyPath } from './geometry.ts';

/**
 * Outlines of the inked areas of `mask` (1 = ink), in pixel units where pixel (i, j) spans
 * i..i+1, j..j+1. Each outline is closed (its last point repeats the first).
 */
export function traceContours(mask: Uint8Array, width: number, height: number, tolerance = 0.6): Point[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? mask[y * width + x] : 0);
  const segments: [Point, Point][] = [];
  // Corner samples sit at pixel centres; a cell spans four of them.
  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;
      const cx = x + 1; // the cell's centre, in pixel-edge coordinates
      const cy = y + 1;
      const top: Point = [cx, cy - 0.5];
      const right: Point = [cx + 0.5, cy];
      const bottom: Point = [cx, cy + 0.5];
      const left: Point = [cx - 0.5, cy];
      const add = (a: Point, b: Point) => segments.push([a, b]);
      switch (c) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 5: add(left, top); add(bottom, right); break;
        case 10: add(top, right); add(left, bottom); break;
      }
    }
  }
  return chain(segments).map((loop) => simplifyClosed(loop, tolerance));
}

const key = (p: Point) => `${p[0]},${p[1]}`;

/** Joins segments that share end points into polylines. */
function chain(segments: [Point, Point][]): Point[][] {
  const byPoint = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      const list = byPoint.get(k);
      if (list) list.push(i);
      else byPoint.set(k, [i]);
    }
  });
  const used = new Uint8Array(segments.length);
  const lines: Point[][] = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const line: Point[] = [segments[s][0], segments[s][1]];
    // Walk forward from the end until nothing joins.
    for (;;) {
      const end = line[line.length - 1];
      const next = (byPoint.get(key(end)) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segments[next];
      line.push(key(a) === key(end) ? b : a);
    }
    lines.push(line);
  }
  return lines;
}

function simplifyClosed(loop: Point[], tol: number): Point[] {
  const closed = key(loop[0]) === key(loop[loop.length - 1]);
  if (!closed || loop.length < 5) return loop;
  // Split at the far point so both halves simplify well, then rejoin.
  const [x0, y0] = loop[0];
  let far = 0;
  let best = -1;
  loop.forEach(([x, y], i) => {
    const d = (x - x0) ** 2 + (y - y0) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  });
  const a = simplifyPath(loop.slice(0, far + 1), tol);
  const b = simplifyPath(loop.slice(far), tol);
  return [...a, ...b.slice(1)];
}
