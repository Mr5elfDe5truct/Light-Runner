/**
 * Camera placement: a photo of the work area, straightened onto the 100 x 100 mm field using the
 * four corners of the frame the laser traces. The maths here is pure; capture lives in the UI.
 */
import type { Point } from '../shared/lp2.ts';

export type Homography = number[]; // 3x3, row-major, h[8] = 1

/** Solves the 8 x 8 system for the projective map taking src[i] to dst[i]. */
export function homography(src: Point[], dst: Point[]): Homography {
  if (src.length !== 4 || dst.length !== 4) throw new Error('Four corners are needed.');
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) throw new Error('Those corners are in a line; click the four corners of the frame.');
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * h[k];
    h[r] = s / A[r][r];
  }
  return [...h, 1];
}

export function project(h: Homography, [x, y]: Point): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export const FIELD_CORNERS: Point[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

/**
 * Straightens a photo: `pixels` is RGBA (width x height); `corners` are where the field's corners
 * (top-left, top-right, bottom-right, bottom-left) appear in it. Returns an RGBA image of the field,
 * `size` pixels square.
 */
export function straighten(pixels: Uint8ClampedArray, width: number, height: number, corners: Point[], size: number): Uint8ClampedArray<ArrayBuffer> {
  const toPhoto = homography(
    FIELD_CORNERS.map(([x, y]) => [(x / 100) * size, (y / 100) * size] as Point),
    corners,
  );
  const out = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [sx, sy] = project(toPhoto, [x + 0.5, y + 0.5]);
      const o = (y * size + x) * 4;
      // Bilinear sampling.
      const x0 = Math.floor(sx - 0.5);
      const y0 = Math.floor(sy - 0.5);
      const fx = sx - 0.5 - x0;
      const fy = sy - 0.5 - y0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) {
        out[o + 3] = 0;
        continue;
      }
      for (let c = 0; c < 4; c++) {
        const p00 = pixels[(y0 * width + x0) * 4 + c];
        const p10 = pixels[(y0 * width + x0 + 1) * 4 + c];
        const p01 = pixels[((y0 + 1) * width + x0) * 4 + c];
        const p11 = pixels[((y0 + 1) * width + x0 + 1) * 4 + c];
        out[o + c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
      }
    }
  }
  return out;
}
