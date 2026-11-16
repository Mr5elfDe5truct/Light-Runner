/**
 * The LaserPecker LP2 USB protocol: pure functions that build and read its bytes.
 * Worked out from USB captures of LaserPecker Design Space 2.12.1; see docs/PROTOCOL.md.
 * test/lp2.test.ts checks every builder against bytes LDS really sent.
 */

export const BAUD = 460_800; // 8N1, DTR and RTS on
export const USB_ID = { vendorId: '1a86', productId: '7523' }; // CH340
export const HEADER_SIZE = 64;
const NAME_OFFSET = 34;

/** File types (header byte 0). */
export const FileKind = {
  gcode: 0x20, // outlines: G-code text
  runs: 0x40, // black and white bitmap: (x, y, length) burn runs
  raster: 0x10, // one byte per pixel: 0x00 darkest, 0xff skip, greys between
} as const;

export type Resolution = '1K' | '2K';
/** Header code and dots per inch. 254 dpi = 0.1 mm per pixel. */
export const RESOLUTIONS: Record<Resolution, { code: number; dpi: number }> = {
  '1K': { code: 0x04, dpi: 254 },
  '2K': { code: 0x02, dpi: 508 },
};
export const pixelsPerMm = (r: Resolution) => RESOLUTIONS[r].dpi / 25.4;

// ---------------------------------------------------------------- frames

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

export function checksum(payload: Uint8Array | number[]): number[] {
  let sum = 0;
  for (const b of payload) sum += b;
  return u16(sum & 0xffff);
}

/** aa bb, length (payload + 2 checksum bytes), payload, 16-bit big-endian sum. */
export function frame(payload: number[] | Uint8Array): Uint8Array {
  const p = Array.from(payload);
  return Uint8Array.from([0xaa, 0xbb, p.length + 2, ...p, ...checksum(p)]);
}

/** Pulls whole, valid frames off the front of a byte stream. Returns their payloads and what's left over. */
export function takeFrames(buffer: Uint8Array): { frames: Uint8Array[]; rest: Uint8Array } {
  const frames: Uint8Array[] = [];
  let i = 0;
  for (;;) {
    while (i + 1 < buffer.length && !(buffer[i] === 0xaa && buffer[i + 1] === 0xbb)) i++;
    if (i + 3 > buffer.length) break;
    const end = i + 3 + buffer[i + 2];
    if (end > buffer.length) break;
    const payload = buffer.slice(i + 3, end - 2);
    const [hi, lo] = checksum(payload);
    if (buffer[end - 2] === hi && buffer[end - 1] === lo) {
      frames.push(payload);
      i = end;
    } else {
      i += 2;
    }
  }
  return { frames, rest: buffer.slice(Math.min(i, buffer.length)) };
}

// ---------------------------------------------------------------- commands (PC -> LP2)

/** 00 xx: 00 = status, 01 = stored files, 03 = firmware, 05 = device ID. */
export const query = (what: number) => frame([0x00, what, 0, 0, 0, 0]);
export const QUERY = { status: 0x00, files: 0x01, settings: 0x02, firmware: 0x03, deviceId: 0x05 } as const;

/** ff: leave the current mode. Before and after uploads; also stops a job or a preview. */
export const idle = () => frame([0xff, 0, 0, 0, 0, 0]);
export const stop = idle;

/** 05 01: a file of `size` bytes follows, unframed. Reply 05 01 01 (ready), then 05 02 01 (received). */
export const announceFile = (size: number) => frame([0x05, 0x01, ...u32(size), 0x00]);

/** LDS depth 1..100 is sent as 101 - depth (a speed: 1 = slowest, deepest). */
export function depthByte(depth: number): number {
  if (!Number.isInteger(depth) || depth < 1 || depth > 100) throw new Error('Depth is 1 to 100.');
  return 101 - depth;
}

export interface EngraveOptions {
  fileId: Uint8Array;
  power: number; // 1..100 %
  depth: number; // 1..100, as LDS shows it
  xMm: number; // the job's top-left corner, whole millimetres
  yMm: number;
  passes?: number;
  dithered?: boolean; // LDS sends 00 for dithered images, ff for everything else
}

/** 01 01: engrave a stored file. Reply 01 01. */
export function engrave(o: EngraveOptions): Uint8Array {
  if (!Number.isInteger(o.power) || o.power < 1 || o.power > 100) throw new Error('Power is 1 to 100.');
  const passes = o.passes ?? 1;
  const tail = [0x00, 0x07, 0xd0, 0x01, o.dithered ? 0x00 : 0xff, 0x3c, 0x00, 0x00, 0x01];
  return frame([0x01, 0x01, o.power, depthByte(o.depth), ...o.fileId, ...u16(o.xMm), ...u16(o.yMm), ...u16(passes), ...tail]);
}

const jobControl = (sub: number) => frame([0x01, sub, 0x00, 0x65, ...new Array(18).fill(0), 0x01]);
export const pause = () => jobControl(0x04);
export const resume = () => jobControl(0x02);

/**
 * 02 02: trace a frame with low light until stopped with idle(). Size and position in 0.1 mm.
 * Brightness: LDS's slider sent 1 at minimum and 5 mid-way. A 1 x 1 frame = LDS's centre-point preview.
 */
export function preview(width: number, height: number, x: number, y: number, brightness = 1): Uint8Array {
  return frame([0x02, 0x02, ...u16(width), ...u16(height), ...u16(x), ...u16(y), 0x00, 0x04, brightness, 0x07, 0xd0]);
}

export interface DeviceSettings {
  beep: boolean;
  reverseDirection: boolean;
}

/** 06 01: the LP2's settings, sent whole. Bytes 2, 4 and 9 stay as LDS sent them. */
export function settings(s: DeviceSettings): Uint8Array {
  const body = new Array(21).fill(0);
  body[0] = 0x06;
  body[1] = 0x01;
  body[2] = body[4] = body[9] = 0x01;
  body[3] = s.beep ? 1 : 0;
  body[18] = s.reverseDirection ? 1 : 0;
  return frame(body);
}

// ---------------------------------------------------------------- replies (LP2 -> PC)

export type DeviceState = 'idle' | 'done' | 'engraving' | 'resumed' | 'finished' | 'paused' | 'previewing' | 'preview done' | 'unknown';

const STATES: Record<string, DeviceState> = {
  '06 00': 'idle',
  '06 ff': 'done',
  '01 01': 'engraving',
  '01 02': 'resumed',
  '01 03': 'finished',
  '01 04': 'paused',
  '02 02': 'previewing',
  '02 03': 'preview done',
};

export interface Status {
  state: DeviceState;
  progress: number;
  power: number;
  depth: number;
  fileId: string;
  pos?: { x: number; y: number }; // head position in design mm (G-code lasers)
}

const hex = (bytes: Uint8Array | number[], sep = ' ') => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(sep);
export { hex };

/** The answer to the status query: 00, state (2), progress %, power, depth byte, 00 00, file ID (4), ... */
export function parseStatus(p: Uint8Array): Status | null {
  if (p.length < 15 || p[0] !== 0x00) return null;
  return {
    state: STATES[hex([p[1], p[2]])] ?? 'unknown',
    progress: p[3],
    power: p[4],
    depth: p[5] >= 1 && p[5] <= 100 ? 101 - p[5] : 0,
    fileId: hex(p.slice(8, 12), ''),
  };
}

/** The answer to the files query: 00, count, 31 four-byte ID slots (ff ff ff ff = empty), 2 more bytes. */
export function parseFileList(p: Uint8Array): string[] {
  if (p.length < 2 || p[0] !== 0x00) return [];
  const ids: string[] = [];
  for (let i = 2; i + 4 <= p.length; i += 4) {
    const id = hex(p.slice(i, i + 4), '');
    if (id !== 'ffffffff') ids.push(id);
  }
  return ids.slice(0, p[1]);
}

/** Firmware from the 00 03 reply: 00 01 79 ... -> "3.7.7". */
export function parseFirmware(p: Uint8Array): string | null {
  if (p.length < 3 || p[0] !== 0x00) return null;
  return String((p[1] << 8) | p[2]).split('').join('.');
}

// ---------------------------------------------------------------- files

export function newFileId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(4));
}

function header(prefix: number[], name: string): number[] {
  const head = new Array(HEADER_SIZE).fill(0);
  prefix.forEach((b, i) => (head[i] = b));
  const raw = Array.from(name, (c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 0x3f)).slice(0, HEADER_SIZE - NAME_OFFSET - 1);
  raw.forEach((b, i) => (head[NAME_OFFSET + i] = b));
  return head;
}

const fmt = (v: number) => v.toFixed(3);

export type Point = [number, number];

/** G-code in LDS's own shape. Millimetres, field 0..100 with the centre at 50,50. Power stays S255. */
export function gcodeForPaths(paths: Point[][], depth: number): string {
  const lines = ['G90', 'G21', `M8F${depthByte(depth) * 120}M5S0`, 'G1S255', 'F12000', 'M05S0'];
  for (const path of paths) {
    if (path.length < 2) continue;
    const [[x0, y0], ...rest] = path;
    lines.push(`G0 X${fmt(x0)} Y${fmt(y0)}`, 'M03S255', ...rest.map(([x, y]) => `G1 X${fmt(x)} Y${fmt(y)}`), 'M05S0');
  }
  lines.push('M05');
  return lines.join('\n') + '\n';
}

/** The smallest box around some points. A loop, not Math.min(...points): big designs have more points than the call stack allows. */
export function extent(points: Iterable<Point>): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export function gcodeBounds(gcode: string): { x0: number; y0: number; x1: number; y1: number } {
  const pts: Point[] = [];
  for (const m of gcode.matchAll(/X(-?[\d.]+) Y(-?[\d.]+)/g)) pts.push([Number(m[1]), Number(m[2])]);
  return extent(pts);
}

const concat = (head: number[], data: Uint8Array) => {
  const out = new Uint8Array(head.length + data.length);
  out.set(head);
  out.set(data, head.length);
  return out;
};

/** Header type 20: width, height (0.1 mm), ID, line count, x, y (0.1 mm), 254 dpi; then the G-code. */
export function gcodeFile(gcode: string, fileId: Uint8Array, name = 'Untitled', size?: [number, number]): Uint8Array {
  const b = gcodeBounds(gcode);
  const [w, h] = size ?? [Math.ceil((b.x1 - b.x0) * 10), Math.ceil((b.y1 - b.y0) * 10)];
  const count = gcode.split('\n').length;
  const prefix = [FileKind.gcode, ...u16(w), ...u16(h), ...fileId, ...u32(count), ...u16(Math.floor(b.x0 * 10)), ...u16(Math.floor(b.y0 * 10)), ...u16(254)];
  return concat(header(prefix, name), new TextEncoder().encode(gcode));
}

export type Run = [x: number, y: number, length: number];

/**
 * A black-and-white image (true = burn, row by row) as LDS-style serpentine runs. Pixels count from 1.
 * The first row with anything to burn runs left to right, the next right to left, and so on.
 */
export function runsFromRows(rows: boolean[][]): Run[] {
  const runs: Run[] = [];
  let rightwards = true;
  rows.forEach((row, yi) => {
    const spans: [number, number][] = [];
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      spans.push([start + 1, x - start]);
    }
    if (!spans.length) return;
    const y = yi + 1;
    if (rightwards) for (const [sx, n] of spans) runs.push([sx, y, n]);
    else for (const [sx, n] of spans.reverse()) runs.push([sx + n, y, n]);
    rightwards = !rightwards;
  });
  return runs;
}

export interface Placement {
  width: number; // pixels
  height: number;
  xPx: number; // top-left corner, pixels at the resolution
  yPx: number;
  resolution: Resolution;
}

/** Header type 40; data = (start x, row y, length) triples, 16-bit big-endian. */
export function runsFile(runs: Run[], p: Placement, fileId: Uint8Array, name = 'Untitled'): Uint8Array {
  const { code, dpi } = RESOLUTIONS[p.resolution];
  const prefix = [FileKind.runs, ...u16(p.width), ...u16(p.height), ...fileId, ...u32(runs.length), code, ...u16(p.xPx), ...u16(p.yPx), ...u16(dpi)];
  const data = new Uint8Array(runs.length * 6);
  runs.forEach(([x, y, n], i) => data.set([...u16(x), ...u16(y), ...u16(n)], i * 6));
  return concat(header(prefix, name), data);
}

/** Header type 10; data = one byte per pixel, row by row. */
export function rasterFile(pixels: Uint8Array, p: Placement, fileId: Uint8Array, name = 'Untitled'): Uint8Array {
  if (pixels.length !== p.width * p.height) throw new Error('The image must have width x height pixels.');
  const { code, dpi } = RESOLUTIONS[p.resolution];
  const prefix = [FileKind.raster, ...u16(p.width), ...u16(p.height), ...fileId, code, ...u16(p.xPx), ...u16(p.yPx), ...u16(dpi)];
  return concat(header(prefix, name), pixels);
}
