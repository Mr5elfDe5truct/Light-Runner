/** A job as timed moves, for the Simulate view. Pure. */
import { programLines } from './grbl.ts';

export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  burn: number; // 0 = travel (laser off), otherwise 0..1 power
  t0: number; // seconds from the start
  t1: number;
}

/**
 * Reads a program (design coordinates, y down) into segments. G1 moves with S > 0 burn;
 * G0 moves travel at `rapid` mm/min. M5 or S0 turn the beam off.
 */
export function toolpath(gcode: string, maxS = 1000, rapid = 6000, start: { x: number; y: number } | 'first-move' = { x: 0, y: 0 }): Segment[] {
  const out: Segment[] = [];
  // Where the head starts: a given point (a G-code laser's home), or the first move's target
  // (a galvo laser like the LP2 has no head to travel).
  let x = 0;
  let y = 0;
  if (start === 'first-move') {
    const first = programLines(gcode).find((l) => /^G0\b/.test(l));
    x = Number(/X(-?[\d.]+)/.exec(first ?? '')?.[1] ?? 0);
    y = Number(/Y(-?[\d.]+)/.exec(first ?? '')?.[1] ?? 0);
  } else {
    x = start.x;
    y = start.y;
  }
  let feed = 1000;
  let s = 0;
  let laserOn = false;
  let t = 0;
  for (const line of programLines(gcode)) {
    const word = (k: string) => {
      const m = new RegExp(`${k}(-?[\\d.]+)`).exec(line);
      return m ? Number(m[1]) : undefined;
    };
    if (/^M[34]\b/.test(line)) laserOn = true;
    if (/^M5\b/.test(line)) laserOn = false;
    const f = word('F');
    if (f !== undefined) feed = f;
    const sv = word('S');
    if (sv !== undefined) s = sv;
    const g = /^G([01])\b/.exec(line);
    if (!g) continue;
    const nx = word('X') ?? x;
    const ny = word('Y') ?? y;
    const len = Math.hypot(nx - x, ny - y);
    if (len > 0) {
      const travel = g[1] === '0';
      const dt = (len / (travel ? rapid : feed)) * 60;
      out.push({ x0: x, y0: y, x1: nx, y1: ny, burn: !travel && laserOn && s > 0 ? Math.min(1, s / maxS) : 0, t0: t, t1: t + dt });
      t += dt;
    }
    x = nx;
    y = ny;
  }
  return out;
}

/** The index of the last segment that has started by time `t` (binary search). */
export function segmentAt(segs: Segment[], t: number): number {
  let lo = 0;
  let hi = segs.length - 1;
  if (hi < 0 || t < segs[0].t0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Where the head is at time `t`. */
export function headAt(segs: Segment[], t: number): { x: number; y: number } {
  const i = segmentAt(segs, t);
  if (i < 0) return { x: segs[0]?.x0 ?? 0, y: segs[0]?.y0 ?? 0 };
  const s = segs[i];
  const k = s.t1 > s.t0 ? Math.min(1, (t - s.t0) / (s.t1 - s.t0)) : 1;
  return { x: s.x0 + (s.x1 - s.x0) * k, y: s.y0 + (s.y1 - s.y0) * k };
}
