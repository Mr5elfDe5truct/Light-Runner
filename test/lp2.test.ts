// Checks the protocol builders against bytes LaserPecker Design Space really sent (test/fixtures).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as lp2 from '../shared/lp2.ts';

interface Job {
  capture: string;
  announce: string;
  file: string;
  kind: number;
  engrave?: { hex: string; power: number; depth: number; x: number; y: number; passes: number; dithered: boolean };
}
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/lds-captures.json', import.meta.url), 'utf8')) as {
  jobs: Job[];
  frames: { capture: string; hex: string }[];
};

const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const hex = (b: Uint8Array) => lp2.hex(b, '');
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const resOf = (code: number): lp2.Resolution => (code === 0x02 ? '2K' : '1K');

test('every captured frame has a valid checksum', () => {
  for (const f of fixtures.frames) {
    const raw = bytes(f.hex);
    assert.equal(hex(lp2.frame(raw.slice(3, -2))), f.hex, f.capture);
  }
});

test('fixed commands match LDS', () => {
  const known = new Set([lp2.idle(), lp2.pause(), lp2.resume(), ...[0, 1, 2, 3, 5, 8].map(lp2.query)].map(hex));
  for (const f of fixtures.frames) {
    const p = bytes(f.hex).slice(3, -2);
    if (p[0] === 0x00 || p[0] === 0xff || (p[0] === 0x01 && (p[1] === 0x02 || p[1] === 0x04))) assert.ok(known.has(f.hex), `${f.capture}: ${f.hex}`);
  }
});

test('preview and settings frames rebuild exactly', () => {
  let previews = 0;
  let settings = 0;
  for (const f of fixtures.frames) {
    const p = bytes(f.hex).slice(3, -2);
    if (p[0] === 0x02 && p[1] === 0x02) {
      assert.equal(hex(lp2.preview(u16(p, 2), u16(p, 4), u16(p, 6), u16(p, 8), p[12])), f.hex);
      previews++;
    }
    if (p[0] === 0x06 && p[1] === 0x01) {
      assert.equal(hex(lp2.settings({ beep: !!p[3], reverseDirection: !!p[18] })), f.hex);
      settings++;
    }
  }
  assert.ok(previews >= 3 && settings >= 3);
});

test('every captured job file and engrave command rebuilds exactly', () => {
  assert.ok(fixtures.jobs.length >= 10);
  for (const job of fixtures.jobs) {
    const blob = bytes(job.file);
    const head = blob.slice(0, 64);
    const data = blob.slice(64);
    const id = head.slice(5, 9);
    const name = new TextDecoder().decode(head.slice(34, head.indexOf(0, 34)));
    assert.equal(hex(lp2.announceFile(blob.length)), job.announce, job.capture);

    if (job.kind === lp2.FileKind.gcode) {
      const text = new TextDecoder().decode(data);
      assert.equal(hex(lp2.gcodeFile(text, id, name, [u16(head, 1), u16(head, 3)])), job.file, job.capture);
      // The G-code itself, from just its corner points and the depth.
      const depth = 101 - Number(/M8F(\d+)/.exec(text)![1]) / 120;
      const paths: lp2.Point[][] = [];
      for (const m of text.matchAll(/G([01]) X([\d.]+) Y([\d.]+)/g)) {
        const pt: lp2.Point = [Number(m[2]), Number(m[3])];
        if (m[1] === '0') paths.push([pt]);
        else paths.at(-1)!.push(pt);
      }
      assert.equal(lp2.gcodeForPaths(paths, depth), text, job.capture);
    } else if (job.kind === lp2.FileKind.runs) {
      const runs: lp2.Run[] = [];
      for (let i = 0; i < data.length; i += 6) runs.push([u16(data, i), u16(data, i + 2), u16(data, i + 4)]);
      assert.equal(u32(head, 9), runs.length);
      const placement = { width: u16(head, 1), height: u16(head, 3), resolution: resOf(head[13]), xPx: u16(head, 14), yPx: u16(head, 16) };
      assert.equal(hex(lp2.runsFile(runs, placement, id, name)), job.file, job.capture);
      // Redraw the image from the runs, then turn it back into runs: they must come out the same.
      const rows = Array.from({ length: placement.height + 2 }, () => new Array<boolean>(placement.width + 2).fill(false));
      const forward = new Map<number, boolean>();
      for (const [x, y, n] of runs) {
        if (!forward.has(y)) forward.set(y, forward.size % 2 === 0);
        const a = forward.get(y) ? x : x - n;
        for (let xx = a; xx < a + n; xx++) rows[y - 1][xx - 1] = true;
      }
      assert.deepEqual(lp2.runsFromRows(rows), runs, job.capture);
    } else if (job.kind === lp2.FileKind.raster) {
      const placement = { width: u16(head, 1), height: u16(head, 3), resolution: resOf(head[9]), xPx: u16(head, 10), yPx: u16(head, 12) };
      assert.equal(hex(lp2.rasterFile(data, placement, id, name)), job.file, job.capture);
    } else {
      assert.fail(`unknown file type ${job.kind}`);
    }

    if (job.engrave) {
      const e = job.engrave;
      const built = lp2.engrave({ fileId: id, power: e.power, depth: e.depth, xMm: e.x, yMm: e.y, passes: e.passes, dithered: e.dithered });
      assert.equal(hex(built), e.hex, job.capture);
    }
  }
});

test('replies are read correctly', () => {
  const status = lp2.parseStatus(bytes('000101' + '3c' + '1e' + '01' + '0000' + '4146151c' + '000000010000000000020001000000000000'));
  assert.deepEqual(status, { state: 'engraving', progress: 60, power: 30, depth: 100, fileId: '4146151c' });
  assert.equal(lp2.parseFirmware(bytes('0001790000020000')), '3.7.7');
  const list = bytes('0002' + '41461 51c'.replace(' ', '') + 'ffffffff' + '379e9b98' + '0001');
  assert.deepEqual(lp2.parseFileList(list), ['4146151c', '379e9b98']);
});

test('glued and split replies are taken apart', () => {
  const glued = bytes('aabb080502010000000008aabb08ff01000000d901d9aabb08');
  const { frames, rest } = lp2.takeFrames(glued);
  assert.deepEqual(frames.map((f) => hex(f.slice(0, 2))), ['0502', 'ff01']);
  assert.equal(hex(rest), 'aabb08');
});

test('limits are enforced', () => {
  assert.equal(lp2.depthByte(100), 1);
  assert.equal(lp2.depthByte(50), 51);
  assert.throws(() => lp2.engrave({ fileId: new Uint8Array(4), power: 0, depth: 50, xMm: 0, yMm: 0 }));
  assert.throws(() => lp2.depthByte(0));
});
