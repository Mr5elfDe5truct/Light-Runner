/** Array: copies of the selection in rows and columns. Pure. */
import { boundsOf } from './geometry.ts';
import { newId, type Item } from './model.ts';

/**
 * Copies of `items` (moved together as a group) in `rows` x `cols`, spaced by the group's size
 * plus the gaps (mm). The originals are the top-left cell, so they aren't repeated.
 */
export function arrayCopies(items: Item[], rows: number, cols: number, gapX: number, gapY: number): Item[] {
  const b = boundsOf(items);
  if (!b || rows < 1 || cols < 1) return [];
  const out: Item[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!r && !c) continue;
      const dx = c * (b.w + gapX);
      const dy = r * (b.h + gapY);
      for (const i of items) out.push({ ...structuredClone(i), id: newId(), x: i.x + dx, y: i.y + dy });
    }
  }
  return out;
}
