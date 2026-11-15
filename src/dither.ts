/** Dithering: turning shades into burn/no-burn dots. Pure. 0 = burn, 255 = skip. */

export type DitherMethod = 'floyd' | 'atkinson' | 'jarvis' | 'stucki' | 'burkes' | 'ordered';

export const DITHER_LABEL: Record<DitherMethod, string> = {
  floyd: 'Floyd–Steinberg (balanced)',
  atkinson: 'Atkinson (crisp, lighter)',
  jarvis: 'Jarvis (smooth)',
  stucki: 'Stucki (smooth, sharp)',
  burkes: 'Burkes (fast, smooth)',
  ordered: 'Halftone (ordered pattern)',
};

// [dx, dy, weight] for each error-diffusion method, with the divisor.
const KERNELS: Record<Exclude<DitherMethod, 'ordered'>, { div: number; taps: [number, number, number][] }> = {
  floyd: { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  // Atkinson spreads only 6/8 of the error, which keeps highlights and shadows clean.
  atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jarvis: { div: 48, taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
  stucki: { div: 42, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
  burkes: { div: 32, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
};

const BAYER8 = (() => {
  const m = [[0]];
  let size = 1;
  let cur = m;
  while (size < 8) {
    const next: number[][] = Array.from({ length: size * 2 }, () => new Array(size * 2).fill(0));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = cur[y][x] * 4;
        next[y][x] = v;
        next[y][x + size] = v + 2;
        next[y + size][x] = v + 3;
        next[y + size][x + size] = v + 1;
      }
    cur = next;
    size *= 2;
  }
  return cur;
})();

export function ditherWith(grey: Uint8Array, width: number, height: number, method: DitherMethod = 'floyd'): Uint8Array {
  const out = new Uint8Array(grey.length);
  if (method === 'ordered') {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const t = ((BAYER8[y % 8][x % 8] + 0.5) / 64) * 255;
        out[y * width + x] = grey[y * width + x] < t ? 0 : 255;
      }
    return out;
  }
  const { div, taps } = KERNELS[method];
  const err = Float32Array.from(grey);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = err[i] < 128 ? 0 : 255;
      out[i] = v;
      const e = (err[i] - v) / div;
      for (const [dx, dy, wgt] of taps) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) err[ny * width + nx] += e * wgt;
      }
    }
  }
  return out;
}

/** Gamma (1 = unchanged; above 1 lightens the midtones). */
export function gammaAdjust(grey: Uint8Array, gamma: number): Uint8Array {
  if (gamma === 1) return grey;
  const table = Array.from({ length: 256 }, (_, v) => Math.round(255 * Math.pow(v / 255, 1 / gamma)));
  return grey.map((v) => table[v]);
}

/** Unsharp mask: adds back the difference from a small blur. amount 0..100. */
export function sharpen(grey: Uint8Array, width: number, height: number, amount: number): Uint8Array {
  if (!amount) return grey;
  const k = amount / 50;
  const out = new Uint8Array(grey.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < width && yy < height) {
            sum += grey[yy * width + xx];
            n++;
          }
        }
      const i = y * width + x;
      const v = grey[i] + k * (grey[i] - sum / n);
      out[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  return out;
}

/**
 * Makes the background white: floods in from the edges over pixels within `tolerance` of the
 * edge's typical shade, so a subject on a plain backdrop stands alone.
 */
export function removeBackground(grey: Uint8Array, width: number, height: number, tolerance: number): Uint8Array {
  const out = Uint8Array.from(grey);
  const border: number[] = [];
  for (let x = 0; x < width; x++) border.push(grey[x], grey[(height - 1) * width + x]);
  for (let y = 0; y < height; y++) border.push(grey[y * width], grey[y * width + width - 1]);
  border.sort((a, b) => a - b);
  const bg = border[Math.floor(border.length / 2)];
  const seen = new Uint8Array(grey.length);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!seen[i] && Math.abs(grey[i] - bg) <= tolerance) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    out[i] = 255;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  return out;
}
