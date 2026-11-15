/** Turns items into LP2 job files: images become runs or rasters, outlines become G-code. */
import * as lp2 from '../shared/lp2.ts';
import type { JobSpec } from '../shared/types.ts';
import { placedPaths, type ImageItem, type Item, type VectorItem } from './model.ts';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image could not be read.'));
      img.src = src;
    });
    imageCache.set(src, p);
  }
  return p;
}

/** The pixel grid an item covers at its resolution. */
export function placement(item: Item): lp2.Placement {
  const ppm = lp2.pixelsPerMm(item.resolution);
  return {
    width: Math.max(1, Math.round(item.w * ppm)),
    height: Math.max(1, Math.round(item.h * ppm)),
    xPx: Math.max(0, Math.floor(item.x * ppm)),
    yPx: Math.max(0, Math.floor(item.y * ppm)),
    resolution: item.resolution,
  };
}

/** Brightness 0 (black) .. 255 (white) per pixel; transparent counts as white. */
async function greyPixels(item: ImageItem, width: number, height: number): Promise<Uint8Array> {
  const img = await loadImage(item.src);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    let v = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    if (item.invert) v = 255 - v;
    out[i] = v;
  }
  return out;
}

/** Floyd-Steinberg: 0 = burn, 255 = skip. */
export function dither(grey: Uint8Array, width: number, height: number): Uint8Array {
  const err = Float32Array.from(grey);
  const out = new Uint8Array(grey.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = err[i] < 128 ? 0 : 255;
      out[i] = v;
      const e = err[i] - v;
      if (x + 1 < width) err[i + 1] += (e * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) err[i + width - 1] += (e * 3) / 16;
        err[i + width] += (e * 5) / 16;
        if (x + 1 < width) err[i + width + 1] += e / 16;
      }
    }
  }
  return out;
}

/** What the laser will make of an image, as 0..255 per pixel (for the on-screen look and the file). */
export async function processImage(item: ImageItem, width: number, height: number): Promise<Uint8Array> {
  const grey = await greyPixels(item, width, height);
  if (item.mode === 'grey') return grey;
  if (item.mode === 'dither') return dither(grey, width, height);
  return grey.map((v) => (v < item.threshold ? 0 : 255));
}

/** A vector filled in (even-odd), as burn / no burn per pixel. */
function fillRows(item: VectorItem, p: lp2.Placement): boolean[][] {
  const ppm = lp2.pixelsPerMm(item.resolution);
  const canvas = new OffscreenCanvas(p.width, p.height);
  const ctx = canvas.getContext('2d')!;
  const path = new Path2D();
  for (const pts of placedPaths(item)) {
    pts.forEach(([x, y], i) => (i ? path.lineTo : path.moveTo).call(path, (x - item.x) * ppm, (y - item.y) * ppm));
    path.closePath();
  }
  ctx.fillStyle = '#000';
  ctx.fill(path, 'evenodd');
  const a = ctx.getImageData(0, 0, p.width, p.height).data;
  return Array.from({ length: p.height }, (_, y) => Array.from({ length: p.width }, (_, x) => a[(y * p.width + x) * 4 + 3] > 127));
}

const toRows = (pixels: Uint8Array, width: number, height: number) =>
  Array.from({ length: height }, (_, y) => Array.from(pixels.subarray(y * width, (y + 1) * width), (v) => v < 128));

/** Builds the upload for one item. */
export async function buildJob(item: Item): Promise<JobSpec> {
  const fileId = lp2.newFileId();
  const name = item.name.replace(/[^\x20-\x7e]/g, '?').slice(0, 28) || 'Untitled';
  let file: Uint8Array;
  let dithered = false;

  if (item.kind === 'vector' && item.mode === 'line') {
    const paths = placedPaths(item);
    file = lp2.gcodeFile(lp2.gcodeForPaths(paths, item.depth), fileId, name);
  } else if (item.kind === 'vector') {
    const p = placement(item);
    file = lp2.runsFile(lp2.runsFromRows(fillRows(item, p)), p, fileId, name);
  } else {
    const p = placement(item);
    const pixels = await processImage(item, p.width, p.height);
    if (item.mode === 'bw') {
      file = lp2.runsFile(lp2.runsFromRows(toRows(pixels, p.width, p.height)), p, fileId, name);
    } else {
      file = lp2.rasterFile(pixels, p, fileId, name);
      dithered = item.mode === 'dither';
    }
  }

  return {
    name: item.name,
    file,
    power: item.power,
    depth: item.depth,
    passes: item.passes,
    xMm: Math.floor(item.x),
    yMm: Math.floor(item.y),
    dithered,
  };
}

/** A small picture of the processed image, for the workspace. */
export async function previewUrl(item: ImageItem): Promise<string> {
  const scale = Math.min(1, 400 / Math.max(item.w, item.h) / lp2.pixelsPerMm(item.resolution));
  const p = placement(item);
  const w = Math.max(1, Math.round(p.width * scale));
  const h = Math.max(1, Math.round(p.height * scale));
  const pixels = await processImage(item, w, h);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(w, h);
  pixels.forEach((v, i) => {
    data.data.set([v, v, v, v === 255 ? 0 : 255], i * 4);
  });
  ctx.putImageData(data, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return URL.createObjectURL(blob);
}
