// Masks, offsets, shape booleans, dithering, camera straightening, arc text and batch templates.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Point } from '../shared/lp2.ts';
import { batchCount, batchValues, fillTemplate, hasPlaceholders } from '../src/batch.ts';
import { FIELD_CORNERS, homography, project, straighten } from '../src/camera.ts';
import { ditherWith, gammaAdjust, removeBackground, sharpen, type DitherMethod } from '../src/dither.ts';
import { itemBounds } from '../src/geometry.ts';
import { hersheyArc } from '../src/hershey.ts';
import { DEFAULTS, type VectorItem } from '../src/model.ts';
import { combineMasks, emptyMask, fillPaths, inkCount, offsetMask, strokePaths } from '../src/raster.ts';
import { combineItems, offsetItem } from '../src/vectorOps.ts';

const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b}`);
const sq = (x: number, y: number, s: number): Point[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

test('fill, stroke and grow a mask', () => {
  const m = fillPaths(emptyMask(20, 20), [sq(5, 5, 10)]);
  assert.equal(inkCount(m), 100);
  const holed = fillPaths(emptyMask(20, 20), [sq(2, 2, 16), sq(6, 6, 8)]);
  assert.equal(inkCount(holed), 256 - 64, 'even-odd leaves the hole');
  const grown = offsetMask(m, 2);
  assert.ok(inkCount(grown) > 100 && grown.data[3 * 20 + 10] === 1 && grown.data[1 * 20 + 10] === 0);
  const shrunk = offsetMask(m, -2);
  assert.equal(inkCount(shrunk), 36);
  const line = strokePaths(emptyMask(20, 20), [[[2, 10], [18, 10]]], 2);
  assert.ok(inkCount(line) >= 30 && inkCount(line) <= 40);
  const both = combineMasks([m, fillPaths(emptyMask(20, 20), [sq(10, 10, 10)])], 'union');
  assert.equal(inkCount(both), 100 + 100 - 25);
});

const vsq = (x: number, y: number, s: number, patch: Partial<VectorItem> = {}): VectorItem => ({
  ...DEFAULTS,
  id: `s${x}`,
  name: 'sq',
  kind: 'vector',
  visible: true,
  mode: 'line',
  paths: [sq(0, 0, 10)],
  naturalW: 10,
  naturalH: 10,
  x,
  y,
  w: s,
  h: s,
  ...patch,
});

test('offsetting a 10 mm square by 1 mm gives a ~12 mm outline', () => {
  const out = offsetItem(vsq(40, 40, 10), 1);
  const b = itemBounds(out);
  near(b.w, 12, 0.15, 'width');
  near(b.x, 39, 0.15, 'x');
  const inner = itemBounds(offsetItem(vsq(40, 40, 10), -2));
  near(inner.w, 6, 0.15, 'inset width');
});

test('union and cut-out of two overlapping squares', () => {
  const a = vsq(40, 40, 10);
  const b = vsq(45, 45, 10);
  const u = itemBounds(combineItems([a, b], 'union'));
  near(u.w, 15, 0.15, 'union width');
  const cut = combineItems([a, b], 'subtract');
  near(itemBounds(cut).w, 10, 0.15, 'cut width');
  assert.equal(cut.paths.length, 1, 'an L shape is one outline');
  assert.throws(() => combineItems([a], 'union'));
});

test('every dither keeps the overall darkness of a mid-grey', () => {
  const w = 64;
  const grey = new Uint8Array(w * w).fill(128);
  for (const m of ['floyd', 'atkinson', 'jarvis', 'stucki', 'burkes', 'ordered'] as DitherMethod[]) {
    const out = ditherWith(grey, w, w, m);
    const dark = out.filter((v) => v === 0).length / out.length;
    near(dark, m === 'atkinson' ? 0.45 : 0.5, 0.12, m);
    assert.ok(out.every((v) => v === 0 || v === 255));
  }
});

test('gamma, sharpen and background removal', () => {
  assert.equal(gammaAdjust(Uint8Array.of(128), 2)[0], 181);
  const edge = Uint8Array.from([100, 100, 200, 200]);
  const s = sharpen(edge, 4, 1, 100);
  assert.ok(s[1] < 100 && s[2] > 200, 'edges get stronger');
  // A dark square on a light, slightly noisy background.
  const w = 10;
  const img = new Uint8Array(w * w).map((_, i) => (i % 3 ? 230 : 236));
  for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) img[y * w + x] = 20;
  const clean = removeBackground(img, w, w, 15);
  assert.equal(clean[0], 255);
  assert.equal(clean[5 * w + 5], 20);
});

test('camera: corners map onto the field, and a photo straightens', () => {
  const corners: Point[] = [[100, 80], [520, 60], [560, 470], [90, 430]];
  const h = homography(FIELD_CORNERS, corners);
  FIELD_CORNERS.forEach((p, i) => {
    const q = project(h, p);
    near(q[0], corners[i][0], 1e-6);
    near(q[1], corners[i][1], 1e-6);
  });
  // A plain 4x4 photo whose corners are the field corners comes back the same colour.
  const photo = new Uint8ClampedArray(4 * 4 * 4).fill(200);
  const out = straighten(photo, 4, 4, [[0.5, 0.5], [3.5, 0.5], [3.5, 3.5], [0.5, 3.5]], 8);
  assert.equal(out[(4 * 8 + 4) * 4], 200);
  assert.throws(() => homography(FIELD_CORNERS, [[0, 0], [1, 1], [2, 2], [3, 3]]));
});

test('arc text bends around the circle', () => {
  const r = 20;
  const arc = hersheyArc('HELLO', 4, r);
  assert.ok(arc.paths.length > 5);
  assert.ok(arc.width < 2 * (r + 4) + 0.01);
  const flatWidth = 4 * 5 * 1.0;
  assert.ok(arc.height > 0.5 && arc.width > flatWidth * 0.5);
});

test('batch templates count and fill', () => {
  const spec = { count: 3, start: 7, step: 2, digits: 3, lines: [] };
  assert.equal(batchCount(spec), 3);
  assert.equal(fillTemplate('SN-{n}', batchValues(spec, 2)), 'SN-011');
  const named = { ...spec, lines: ['Ann', 'Bo'] };
  assert.equal(batchCount(named), 2);
  assert.equal(fillTemplate('Hi {line} #{n}', batchValues(named, 1)), 'Hi Bo #009');
  assert.ok(hasPlaceholders('A{n}') && !hasPlaceholders('A'));
});
