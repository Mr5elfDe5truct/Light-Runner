import type { Point, Resolution } from '../shared/lp2.ts';

/** The LP2's work field, in millimetres. */
export const FIELD_MM = 100;

export type ImageMode = 'bw' | 'dither' | 'grey';
export type VectorMode = 'line' | 'fill';

interface Common {
  id: string;
  name: string;
  visible: boolean;
  x: number; // top-left corner, mm
  y: number;
  w: number; // size, mm
  h: number;
  power: number;
  depth: number;
  passes: number;
  resolution: Resolution; // for anything engraved as pixels
  material?: string;
}

export interface VectorItem extends Common {
  kind: 'vector';
  mode: VectorMode;
  paths: Point[][]; // in the item's own units, 0..naturalW x 0..naturalH
  naturalW: number;
  naturalH: number;
}

export interface ImageItem extends Common {
  kind: 'image';
  mode: ImageMode;
  src: string; // data URL of the original image
  threshold: number; // 0..255, for black and white
  invert: boolean;
}

export type Item = VectorItem | ImageItem;

export const newId = () => Math.random().toString(36).slice(2, 10);

export const DEFAULTS = { power: 30, depth: 50, passes: 1, resolution: '1K' as Resolution };

/** Places an item of the given natural size in the middle of the field, shrinking it to fit. */
export function fitToField(naturalW: number, naturalH: number, maxMm = 40) {
  const scale = Math.min(1, maxMm / Math.max(naturalW, naturalH));
  const w = naturalW * scale;
  const h = naturalH * scale;
  return { w, h, x: (FIELD_MM - w) / 2, y: (FIELD_MM - h) / 2 };
}

/** An item's paths in field millimetres. */
export function placedPaths(item: VectorItem): Point[][] {
  const sx = item.w / item.naturalW;
  const sy = item.h / item.naturalH;
  return item.paths.map((p) => p.map(([u, v]) => [item.x + u * sx, item.y + v * sy] as Point));
}

export function boundsOf(items: Item[]) {
  if (!items.length) return null;
  const x0 = Math.min(...items.map((i) => i.x));
  const y0 = Math.min(...items.map((i) => i.y));
  const x1 = Math.max(...items.map((i) => i.x + i.w));
  const y1 = Math.max(...items.map((i) => i.y + i.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const insideField = (i: Item) => i.x >= 0 && i.y >= 0 && i.x + i.w <= FIELD_MM + 1e-6 && i.y + i.h <= FIELD_MM + 1e-6;
