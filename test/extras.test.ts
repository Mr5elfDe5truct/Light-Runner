// Single-line text, QR codes and job-time estimates.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { estimateSeconds, formatDuration } from '../shared/estimate.ts';
import * as lp2 from '../shared/lp2.ts';
import { qrPaths } from '../src/codes.ts';
import { hersheyText, supported } from '../src/hershey.ts';

test('Hershey text: scaled to the capital height, one stroke set per letter, lines stack', () => {
  const h = hersheyText('H', 10);
  assert.equal(h.paths.length, 3, 'H is two uprights and a bar');
  assert.ok(Math.abs(h.height - 10) < 0.6, `height ${h.height}`);
  const two = hersheyText('HI\nHI', 5);
  assert.ok(two.height > 10, 'second line sits below the first');
  assert.ok(supported('7') && supported('@') && !supported('é'));
  assert.deepEqual(hersheyText('é', 5).paths, [], 'unknown characters become spaces');
});

test('QR code: a finder pattern in the corner and rows joined into runs', () => {
  const qr = qrPaths('https://example.com', 'M');
  assert.equal(qr.modules, 25, 'version 2 for this length');
  // The top-left finder pattern starts with a run of 7 dark modules on row 0.
  const firstRow = qr.paths.filter((p) => p[0][1] === 0).sort((a, b) => a[0][0] - b[0][0]);
  assert.deepEqual([firstRow[0][0], firstRow[0][1]], [[0, 0], [7, 0]]);
  const withBorder = qrPaths('hello', 'L', 4);
  assert.equal(withBorder.size, withBorder.modules + 8);
  assert.throws(() => qrPaths(''));
});

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/lds-captures.json', import.meta.url), 'utf8')) as {
  jobs: { capture: string; file: string; engrave?: { depth: number; passes: number } }[];
};
const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const job = (capture: string) => {
  const j = fixtures.jobs.find((x) => x.capture === capture && x.engrave)!;
  return { file: bytes(j.file), depth: j.engrave!.depth, passes: j.engrave!.passes };
};

test('estimates land near the times the LP2 really took', () => {
  const within = (actual: number, real: number, slack: number) => assert.ok(Math.abs(actual - real) / real < slack, `${actual.toFixed(0)} s vs ${real} s`);
  within(estimateSeconds(job('square_p30.pcapng')), 45, 0.25); // 20 mm outline, depth 100
  within(estimateSeconds(job('fill_p30.pcapng')), 480, 0.2); // 20 mm filled square, depth 100
  within(estimateSeconds(job('dither_and_gray.pcapng')), 87, 0.3); // 20 mm dither
  within(estimateSeconds(job('image_2p5d.pcapng')), 19, 0.4); // 10 mm greyscale
  const two = { ...job('square_p30.pcapng'), passes: 2 };
  assert.ok(estimateSeconds(two) > estimateSeconds(job('square_p30.pcapng')) * 1.7);
});

test('durations read naturally', () => {
  assert.equal(formatDuration(42), '42 s');
  assert.equal(formatDuration(125), '2 min 5 s');
  assert.equal(formatDuration(3600 * 2 + 60 * 3), '2 h 3 min');
  assert.equal(lp2.FileKind.gcode, 0x20);
});
