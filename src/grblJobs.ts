/** Jobs for GRBL lasers: one G-code program per item. */
import { gcodeFor, type MachineProfile, type Op } from '../shared/grbl.ts';
import { pixelsPerMm } from '../shared/lp2.ts';
import type { JobSpec } from '../shared/types.ts';
import { itemBounds, placedPaths } from './geometry.ts';
import { placementOf, processImage } from './imaging.ts';
import type { Item } from './model.ts';
import { emptyMask, fillPaths } from './raster.ts';

export const DEFAULT_SPEED = 1500; // mm/min
export const speedOf = (i: Item) => i.speed ?? DEFAULT_SPEED;

async function opFor(item: Item): Promise<Op> {
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

export async function buildGrblJobs(items: Item[], profile: MachineProfile): Promise<JobSpec[]> {
  const jobs: JobSpec[] = [];
  for (const item of items) {
    const box = itemBounds(item);
    jobs.push({
      name: item.name,
      file: new Uint8Array(0),
      gcode: gcodeFor([await opFor(item)], profile),
      power: item.power,
      depth: item.depth,
      passes: item.passes,
      xMm: Math.floor(box.x),
      yMm: Math.floor(box.y),
      dithered: false,
    });
  }
  return jobs;
}
