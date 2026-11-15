/**
 * Offsetting outlines and combining shapes. Works by drawing the shapes into a fine pixel grid,
 * growing/shrinking/combining there, then tracing the result back into outlines.
 */
import type { Point } from '../shared/lp2.ts';
import { boundsOf, placedPaths } from './geometry.ts';
import { DEFAULTS, newId, type VectorItem } from './model.ts';
import { combineMasks, emptyMask, fillPaths, offsetMask, strokePaths, type BooleanOp, type Mask } from './raster.ts';
import { traceContours } from './trace.ts';

const MAX_PIXELS = 1600; // along the longer side

const isClosed = (p: Point[]) => p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6;

interface Grid {
  x0: number;
  y0: number;
  ppm: number; // pixels per mm
  width: number;
  height: number;
}

function gridFor(box: { x: number; y: number; w: number; h: number }, margin: number): Grid {
  const w = box.w + margin * 2;
  const h = box.h + margin * 2;
  const ppm = Math.min(40, MAX_PIXELS / Math.max(w, h, 0.1));
  return { x0: box.x - margin, y0: box.y - margin, ppm, width: Math.ceil(w * ppm) + 2, height: Math.ceil(h * ppm) + 2 };
}

/** One item drawn into the grid: closed paths filled, open ones drawn as thin lines. */
function maskOf(item: VectorItem, g: Grid): Mask {
  const toPx = (p: Point[]) => p.map(([x, y]) => [(x - g.x0) * g.ppm, (y - g.y0) * g.ppm] as Point);
  const paths = placedPaths(item).map(toPx);
  const m = emptyMask(g.width, g.height);
  fillPaths(
    m,
    paths.filter((p) => isClosed(p)),
  );
  const open = paths.filter((p) => !isClosed(p));
  if (open.length) strokePaths(m, open, Math.max(1, g.ppm * 0.1));
  return m;
}

function itemFromMask(mask: Mask, g: Grid, name: string, like: VectorItem): VectorItem {
  const loops = traceContours(mask.data, mask.width, mask.height, 0.6).filter((l) => l.length > 3);
  if (!loops.length) throw new Error('Nothing is left after that.');
  const paths = loops.map((l) => l.map(([x, y]) => [g.x0 + x / g.ppm, g.y0 + y / g.ppm] as Point));
  const all = paths.flat();
  const x = Math.min(...all.map((p) => p[0]));
  const y = Math.min(...all.map((p) => p[1]));
  const w = Math.max(...all.map((p) => p[0])) - x;
  const h = Math.max(...all.map((p) => p[1])) - y;
  return {
    ...DEFAULTS,
    id: newId(),
    kind: 'vector',
    name,
    visible: true,
    mode: like.mode,
    paths: paths.map((p) => p.map(([px, py]) => [px - x, py - y] as Point)),
    naturalW: w,
    naturalH: h,
    x,
    y,
    w,
    h,
    power: like.power,
    depth: like.depth,
    passes: like.passes,
    resolution: like.resolution,
  };
}

/** An outline `mm` outside (positive) or inside (negative) the shape. */
export function offsetItem(item: VectorItem, mm: number): VectorItem {
  if (!mm) throw new Error('Choose an offset other than 0.');
  const box = boundsOf([item])!;
  const g = gridFor(box, Math.max(0, mm) + 1);
  const grown = offsetMask(maskOf(item, g), mm * g.ppm);
  return itemFromMask(grown, g, `${item.name} ${mm > 0 ? '+' : ''}${mm} mm`, { ...item, mode: 'line' });
}

/** Union, subtract (first minus the rest), intersect or exclude of the selected shapes. */
export function combineItems(items: VectorItem[], op: BooleanOp): VectorItem {
  if (items.length < 2) throw new Error('Select two or more shapes.');
  const box = boundsOf(items)!;
  const g = gridFor(box, 1);
  const label = { union: 'Union', subtract: 'Cut-out', intersect: 'Overlap', exclude: 'Exclude' }[op];
  return itemFromMask(combineMasks(items.map((i) => maskOf(i, g)), op), g, `${label} of ${items.length}`, items[0]);
}
