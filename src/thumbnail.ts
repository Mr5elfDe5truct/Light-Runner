/** A small picture of a design, for the library. */
import { placedPaths } from './geometry.ts';
import { loadImage } from './imaging.ts';
import type { Item } from './model.ts';

export async function thumbnail(items: Item[], previews: Record<string, string>, size = 240, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<string> {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f7f4';
  ctx.fillRect(0, 0, size, size);
  // Fit the design's own bounds (it may be anywhere on a big work area), with a small margin.
  const xs = items.flatMap((i) => [i.x, i.x + i.w]);
  const ys = items.flatMap((i) => [i.y, i.y + i.h]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * 1.1;
  const ox = Math.min(...xs) - (span - (Math.max(...xs) - Math.min(...xs))) / 2;
  const oy = Math.min(...ys) - (span - (Math.max(...ys) - Math.min(...ys))) / 2;
  const k = size / span;
  ctx.translate(-ox * k, -oy * k);
  for (const item of items.filter((i) => i.visible)) {
    if (item.kind === 'image') {
      const url = previews[item.id] ?? item.src;
      if (!url) continue;
      try {
        const img = await loadImage(url);
        ctx.save();
        ctx.translate((item.x + item.w / 2) * k, (item.y + item.h / 2) * k);
        ctx.rotate((item.rotation * Math.PI) / 180);
        ctx.scale(item.flipX ? -1 : 1, item.flipY ? -1 : 1);
        ctx.drawImage(img, (-item.w / 2) * k, (-item.h / 2) * k, item.w * k, item.h * k);
        ctx.restore();
      } catch {
        // leave it out
      }
    } else {
      ctx.beginPath();
      for (const p of placedPaths(item)) p.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
      if (item.mode === 'fill') {
        ctx.fillStyle = '#222';
        ctx.fill('evenodd');
      } else {
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
  return c.toDataURL(type, 0.8);
}
