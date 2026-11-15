import type { Point, Resolution } from '../shared/lp2.ts';

/** The LP2's work field, in millimetres. */
export const FIELD_MM = 100;

export type ImageMode = 'bw' | 'dither' | 'grey' | 'sketch';
export type VectorMode = 'line' | 'fill';

interface Common {
  id: string;
  name: string;
  visible: boolean;
  x: number; // top-left corner of the unrotated box, mm
  y: number;
  w: number; // size, mm
  h: number;
  rotation: number; // degrees, clockwise, about the box centre
  flipX: boolean;
  flipY: boolean;
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
  brightness: number; // -100..100
  contrast: number; // -100..100
}

export type Item = VectorItem | ImageItem;

export const newId = () => Math.random().toString(36).slice(2, 10);

export const DEFAULTS = { power: 30, depth: 50, passes: 1, resolution: '1K' as Resolution, rotation: 0, flipX: false, flipY: false };
export const IMAGE_DEFAULTS = { threshold: 128, invert: false, brightness: 0, contrast: 0 };

/** Fills in fields added after a project was saved. */
export function normalizeItem(raw: Item): Item {
  const base = { ...DEFAULTS, ...raw };
  return base.kind === 'image' ? ({ ...IMAGE_DEFAULTS, ...base } as ImageItem) : (base as VectorItem);
}

/** Places an item of the given natural size in the middle of the field, shrinking it to fit. */
export function fitToField(naturalW: number, naturalH: number, maxMm = 40) {
  const scale = Math.min(1, maxMm / Math.max(naturalW, naturalH));
  const w = naturalW * scale;
  const h = naturalH * scale;
  return { w, h, x: (FIELD_MM - w) / 2, y: (FIELD_MM - h) / 2 };
}
