import type { Point, Resolution } from '../shared/lp2.ts';
import type { DitherMethod } from './dither.ts';

/** The work field of the connected machine, in millimetres (the LP2's is 100 x 100). */
export const FIELD = { w: 100, h: 100 };
export const FIELD_MM = 100; // the LP2's

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
  speed?: number; // mm/min, for G-code lasers
  text?: TextSource; // set on text items, so batches can rewrite them
}

/** How a text item was made, so it can be redrawn with new words (batches, serial numbers). */
export interface TextSource {
  template: string;
  style: 'filled' | 'single';
  font: string;
  bold: boolean;
  italic: boolean;
  heightMm: number;
  align: 'left' | 'center' | 'right';
  arc?: { radiusMm: number; bottom: boolean };
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
  ditherMethod: DitherMethod;
  gamma: number; // 0.3..3, 1 = unchanged
  sharpen: number; // 0..100
  removeBackground: boolean;
  backgroundTolerance: number; // 0..100
}

export type Item = VectorItem | ImageItem;

export const newId = () => Math.random().toString(36).slice(2, 10);

export const DEFAULTS = { power: 30, depth: 50, passes: 1, resolution: '1K' as Resolution, rotation: 0, flipX: false, flipY: false };
export const IMAGE_DEFAULTS = { threshold: 128, invert: false, brightness: 0, contrast: 0, ditherMethod: 'floyd' as DitherMethod, gamma: 1, sharpen: 0, removeBackground: false, backgroundTolerance: 25 };

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
  return { w, h, x: (FIELD.w - w) / 2, y: (FIELD.h - h) / 2 };
}
