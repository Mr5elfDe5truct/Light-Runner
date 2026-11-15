/**
 * Single-line text with the Hershey Roman Simplex font: each letter is a few strokes, so text
 * engraves as fast outlines instead of a filled picture.
 *
 * The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U.S. National
 * Bureau of Standards. The format of the font data was originally created by James Hurt,
 * Cognition, Inc. (font data via the MIT-licensed "hershey" package by Ben Nortier).
 */
import type { Point } from '../shared/lp2.ts';
import * as numbersModule from 'hershey/lib/characterNumbers.js';
import * as fontModule from 'hershey/lib/rowmans.js';

// The package is CommonJS with a default export; unwrap it however the bundler hands it over.
const unwrap = <T>(m: unknown): T => {
  let v = m as { default?: unknown };
  while (v && typeof v === 'object' && 'default' in v) v = v.default as { default?: unknown };
  return v as T;
};

interface Glyph {
  left: number;
  right: number;
  strokes: Point[][];
}

let glyphs: Map<number, Glyph> | null = null;

function font(): Map<number, Glyph> {
  if (glyphs) return glyphs;
  const text = atob(unwrap<string>(fontModule));
  glyphs = new Map();
  const R = 'R'.charCodeAt(0);
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const number = parseInt(line.slice(0, 5), 10);
    const vertices = parseInt(line.slice(5, 8), 10) - 1;
    const left = line.charCodeAt(8) - R;
    const right = line.charCodeAt(9) - R;
    const strokes: Point[][] = [[]];
    for (let i = 0; i < vertices; i++) {
      const x = line.charCodeAt(10 + i * 2) - R;
      const y = line.charCodeAt(11 + i * 2) - R;
      if (x === -50 && y === 0) strokes.push([]);
      else strokes[strokes.length - 1].push([x, y]);
    }
    glyphs.set(number, { left, right, strokes: strokes.filter((s) => s.length > 1) });
  }
  return glyphs;
}

const LINE_HEIGHT = 32; // font units between lines
const CAP_HEIGHT = 21; // font units from the top of a capital to the baseline

/**
 * Text bent around a circle of `radiusMm` (to the baseline), centred at the top and reading
 * clockwise, or along the bottom reading anticlockwise when `bottom` is set (so it stays upright).
 */
export function hersheyArc(text: string, capHeightMm: number, radiusMm: number, bottom = false): { paths: Point[][]; width: number; height: number } {
  const straight = hersheyText(text.replace(/\r?\n/g, ' '), capHeightMm);
  if (!straight.paths.length) return straight;
  const mid = straight.width / 2;
  const baseline = straight.height; // the text box's bottom edge
  const bent = straight.paths.map((s) =>
    s.map(([x, y]) => {
      const a = (x - mid) / radiusMm;
      const r = bottom ? radiusMm + y : radiusMm + (baseline - y);
      const theta = bottom ? Math.PI / 2 - a : -Math.PI / 2 + a;
      return [r * Math.cos(theta), r * Math.sin(theta)] as Point;
    }),
  );
  const all = bent.flat();
  const x0 = Math.min(...all.map((p) => p[0]));
  const y0 = Math.min(...all.map((p) => p[1]));
  return {
    paths: bent.map((s) => s.map(([x, y]) => [x - x0, y - y0] as Point)),
    width: Math.max(...all.map((p) => p[0])) - x0,
    height: Math.max(...all.map((p) => p[1])) - y0,
  };
}

/** The characters this font can draw. */
export function supported(ch: string): boolean {
  return ch in unwrap<Record<string, number>>(numbersModule);
}

/**
 * Text as strokes, in millimetres for the given capital-letter height. Lines are left-aligned,
 * centred or right-aligned. Characters the font lacks are left as spaces.
 */
export function hersheyText(text: string, capHeightMm: number, align: 'left' | 'center' | 'right' = 'left'): { paths: Point[][]; width: number; height: number } {
  const numbers = unwrap<Record<string, number>>(numbersModule);
  const f = font();
  const space = f.get(numbers[' '])!;
  const lines = text.split(/\r?\n/);
  const laid: { strokes: Point[][]; width: number }[] = lines.map((line) => {
    let x = 0;
    const strokes: Point[][] = [];
    for (const ch of line) {
      const g = f.get(numbers[ch]) ?? space;
      for (const s of g.strokes) strokes.push(s.map(([px, py]) => [x - g.left + px, py] as Point));
      x += g.right - g.left;
    }
    return { strokes, width: x };
  });
  const widest = Math.max(1, ...laid.map((l) => l.width));
  const scale = capHeightMm / CAP_HEIGHT;
  const paths: Point[][] = [];
  laid.forEach((l, i) => {
    const shift = align === 'center' ? (widest - l.width) / 2 : align === 'right' ? widest - l.width : 0;
    for (const s of l.strokes) paths.push(s.map(([x, y]) => [(x + shift) * scale, (y + 12 + i * LINE_HEIGHT) * scale] as Point));
  });
  // Trim to the ink, so the box fits the text.
  const all = paths.flat();
  if (!all.length) return { paths: [], width: 0, height: 0 };
  const x0 = Math.min(...all.map((p) => p[0]));
  const y0 = Math.min(...all.map((p) => p[1]));
  const x1 = Math.max(...all.map((p) => p[0]));
  const y1 = Math.max(...all.map((p) => p[1]));
  return { paths: paths.map((s) => s.map(([x, y]) => [x - x0, y - y0] as Point)), width: Math.max(0.1, x1 - x0), height: Math.max(0.1, y1 - y0) };
}
