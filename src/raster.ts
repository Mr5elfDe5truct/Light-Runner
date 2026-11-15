/**
 * Shapes as pixel masks, and the operations on them: fill, stroke, grow, shrink, combine.
 * Pure (no canvas), so offsets and shape booleans can be tested and run anywhere.
 */
import type { Point } from '../shared/lp2.ts';

export interface Mask {
  data: Uint8Array; // 1 = inside
  width: number;
  height: number;
}

export const emptyMask = (width: number, height: number): Mask => ({ data: new Uint8Array(width * height), width, height });

/** Even-odd fill of closed paths (pixel coordinates; a pixel is inside if its centre is). */
export function fillPaths(mask: Mask, paths: Point[][]): Mask {
  const { width, height, data } = mask;
  const edges: [number, number, number, number][] = [];
  for (const p of paths) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
    }
  }
  const xs: number[] = [];
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= cy && y1 > cy) || (y1 <= cy && y0 > cy)) xs.push(x0 + ((cy - y0) * (x1 - x0)) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) data[y * width + x] ^= 1;
    }
  }
  return mask;
}

/** Draws lines of the given width (pixels) along open paths. */
export function strokePaths(mask: Mask, paths: Point[][], width: number): Mask {
  const r = Math.max(0.5, width / 2);
  const { data } = mask;
  for (const p of paths) {
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i];
      const [bx, by] = p[i + 1];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
      const x1 = Math.min(mask.width - 1, Math.ceil(Math.max(ax, bx) + r));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
      const y1 = Math.min(mask.height - 1, Math.ceil(Math.max(ay, by) + r));
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          const qx = ax + t * dx - px;
          const qy = ay + t * dy - py;
          if (qx * qx + qy * qy <= r * r) data[y * mask.width + x] = 1;
        }
      }
    }
  }
  return mask;
}

/**
 * Exact squared distance (in pixels) from each pixel to the nearest pixel where `target` is true
 * (Felzenszwalb & Huttenlocher's linear-time transform).
 */
function distanceTo(mask: Mask, target: 0 | 1): Float64Array {
  const { width: w, height: h, data } = mask;
  const INF = 1e20;
  const d = new Float64Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = data[i] === target ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const out = new Float64Array(n);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) ** 2 + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) d[y * w + x] = out[x];
  }
  return d;
}

/** Grows (r > 0) or shrinks (r < 0) the inked area by r pixels. */
export function offsetMask(mask: Mask, r: number): Mask {
  const out = emptyMask(mask.width, mask.height);
  if (r >= 0) {
    const d = distanceTo(mask, 1);
    for (let i = 0; i < d.length; i++) out.data[i] = d[i] <= r * r ? 1 : 0;
  } else {
    const d = distanceTo(mask, 0);
    for (let i = 0; i < d.length; i++) out.data[i] = d[i] > r * r ? 1 : 0;
  }
  return out;
}

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

export function combineMasks(masks: Mask[], op: BooleanOp): Mask {
  const out = emptyMask(masks[0].width, masks[0].height);
  out.data.set(masks[0].data);
  for (const m of masks.slice(1)) {
    for (let i = 0; i < out.data.length; i++) {
      const a = out.data[i];
      const b = m.data[i];
      out.data[i] = op === 'union' ? a | b : op === 'subtract' ? a & (b ^ 1) : op === 'intersect' ? a & b : a ^ b;
    }
  }
  return out;
}

export const inkCount = (m: Mask) => m.data.reduce((s, v) => s + v, 0);
