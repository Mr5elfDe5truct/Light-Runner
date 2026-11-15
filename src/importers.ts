/** Readers for DXF drawings and G-code files, into polylines in millimetres (y down). Pure. */
import type { Point } from '../shared/lp2.ts';

export interface Outline {
  paths: Point[][];
  width: number;
  height: number;
}

/** Moves the paths to start at 0,0 and reports their size. */
export function normalizePaths(paths: Point[][]): Outline {
  const kept = paths.filter((p) => p.length > 1);
  if (!kept.length) throw new Error('No lines were found in that file.');
  const all = kept.flat();
  const x0 = Math.min(...all.map((p) => p[0]));
  const y0 = Math.min(...all.map((p) => p[1]));
  const x1 = Math.max(...all.map((p) => p[0]));
  const y1 = Math.max(...all.map((p) => p[1]));
  return {
    paths: kept.map((p) => p.map(([x, y]) => [x - x0, y - y0] as Point)),
    width: Math.max(0.1, x1 - x0),
    height: Math.max(0.1, y1 - y0),
  };
}

// ---------------------------------------------------------------- DXF

const DXF_UNITS_MM: Record<number, number> = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0254, 9: 0.0254 * 1000 };

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): Point[] {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360;
  const steps = Math.max(8, Math.ceil((sweep / 360) * Math.max(24, r * 8)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((startDeg + (sweep * i) / steps) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Point;
  });
}

/** A polyline segment with a bulge (DXF's way of writing arcs) as points. */
function bulgeArc(a: Point, b: Point, bulge: number): Point[] {
  if (!bulge) return [b];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const r = chord / (2 * Math.sin(theta / 2));
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const nx = -(b[1] - a[1]) / chord;
  const ny = (b[0] - a[0]) / chord;
  const c: Point = [mid[0] + nx * h, mid[1] + ny * h];
  const start = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const steps = Math.max(4, Math.ceil(Math.abs(theta) * 8));
  return Array.from({ length: steps }, (_, i) => {
    const t = start + (theta * (i + 1)) / steps;
    return [c[0] + Math.abs(r) * Math.cos(t), c[1] + Math.abs(r) * Math.sin(t)] as Point;
  });
}

/** Reads LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE and SPLINE entities. */
export function readDxf(text: string): Outline {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()]);

  let scale = 1;
  const insunits = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  if (insunits >= 0) scale = DXF_UNITS_MM[Number(pairs[insunits + 1]?.[1])] ?? 1;

  const start = pairs.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION');
  const entities: { type: string; codes: [number, string][] }[] = [];
  for (let i = start < 0 ? 0 : start + 1; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) {
      if (v === 'ENDSEC') break;
      entities.push({ type: v, codes: [] });
    } else entities.at(-1)?.codes.push([c, v]);
  }

  const paths: Point[][] = [];
  let poly: { points: Point[]; closed: boolean } | null = null;
  const num = (codes: [number, string][], code: number, d = 0) => Number(codes.find(([c]) => c === code)?.[1] ?? d);

  for (const { type, codes } of entities) {
    if (type === 'LINE') paths.push([[num(codes, 10), num(codes, 20)], [num(codes, 11), num(codes, 21)]]);
    else if (type === 'CIRCLE') paths.push(arc(num(codes, 10), num(codes, 20), num(codes, 40), 0, 360));
    else if (type === 'ARC') paths.push(arc(num(codes, 10), num(codes, 20), num(codes, 40), num(codes, 50), num(codes, 51)));
    else if (type === 'ELLIPSE') {
      const [cx, cy, mx, my, ratio] = [num(codes, 10), num(codes, 20), num(codes, 11), num(codes, 21), num(codes, 40, 1)];
      const t0 = num(codes, 41, 0);
      let t1 = num(codes, 42, Math.PI * 2);
      if (t1 <= t0) t1 += Math.PI * 2;
      const major = Math.hypot(mx, my);
      const rot = Math.atan2(my, mx);
      const steps = 72;
      paths.push(
        Array.from({ length: steps + 1 }, (_, i) => {
          const t = t0 + ((t1 - t0) * i) / steps;
          const ex = major * Math.cos(t);
          const ey = major * ratio * Math.sin(t);
          return [cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)] as Point;
        }),
      );
    } else if (type === 'LWPOLYLINE') {
      const pts: Point[] = [];
      const bulges: number[] = [];
      for (const [c, v] of codes) {
        if (c === 10) {
          pts.push([Number(v), 0]);
          bulges.push(0);
        } else if (c === 20 && pts.length) pts[pts.length - 1][1] = Number(v);
        else if (c === 42 && pts.length) bulges[bulges.length - 1] = Number(v);
      }
      const closed = (num(codes, 70) & 1) === 1;
      if (pts.length > 1) {
        const out: Point[] = [pts[0]];
        const n = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < n; i++) out.push(...bulgeArc(pts[i], pts[(i + 1) % pts.length], bulges[i]));
        paths.push(out);
      }
    } else if (type === 'POLYLINE') poly = { points: [], closed: (num(codes, 70) & 1) === 1 };
    else if (type === 'VERTEX' && poly) poly.points.push([num(codes, 10), num(codes, 20)]);
    else if (type === 'SEQEND' && poly) {
      if (poly.closed && poly.points.length) poly.points.push(poly.points[0]);
      paths.push(poly.points);
      poly = null;
    } else if (type === 'SPLINE') {
      // Fit points if there are any, otherwise the control polygon (a close-enough outline for engraving).
      const fit: Point[] = [];
      const ctrl: Point[] = [];
      for (const [c, v] of codes) {
        if (c === 11) fit.push([Number(v), 0]);
        else if (c === 21 && fit.length) fit[fit.length - 1][1] = Number(v);
        else if (c === 10) ctrl.push([Number(v), 0]);
        else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = Number(v);
      }
      paths.push(fit.length > 1 ? fit : ctrl);
    }
  }
  // DXF's y axis points up; the field's points down.
  return normalizePaths(paths.map((p) => p.map(([x, y]) => [x * scale, -y * scale] as Point)));
}

// ---------------------------------------------------------------- G-code

/** Reads G0/G1/G2/G3 moves. Burning moves (G1-G3) become paths; G0 travel starts a new one. */
export function readGcode(text: string): Outline {
  let x = 0;
  let y = 0;
  let absolute = true;
  let unit = 1;
  let motion = 0;
  const paths: Point[][] = [];
  let current: Point[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\(.*?\)|;.*$/g, '').toUpperCase();
    if (!line.trim()) continue;
    const words = new Map<string, number>();
    for (const m of line.matchAll(/([A-Z])\s*(-?[\d.]+)/g)) {
      if (m[1] === 'G' || m[1] === 'M') {
        const g = Number(m[2]);
        if (m[1] === 'G') {
          if (g === 90) absolute = true;
          else if (g === 91) absolute = false;
          else if (g === 20) unit = 25.4;
          else if (g === 21) unit = 1;
          else if (g <= 3 && Number.isInteger(g)) motion = g;
        }
      } else words.set(m[1], Number(m[2]));
    }
    if (!words.has('X') && !words.has('Y')) continue;
    const nx = words.has('X') ? (absolute ? 0 : x) + words.get('X')! * unit : x;
    const ny = words.has('Y') ? (absolute ? 0 : y) + words.get('Y')! * unit : y;
    if (motion === 0) {
      current = null;
    } else {
      if (!current) {
        current = [[x, y]];
        paths.push(current);
      }
      if ((motion === 2 || motion === 3) && (words.has('I') || words.has('J'))) {
        const cx = x + (words.get('I') ?? 0) * unit;
        const cy = y + (words.get('J') ?? 0) * unit;
        const r = Math.hypot(x - cx, y - cy);
        let a0 = Math.atan2(y - cy, x - cx);
        let a1 = Math.atan2(ny - cy, nx - cx);
        if (motion === 2 && a1 >= a0) a1 -= Math.PI * 2;
        if (motion === 3 && a1 <= a0) a1 += Math.PI * 2;
        const steps = Math.max(4, Math.ceil(Math.abs(a1 - a0) * Math.max(4, r)));
        for (let i = 1; i <= steps; i++) {
          const t = a0 + ((a1 - a0) * i) / steps;
          current.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
        }
        a0 = a1;
      } else current.push([nx, ny]);
    }
    x = nx;
    y = ny;
  }
  return normalizePaths(paths);
}
