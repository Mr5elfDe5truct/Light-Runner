/**
 * Rough job times, worked out from the job file itself. Calibrated on timings from real LP2 jobs:
 * - Outlines move at (101 - depth) x 2 mm/s (the G-code's M8F value in mm/min), plus about 8 s to
 *   start. A 20 mm square at depth 100 took ~45 s.
 * - Black-and-white runs: about 0.14 s per row plus the burn length at ~9 mm/s at depth 100,
 *   faster at lower depths (a 20 mm filled square at depth 100 took ~8 min).
 * - Rasters (dither, greyscale) sweep each row at ~45 mm/s (a 20 mm dither took ~1.5 min, a 10 mm
 *   greyscale ~20 s).
 * It's an estimate: material, power and the LP2's own planning all change the real time.
 */
import { FileKind, pixelsPerMm, type Resolution } from './lp2.ts';

const START_S = 8;

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

export interface EstimateInput {
  file: Uint8Array;
  depth: number;
  passes: number;
}

export function estimateSeconds(job: EstimateInput): number {
  const head = job.file;
  const kind = head[0];
  const speedByte = 101 - job.depth;
  const passes = Math.max(1, job.passes);

  if (kind === FileKind.gcode) {
    const text = new TextDecoder().decode(job.file.subarray(64));
    let burn = 0;
    let travel = 0;
    let x = 0;
    let y = 0;
    for (const m of text.matchAll(/G([01]) X(-?[\d.]+) Y(-?[\d.]+)/g)) {
      const nx = Number(m[2]);
      const ny = Number(m[3]);
      const d = Math.hypot(nx - x, ny - y);
      if (m[1] === '1') burn += d;
      else travel += d;
      x = nx;
      y = ny;
    }
    return START_S + passes * (burn / (speedByte * 2) + travel / 150);
  }

  if (kind === FileKind.runs) {
    const res: Resolution = head[13] === 0x02 ? '2K' : '1K';
    const ppm = pixelsPerMm(res);
    const count = u32(head, 9);
    const rows = new Set<number>();
    let length = 0;
    for (let i = 0; i < count; i++) {
      const o = 64 + i * 6;
      rows.add(u16(job.file, o + 2));
      length += u16(job.file, o + 4);
    }
    const v = 9 * Math.pow(speedByte, 0.227);
    return START_S + passes * (rows.size * 0.14 + length / ppm / v);
  }

  if (kind === FileKind.raster) {
    const res: Resolution = head[9] === 0x02 ? '2K' : '1K';
    const ppm = pixelsPerMm(res);
    const width = u16(head, 1) / ppm;
    const height = u16(head, 3);
    return passes * ((height * width) / 45);
  }
  return START_S;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
