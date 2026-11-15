/** Turns items into LP2 job files: images become runs or rasters, outlines become G-code. */
import * as lp2 from '../shared/lp2.ts';
import type { JobSpec } from '../shared/types.ts';
import { itemBounds, placedPaths, type Box } from './geometry.ts';
import { newId, type ImageItem, type Item, type VectorItem } from './model.ts';
import { traceContours } from './trace.ts';

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

/** The pixel grid a box covers at a resolution. */
export function placementOf(box: Box, resolution: lp2.Resolution): lp2.Placement {
  const ppm = lp2.pixelsPerMm(resolution);
  return {
    width: Math.max(1, Math.round(box.w * ppm)),
    height: Math.max(1, Math.round(box.h * ppm)),
    xPx: Math.max(0, Math.floor(box.x * ppm)),
    yPx: Math.max(0, Math.floor(box.y * ppm)),
    resolution,
  };
}

/**
 * Brightness 0 (black) .. 255 (white) per pixel; transparent counts as white.
 * With `placed`, the image is drawn rotated and flipped into its bounds on the field.
 */
async function greyPixels(item: ImageItem, width: number, height: number, placed: boolean): Promise<Uint8Array> {
  const img = await loadImage(item.src);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  if (placed) {
    const b = itemBounds(item);
    const sx = width / b.w;
    const sy = height / b.h;
    ctx.translate((item.x + item.w / 2 - b.x) * sx, (item.y + item.h / 2 - b.y) * sy);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.scale(item.flipX ? -1 : 1, item.flipY ? -1 : 1);
    ctx.drawImage(img, (-item.w / 2) * sx, (-item.h / 2) * sy, item.w * sx, item.h * sy);
  } else {
    ctx.drawImage(img, 0, 0, width, height);
  }
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);
  // Contrast as in common photo editors; brightness shifts the level.
  const c = (item.contrast ?? 0) * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const shift = (item.brightness ?? 0) * 2.55;
  for (let i = 0; i < out.length; i++) {
    let v = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    v = factor * (v - 128) + 128 + shift;
    if (item.invert) v = 255 - v;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
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

/** A box blur, run twice (close to a Gaussian). */
function blur(src: Uint8Array, width: number, height: number, r: number): Float32Array {
  let a = Float32Array.from(src);
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * width + Math.min(width - 1, Math.max(0, x))];
      for (let x = 0; x < width; x++) {
        b[y * width + x] = sum / (2 * r + 1);
        sum += a[y * width + Math.min(width - 1, x + r + 1)] - a[y * width + Math.max(0, x - r)];
      }
    }
    const c = new Float32Array(a.length);
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(height - 1, Math.max(0, y)) * width + x];
      for (let y = 0; y < height; y++) {
        c[y * width + x] = sum / (2 * r + 1);
        sum += b[Math.min(height - 1, y + r + 1) * width + x] - b[Math.max(0, y - r) * width + x];
      }
    }
    a = c;
  }
  return a;
}

/** A pencil-sketch look: the picture divided by a blurred negative of itself (colour dodge). */
export function sketch(grey: Uint8Array, width: number, height: number): Uint8Array {
  const r = Math.max(1, Math.round(Math.min(width, height) / 60));
  const inv = grey.map((v) => 255 - v);
  const soft = blur(inv, width, height, r);
  return grey.map((v, i) => {
    const d = 255 - soft[i];
    return d <= 0 ? 255 : Math.min(255, Math.round((v * 255) / d));
  });
}

/** What the laser will make of an image, as 0..255 per pixel. */
export async function processImage(item: ImageItem, width: number, height: number, placed = false): Promise<Uint8Array> {
  const grey = await greyPixels(item, width, height, placed);
  if (item.mode === 'grey') return grey;
  if (item.mode === 'dither') return dither(grey, width, height);
  if (item.mode === 'sketch') return dither(sketch(grey, width, height), width, height);
  return grey.map((v) => (v < item.threshold ? 0 : 255));
}

/** Outlines filled in (even-odd), as burn / no burn per pixel. */
function fillRows(item: VectorItem, box: Box, p: lp2.Placement): boolean[][] {
  const sx = p.width / box.w;
  const sy = p.height / box.h;
  const canvas = new OffscreenCanvas(p.width, p.height);
  const ctx = canvas.getContext('2d')!;
  const path = new Path2D();
  for (const pts of placedPaths(item)) {
    pts.forEach(([x, y], i) => (i ? path.lineTo : path.moveTo).call(path, (x - box.x) * sx, (y - box.y) * sy));
    path.closePath();
  }
  ctx.fillStyle = '#000';
  ctx.fill(path, 'evenodd');
  const a = ctx.getImageData(0, 0, p.width, p.height).data;
  return Array.from({ length: p.height }, (_, y) => Array.from({ length: p.width }, (_, x) => a[(y * p.width + x) * 4 + 3] > 127));
}

const toRows = (pixels: Uint8Array, width: number, height: number) =>
  Array.from({ length: height }, (_, y) => Array.from(pixels.subarray(y * width, (y + 1) * width), (v) => v < 128));

const safeName = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, 28) || 'Untitled';

/** Builds the upload for one item. */
export async function buildJob(item: Item): Promise<JobSpec> {
  const fileId = lp2.newFileId();
  const name = safeName(item.name);
  const box = itemBounds(item);
  let file: Uint8Array;
  let dithered = false;

  if (item.kind === 'vector' && item.mode === 'line') {
    file = lp2.gcodeFile(lp2.gcodeForPaths(placedPaths(item), item.depth), fileId, name);
  } else if (item.kind === 'vector') {
    const p = placementOf(box, item.resolution);
    file = lp2.runsFile(lp2.runsFromRows(fillRows(item, box, p)), p, fileId, name);
  } else {
    const p = placementOf(box, item.resolution);
    const pixels = await processImage(item, p.width, p.height, true);
    if (item.mode === 'bw') {
      file = lp2.runsFile(lp2.runsFromRows(toRows(pixels, p.width, p.height)), p, fileId, name);
    } else {
      file = lp2.rasterFile(pixels, p, fileId, name);
      dithered = item.mode === 'dither' || item.mode === 'sketch';
    }
  }

  return { name: item.name, file, power: item.power, depth: item.depth, passes: item.passes, xMm: Math.floor(box.x), yMm: Math.floor(box.y), dithered };
}

/**
 * The jobs for a set of items. Outlines with the same power, depth and passes are sent together as
 * one G-code file, which saves an upload and a start for each.
 */
export async function buildJobs(items: Item[]): Promise<JobSpec[]> {
  const jobs: JobSpec[] = [];
  const lineGroups = new Map<string, VectorItem[]>();
  for (const item of items) {
    if (item.kind === 'vector' && item.mode === 'line') {
      const k = `${item.power}|${item.depth}|${item.passes}`;
      const group = lineGroups.get(k);
      if (group) group.push(item);
      else lineGroups.set(k, [item]);
    }
  }
  const sent = new Set<string>();
  for (const item of items) {
    if (sent.has(item.id)) continue;
    const group = item.kind === 'vector' && item.mode === 'line' ? lineGroups.get(`${item.power}|${item.depth}|${item.passes}`)! : [item];
    group.forEach((i) => sent.add(i.id));
    if (group.length === 1) {
      jobs.push(await buildJob(item));
      continue;
    }
    const paths = group.flatMap((i) => placedPaths(i as VectorItem));
    const xs = paths.flat().map((p) => p[0]);
    const ys = paths.flat().map((p) => p[1]);
    const name = `${group.length} outlines`;
    jobs.push({
      name,
      file: lp2.gcodeFile(lp2.gcodeForPaths(paths, item.depth), lp2.newFileId(), name),
      power: item.power,
      depth: item.depth,
      passes: item.passes,
      xMm: Math.floor(Math.min(...xs)),
      yMm: Math.floor(Math.min(...ys)),
      dithered: false,
    });
  }
  return jobs;
}

/** G-code for an outline item, as the LP2 would run it. */
export function gcodeText(item: VectorItem): string {
  return lp2.gcodeForPaths(placedPaths(item), item.depth);
}

/** A small picture of the processed (unrotated) image, for the workspace. */
export async function previewUrl(item: ImageItem): Promise<string> {
  const ppm = lp2.pixelsPerMm(item.resolution);
  const scale = Math.min(1, 500 / (Math.max(item.w, item.h) * ppm));
  const w = Math.max(1, Math.round(item.w * ppm * scale));
  const h = Math.max(1, Math.round(item.h * ppm * scale));
  const pixels = await processImage(item, w, h);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(w, h);
  pixels.forEach((v, i) => data.data.set([v, v, v, v === 255 ? 0 : 255], i * 4));
  ctx.putImageData(data, 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

/** Traces an image (at its black-and-white threshold) into an outline item in the same place. */
export async function traceItem(item: ImageItem): Promise<VectorItem> {
  const ppm = Math.min(lp2.pixelsPerMm(item.resolution), 1200 / Math.max(item.w, item.h));
  const w = Math.max(2, Math.round(item.w * ppm));
  const h = Math.max(2, Math.round(item.h * ppm));
  const grey = await processImage({ ...item, mode: 'bw' }, w, h);
  const mask = grey.map((v) => (v < 128 ? 1 : 0));
  const loops = traceContours(mask, w, h, 0.7).filter((l) => l.length > 3);
  if (!loops.length) throw new Error('Nothing dark enough to trace. Try a higher threshold.');
  return {
    id: newId(),
    kind: 'vector',
    name: `Outline of ${item.name}`,
    visible: true,
    mode: 'line',
    paths: loops.map((l) => l.map(([x, y]) => [x / ppm, y / ppm] as [number, number])),
    naturalW: item.w,
    naturalH: item.h,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    rotation: item.rotation,
    flipX: item.flipX,
    flipY: item.flipY,
    power: item.power,
    depth: item.depth,
    passes: item.passes,
    resolution: item.resolution,
  };
}
