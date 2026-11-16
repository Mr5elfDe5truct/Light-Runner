import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenPathData, type Pt } from '../shared/svgPath.ts';

const near = (a: Pt, b: Pt, tol = 1e-6) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < tol, `${a} is not near ${b}`);

test('lines, relative moves, H/V and Z make closed sub-paths', () => {
  const p = flattenPathData('M0 0 H10 V10 h-10 z m20 0 l5 0 5 5', 1);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  assert.deepEqual(p[1], [[20, 0], [25, 0], [30, 5]]);
});

test('implicit lineto after M, compact numbers and exponents', () => {
  const p = flattenPathData('M1-1 2,2.5.5 1e1', 1);
  assert.deepEqual(p[0], [[1, -1], [2, 2.5], [0.5, 10]]);
});

test('cubic and smooth cubic curves end where they should, sampled by step', () => {
  const [c] = flattenPathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 0.5);
  near(c[0], [0, 0]);
  near(c[c.length - 1], [20, 0]);
  assert.ok(c.length > 30, `only ${c.length} points`);
  // The S curve mirrors the first one, so it dips below the line.
  assert.ok(c.some(([x, y]) => x > 10 && y < -5));
});

test('quadratic and smooth quadratic', () => {
  const [q] = flattenPathData('M0 0 Q5 10 10 0 T20 0', 0.5);
  near(q[q.length - 1], [20, 0]);
  assert.ok(q.some(([x, y]) => x > 10 && y < -2));
});

test('arcs: a half circle stays on its circle, and compact flags parse', () => {
  const [a] = flattenPathData('M0 0 A5 5 0 0 1 10 0', 0.2);
  near(a[a.length - 1], [10, 0]);
  for (const [x, y] of a) assert.ok(Math.abs(Math.hypot(x - 5, y) - 5) < 1e-6);
  const [b] = flattenPathData('M0 0a5 5 0 1110 0', 0.2);
  near(b[b.length - 1], [10, 0]);
});

test('a long CorelDRAW-style path with hundreds of curves is quick', () => {
  let d = 'M0 0';
  for (let i = 0; i < 5000; i++) d += ` c${i % 7},${i % 5} ${i % 3},${-(i % 4)} ${(i % 9) + 1},${(i % 2) - 0.5}`;
  const t = performance.now();
  const p = flattenPathData(d, 1);
  assert.ok(performance.now() - t < 1000);
  assert.equal(p.length, 1);
});
