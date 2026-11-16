/** Jobs for GRBL lasers: one G-code program per item. */
import { gcodeFor, type JobOptions, type MachineProfile, type Op } from '../shared/grbl.ts';
import { pixelsPerMm } from '../shared/lp2.ts';
import type { JobSpec } from '../shared/types.ts';
import { itemBounds, placedPaths } from './geometry.ts';
import { placementOf, processImage } from './imaging.ts';
import type { Item } from './model.ts';
import { emptyMask, fillPaths } from './raster.ts';

export const DEFAULT_SPEED = 1500; // mm/min
export const speedOf = (i: Item) => i.speed ?? DEFAULT_SPEED;

export async function opFor(item: Item): Promise<Op> {
  const box = itemBounds(item);
  const base = { power: item.power, speed: speedOf(item), passes: item.passes };
  if (item.kind === 'vector' && item.mode === 'line') return { kind: 'vector', paths: placedPaths(item), ...base };
  const p = placementOf(box, item.resolution);
  const pixelMm = 1 / pixelsPerMm(item.resolution);
  let pixels: Uint8Array;
  if (item.kind === 'vector') {
    // Filled shape: draw it into the pixel grid.
    const m = fillPaths(
      emptyMask(p.width, p.height),
      placedPaths(item).map((path) => path.map(([x, y]) => [(x - box.x) / pixelMm, (y - box.y) / pixelMm] as [number, number])),
    );
    pixels = m.data.map((v) => (v ? 0 : 255));
  } else {
    pixels = await processImage(item, p.width, p.height, true);
  }
  return { kind: 'raster', pixels, width: p.width, height: p.height, x: box.x, y: box.y, pixelMm, ...base };
}

/**
 * One program for everything, in layer order (each item keeps its own power, speed and passes),
 * so the head goes from one item to the next and only returns home once at the end.
 */
export async function buildGrblJobs(items: Item[], profile: MachineProfile, opts: JobOptions = {}): Promise<JobSpec[]> {
  if (!items.length) return [];
  const ops: Op[] = [];
  for (const item of items) ops.push(await opFor(item));
  const box = itemBounds(items[0]);
  return [
    {
      name: items.length === 1 ? items[0].name : `${items.length} items`,
      file: new Uint8Array(0),
      gcode: gcodeFor(ops, profile, opts),
      power: items[0].power,
      depth: items[0].depth,
      passes: items[0].passes,
      xMm: Math.floor(box.x),
      yMm: Math.floor(box.y),
      dithered: false,
    },
  ];
}
