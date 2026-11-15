/** Reads an SVG into polylines (millimetres), sampling every shape the browser can measure. */
import type { Point } from '../shared/lp2.ts';

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
const SHAPES = 'path, rect, circle, ellipse, line, polyline, polygon';

function lengthMm(value: string | null): number | null {
  const m = value?.trim().match(/^([\d.]+)\s*(mm|cm|in|pt|pc|px)?$/);
  return m ? Number(m[1]) * UNIT_MM[m[2] ?? ''] : null;
}

export interface VectorImport {
  paths: Point[][];
  width: number; // mm
  height: number;
}

export function readSvg(text: string): VectorImport {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const source = doc.querySelector('svg');
  if (!source || doc.querySelector('parsererror')) throw new Error('That file is not a readable SVG.');

  // Measure it in the live page (shapes only report lengths there), off screen.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden';
  const svg = document.importNode(source, true) as SVGSVGElement;
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const vb = svg.viewBox.baseVal;
    const userW = vb && vb.width ? vb.width : Number.parseFloat(svg.getAttribute('width') ?? '') || 100;
    const userH = vb && vb.height ? vb.height : Number.parseFloat(svg.getAttribute('height') ?? '') || 100;
    const mmW = lengthMm(svg.getAttribute('width')) ?? userW * UNIT_MM.px;
    const mmPerUnit = mmW / userW;
    const rootCtm = svg.getScreenCTM();
    const toRoot = rootCtm ? rootCtm.inverse() : null;
    const ox = vb?.x ?? 0;
    const oy = vb?.y ?? 0;

    const paths: Point[][] = [];
    for (const el of svg.querySelectorAll<SVGGeometryElement>(SHAPES)) {
      if (el.closest('defs, clipPath, mask, symbol')) continue;
      let total: number;
      try {
        total = el.getTotalLength();
      } catch {
        continue;
      }
      if (!(total > 0)) continue;
      const ctm = el.getScreenCTM();
      const m = ctm && toRoot ? toRoot.multiply(ctm) : null;
      const step = Math.max(total / 20000, 0.1 / mmPerUnit); // about every 0.1 mm
      let current: Point[] = [];
      let last: Point | null = null;
      for (let s = 0; s <= total + step / 2; s += step) {
        const pt = el.getPointAtLength(Math.min(s, total));
        const x = m ? m.a * pt.x + m.c * pt.y + m.e : pt.x;
        const y = m ? m.b * pt.x + m.d * pt.y + m.f : pt.y;
        const here: Point = [(x - ox) * mmPerUnit, (y - oy) * mmPerUnit];
        // A jump much longer than one step means a new sub-path started (an "M" in the data).
        if (last && Math.hypot(here[0] - last[0], here[1] - last[1]) > step * mmPerUnit * 4) {
          if (current.length > 1) paths.push(current);
          current = [];
        }
        current.push(here);
        last = here;
      }
      if (current.length > 1) paths.push(simplify(current, 0.02));
    }
    if (!paths.length) throw new Error('No shapes with outlines were found in that SVG.');

    // Shift to start at 0,0 and report the real size.
    const xs = paths.flat().map((p) => p[0]);
    const ys = paths.flat().map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const shifted = paths.map((p) => p.map(([x, y]) => [x - x0, y - y0] as Point));
    return { paths: shifted, width: Math.max(0.1, Math.max(...xs) - x0), height: Math.max(0.1, Math.max(...ys) - y0) };
  } finally {
    host.remove();
  }
}

/** Drops points that sit within `tol` mm of the straight line between their neighbours. */
export function simplify(points: Point[], tol: number): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = points[i];
    const [cx, cy] = points[i + 1];
    const len = Math.hypot(cx - ax, cy - ay) || 1;
    const dist = Math.abs((cx - ax) * (ay - by) - (ax - bx) * (cy - ay)) / len;
    if (dist > tol) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Text drawn as a black-on-white image, so it engraves like a picture. */
export function textImage(text: string, family = '"Segoe UI", sans-serif', bold = true, italic = false): { src: string; aspect: number } {
  const font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}160px ${family}`;
  const lines = text.split('\n');
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const lineH = 200;
  const width = Math.ceil(Math.max(...lines.map((l) => probe.measureText(l).width), 10)) + 40;
  const height = lineH * lines.length + 40;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = font;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 20, 20 + i * lineH));
  return { src: canvas.toDataURL('image/png'), aspect: width / height };
}
