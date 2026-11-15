/**
 * GRBL lasers (the usual G-code diode lasers): making G-code, reading GRBL's replies, and pacing
 * the stream so GRBL's 128-byte receive buffer never overflows. Pure.
 */
import type { Point } from './lp2.ts';

export const GRBL_BAUD = 115_200;
export const RX_BUFFER = 128;

export interface MachineProfile {
  bedW: number; // mm
  bedH: number;
  maxS: number; // GRBL's $30 (spindle/laser max), usually 1000
  originBottomLeft: boolean; // most GRBL lasers: Y grows away from you
}

export const DEFAULT_PROFILE: MachineProfile = { bedW: 400, bedH: 400, maxS: 1000, originBottomLeft: true };

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Design coordinates (mm, y down from the top-left) to machine coordinates. */
export const toMachine = (p: MachineProfile, [x, y]: Point): Point => [x, p.originBottomLeft ? p.bedH - y : y];

const sValue = (p: MachineProfile, powerPct: number, shade = 1) => Math.round(Math.max(0, Math.min(1, (powerPct / 100) * shade)) * p.maxS);

export interface VectorOp {
  kind: 'vector';
  paths: Point[][]; // design mm
  power: number; // %
  speed: number; // mm/min
  passes: number;
}

export interface RasterOp {
  kind: 'raster';
  pixels: Uint8Array; // 0 = full burn, 255 = none
  width: number;
  height: number;
  x: number; // top-left, design mm
  y: number;
  pixelMm: number;
  power: number;
  speed: number;
  passes: number;
  overscan?: number; // mm run-up at each end of a line so the speed is steady while burning
}

export type Op = VectorOp | RasterOp;

/** G-code for a set of operations, in GRBL laser mode (M4: power follows speed, off on G0). */
export function gcodeFor(ops: Op[], p: MachineProfile): string {
  const out: string[] = ['; Light Runner', 'G21', 'G90', 'M4 S0'];
  for (const op of ops) {
    for (let pass = 0; pass < Math.max(1, op.passes); pass++) {
      if (op.kind === 'vector') vectorLines(op, p, out);
      else rasterLines(op, p, out);
    }
  }
  out.push('M5 S0', 'G0 X0 Y0');
  return out.join('\n') + '\n';
}

function vectorLines(op: VectorOp, p: MachineProfile, out: string[]) {
  const s = sValue(p, op.power);
  out.push(`F${Math.round(op.speed)}`);
  for (const path of op.paths) {
    if (path.length < 2) continue;
    const [x0, y0] = toMachine(p, path[0]);
    out.push(`G0 X${n(x0)} Y${n(y0)}`);
    let first = true;
    for (const pt of path.slice(1)) {
      const [x, y] = toMachine(p, pt);
      out.push(`G1 X${n(x)} Y${n(y)}${first ? ` S${s}` : ''}`);
      first = false;
    }
  }
}

function rasterLines(op: RasterOp, p: MachineProfile, out: string[]) {
  const over = op.overscan ?? 2;
  out.push(`F${Math.round(op.speed)}`);
  let forward = true;
  for (let row = 0; row < op.height; row++) {
    const line = op.pixels.subarray(row * op.width, (row + 1) * op.width);
    let first = -1;
    let last = -1;
    for (let i = 0; i < line.length; i++)
      if (line[i] < 255) {
        if (first < 0) first = i;
        last = i;
      }
    if (first < 0) continue; // nothing to burn on this row
    const yDesign = op.y + (row + 0.5) * op.pixelMm;
    // Runs of equal shade, in travel order.
    const runs: { from: number; to: number; v: number }[] = [];
    for (let i = first; i <= last; ) {
      const v = line[i];
      let j = i;
      while (j + 1 <= last && line[j + 1] === v) j++;
      runs.push({ from: i, to: j + 1, v });
      i = j + 1;
    }
    if (!forward) runs.reverse();
    const xAt = (px: number) => op.x + px * op.pixelMm;
    const startX = forward ? xAt(first) - over : xAt(last + 1) + over;
    const [mx0, my] = toMachine(p, [startX, yDesign]);
    out.push(`G0 X${n(mx0)} Y${n(my)}`);
    const [inX] = toMachine(p, [forward ? xAt(first) : xAt(last + 1), yDesign]);
    out.push(`G1 X${n(inX)} S0`);
    for (const r of runs) {
      const endX = forward ? xAt(r.to) : xAt(r.from);
      const [mx] = toMachine(p, [endX, yDesign]);
      out.push(`G1 X${n(mx)} S${sValue(p, op.power, (255 - r.v) / 255)}`);
    }
    const [outX] = toMachine(p, [forward ? xAt(last + 1) + over : xAt(first) - over, yDesign]);
    out.push(`G1 X${n(outX)} S0`);
    forward = !forward;
  }
}

/** The lines of a program worth sending (comments and blanks dropped). */
export const programLines = (gcode: string) =>
  gcode
    .split(/\r?\n/)
    .map((l) => l.replace(/;.*$/, '').trim())
    .filter(Boolean);

/**
 * Character counting: how many of the waiting lines can go now, given the lengths (with newline)
 * of lines sent but not yet answered with "ok".
 */
export function linesToSend(inFlight: number[], waiting: string[], buffer = RX_BUFFER): number {
  let used = inFlight.reduce((s, v) => s + v, 0);
  let k = 0;
  while (k < waiting.length && used + waiting[k].length + 1 <= buffer - 1) {
    used += waiting[k].length + 1;
    k++;
  }
  return k;
}

export interface GrblStatus {
  state: string; // Idle, Run, Hold:0, Alarm, Door...
  x: number;
  y: number;
}

/** "<Run|MPos:10.000,20.000,0.000|FS:1000,0>" */
export function parseGrblStatus(line: string): GrblStatus | null {
  const m = /^<([^|>]+)\|(?:MPos|WPos):(-?[\d.]+),(-?[\d.]+)/.exec(line.trim());
  return m ? { state: m[1], x: Number(m[2]), y: Number(m[3]) } : null;
}

/** "$130=400.000" lines into a map. */
export function parseGrblSettings(lines: string[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const l of lines) {
    const m = /^\$(\d+)=(-?[\d.]+)/.exec(l.trim());
    if (m) out[Number(m[1])] = Number(m[2]);
  }
  return out;
}

/** A machine profile from GRBL's own settings: $130/$131 travel, $30 laser max, $32 laser mode. */
export function profileFromSettings(s: Record<number, number>, fallback = DEFAULT_PROFILE): MachineProfile & { laserMode: boolean } {
  return {
    bedW: s[130] > 0 ? s[130] : fallback.bedW,
    bedH: s[131] > 0 ? s[131] : fallback.bedH,
    maxS: s[30] > 0 ? s[30] : fallback.maxS,
    originBottomLeft: fallback.originBottomLeft,
    laserMode: s[32] === 1,
  };
}

export interface FireSpec {
  power: number; // %
  mode: 'beam' | 'strobe';
  seconds: number; // total time; the program turns the laser off by itself at the end
  onMs?: number; // strobe
  offMs?: number;
}

export const FIRE_LIMIT_S = 30;

/**
 * A test fire as a self-contained program: GRBL times it with dwells (G4) and ends with the
 * laser off, so it stops on its own even if the app or the cable goes away. In laser mode the
 * beam is only on in G1 (feed) mode, so G1 is set without moving.
 */
export function fireGcode(f: FireSpec, p: MachineProfile): string {
  const s = Math.max(1, sValue(p, f.power));
  const total = Math.max(0.05, Math.min(FIRE_LIMIT_S, f.seconds));
  const out = ['G21', 'G90', 'M5 S0', 'G1 F1000'];
  if (f.mode === 'beam') {
    out.push(`M3 S${s}`, `G4 P${n(total)}`, 'M5 S0');
  } else {
    const on = Math.max(10, f.onMs ?? 50) / 1000;
    const off = Math.max(10, f.offMs ?? 450) / 1000;
    const flashes = Math.max(1, Math.floor(total / (on + off)));
    for (let i = 0; i < flashes; i++) out.push(`M3 S${s}`, `G4 P${n(on)}`, 'M5 S0', `G4 P${n(off)}`);
  }
  out.push('G0');
  return out.join('\n') + '\n';
}

/** How long a program takes: each move's length at its feed rate (G0 at `rapid` mm/min). */
export function estimateProgramSeconds(gcode: string, rapid = 6000): number {
  let x = 0;
  let y = 0;
  let feed = 1000;
  let seconds = 0;
  for (const line of programLines(gcode)) {
    const f = /F(\d+(?:\.\d+)?)/.exec(line);
    if (f) feed = Number(f[1]);
    const m = /^G([01])\b/.exec(line);
    if (!m) continue;
    const nx = /X(-?[\d.]+)/.exec(line);
    const ny = /Y(-?[\d.]+)/.exec(line);
    const tx = nx ? Number(nx[1]) : x;
    const ty = ny ? Number(ny[1]) : y;
    seconds += (Math.hypot(tx - x, ty - y) / (m[1] === '0' ? rapid : feed)) * 60;
    x = tx;
    y = ty;
  }
  return seconds * 1.1; // acceleration and turnarounds
}

/** A frame around a box (design mm) with the laser off, for checking placement. */
export function frameGcode(box: { x: number; y: number; w: number; h: number }, p: MachineProfile, speed = 3000): string {
  const c: Point[] = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
    [box.x, box.y],
  ].map((pt) => toMachine(p, pt as Point));
  return ['G21', 'G90', 'M5 S0', `G0 X${n(c[0][0])} Y${n(c[0][1])}`, ...c.slice(1).map(([x, y]) => `G1 X${n(x)} Y${n(y)} F${speed}`)].join('\n') + '\n';
}
