// Job simulation, air assist, and array layout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gcodeFor, programLines } from '../shared/grbl.ts';
import { headAt, segmentAt, toolpath } from '../shared/simulate.ts';
import { arrayCopies } from '../src/arrayCopies.ts';
import { DEFAULTS, type VectorItem } from '../src/model.ts';

const profile = { bedW: 100, bedH: 100, maxS: 1000, originBottomLeft: false };

test('a square becomes travel then four timed burns, then the trip home', () => {
  const g = gcodeFor([{ kind: 'vector', paths: [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]], power: 50, speed: 600, passes: 1 }], profile);
  const segs = toolpath(g);
  assert.equal(segs[0].burn, 0, 'travel to the start');
  const burns = segs.filter((s) => s.burn > 0);
  assert.equal(burns.length, 4);
  assert.equal(burns[0].burn, 0.5);
  // 10 mm at 600 mm/min = 1 s each.
  assert.ok(Math.abs(burns[0].t1 - burns[0].t0 - 1) < 1e-9);
  assert.equal(segs.at(-1)!.burn, 0, 'the trip home is travel');
  const t = burns[1].t0 + 0.5;
  assert.deepEqual(headAt(segs, t), { x: 20, y: 15 });
  assert.equal(segmentAt(segs, -1), -1);
  // A start point (a G-code laser's home) or the first move (a galvo).
  assert.deepEqual([toolpath(g, 1000, 6000, { x: 0, y: 100 })[0].x0, toolpath(g, 1000, 6000, { x: 0, y: 100 })[0].y0], [0, 100]);
  assert.equal(toolpath(g, 1000, 6000, 'first-move')[0].burn, 0.5, 'no travel when starting at the first point');
  assert.equal(segmentAt(segs, 1e9), segs.length - 1);
});

test('air assist wraps the job in M8/M9, and the trip home can be left out', () => {
  const lines = programLines(gcodeFor([{ kind: 'vector', paths: [[[1, 1], [5, 1]]], power: 10, speed: 600, passes: 1 }], profile, { airAssist: true, returnHome: false }));
  assert.ok(lines.indexOf('M8') > lines.indexOf('M4 S0'));
  assert.ok(lines.indexOf('M9') > lines.indexOf('M5 S0'));
  assert.ok(!lines.includes('G0 X0 Y0'));
});

const item = (x: number, y: number, w: number, h: number): VectorItem => ({
  ...DEFAULTS,
  id: `i${x}${y}`,
  name: 'part',
  kind: 'vector',
  visible: true,
  mode: 'line',
  paths: [[[0, 0], [10, 0]]],
  naturalW: 10,
  naturalH: 10,
  x,
  y,
  w,
  h,
});

test('array copies: rows and columns spaced by the group size plus the gap, originals untouched', () => {
  const copies = arrayCopies([item(10, 10, 10, 5)], 2, 3, 2, 4);
  assert.equal(copies.length, 2 * 3 - 1, 'the original is the first cell');
  const xs = [...new Set(copies.map((c) => c.x))].sort((a, b) => a - b);
  const ys = [...new Set(copies.map((c) => c.y))].sort((a, b) => a - b);
  assert.deepEqual(xs, [10, 22, 34]);
  assert.deepEqual(ys, [10, 19]);
  assert.ok(copies.every((c) => c.id !== 'i1010'));
  // A group keeps its layout in each cell.
  const group = arrayCopies([item(0, 0, 10, 10), item(15, 0, 5, 5)], 1, 2, 5, 0);
  assert.deepEqual(group.map((c) => c.x), [25, 40]);
});
