// Geometry, tracing and file importers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Point } from '../shared/lp2.ts';
import { alignToField, insideField, itemBounds, placedPaths, simplifyPath } from '../src/geometry.ts';
import { readDxf, readGcode } from '../src/importers.ts';
import { DEFAULTS, type VectorItem } from '../src/model.ts';
import { shapePaths } from '../src/shapes.ts';
import { GRID_DEFAULTS, gridLayout, steps } from '../src/testGrid.ts';
import { jobWarnings, needsAttendance } from '../src/safety.ts';
import { traceContours } from '../src/trace.ts';

const square = (patch: Partial<VectorItem> = {}): VectorItem => ({
  id: 'a',
  name: 'sq',
  visible: true,
  kind: 'vector',
  mode: 'line',
  paths: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]],
  naturalW: 20,
  naturalH: 20,
  x: 40,
  y: 40,
  w: 20,
  h: 10,
  ...DEFAULTS,
  ...patch,
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('rotating 90 degrees swaps the bounds about the centre', () => {
  const b = itemBounds(square({ rotation: 90 }));
  near(b.x, 45);
  near(b.y, 35);
  near(b.w, 10);
  near(b.h, 20);
  const pts = placedPaths(square({ rotation: 90 }))[0];
  near(pts[0][0], 55); // the top-left corner swings round to the top-right
  near(pts[0][1], 35);
});

test('flips mirror within the box, and alignment uses the rotated bounds', () => {
  const pts = placedPaths(square({ flipX: true }))[0];
  near(pts[0][0], 60);
  near(pts[0][1], 40);
  const item = square({ rotation: 90 });
  const moved = { ...item, ...alignToField(item, 'left') };
  near(itemBounds(moved).x, 0);
  assert.ok(insideField(moved));
  assert.ok(!insideField(square({ x: 95 })));
});

test('Douglas-Peucker keeps corners and drops points along straight edges', () => {
  const line: Point[] = [[0, 0], [1, 0.01], [2, 0], [3, 0], [3, 1], [3, 2]];
  assert.deepEqual(simplifyPath(line, 0.1), [[0, 0], [3, 0], [3, 2]]);
});

test('tracing a filled square gives one closed outline on its pixel edges', () => {
  const w = 12;
  const h = 12;
  const mask = new Uint8Array(w * h);
  for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) mask[y * w + x] = 1;
  const loops = traceContours(mask, w, h);
  assert.equal(loops.length, 1);
  const loop = loops[0];
  assert.deepEqual(loop[0], loop.at(-1));
  const xs = loop.map((p) => p[0]);
  const ys = loop.map((p) => p[1]);
  assert.ok(Math.min(...xs) >= 3.5 && Math.max(...xs) <= 8.5);
  assert.ok(Math.min(...ys) >= 3.5 && Math.max(...ys) <= 8.5);
  assert.ok(loop.length <= 10, `simplified to ${loop.length} points`);
});

test('a ring traces as two outlines', () => {
  const w = 20;
  const h = 20;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - 9.5, y - 9.5);
    mask[y * w + x] = d < 8 && d > 4 ? 1 : 0;
  }
  assert.equal(traceContours(mask, w, h).length, 2);
});

test('DXF lines, circles and closed polylines are read in mm with y flipped', () => {
  const dxf = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0',
    '0', 'CIRCLE', '8', '0', '10', '20', '20', '5', '40', '5',
    '0', 'LWPOLYLINE', '8', '0', '90', '3', '70', '1', '10', '0', '20', '10', '10', '5', '20', '10', '10', '5', '20', '20',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n');
  const out = readDxf(dxf);
  assert.equal(out.paths.length, 3);
  near(out.width, 25);
  near(out.height, 20);
  const poly = out.paths[2];
  assert.deepEqual(poly[0], poly.at(-1), 'closed polyline returns to its start');
});

test('DXF inch drawings are scaled to mm', () => {
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '10', '0', '20', '0', '11', '1', '21', '1', '0', 'ENDSEC'].join('\n');
  const out = readDxf(dxf);
  near(out.width, 25.4);
});

test('G-code: travel splits paths, inches and relative moves are handled', () => {
  const g = ['G21 G90', 'G0 X0 Y0', 'G1 X10 Y0', 'G1 X10 Y10', 'G0 X20 Y0', 'G91', 'G1 X5', 'G1 Y5'].join('\n');
  const out = readGcode(g);
  assert.equal(out.paths.length, 2);
  assert.deepEqual(out.paths[0], [[0, 0], [10, 0], [10, 10]]);
  assert.deepEqual(out.paths[1], [[20, 0], [25, 0], [25, 5]]);
  const inch = readGcode('G20\nG1 X1 Y0');
  near(inch.width, 25.4);
});

test('G-code arcs become points on the circle', () => {
  const out = readGcode('G0 X10 Y0\nG3 X-10 Y0 I-10 J0');
  for (const [x, y] of out.paths[0]) near(Math.hypot(x - 10, y - 0), 10); // shifted by normalize: centre ends at (10, 0)
});

test('the material test grid spreads power and depth and stays in the field', () => {
  const g = gridLayout(GRID_DEFAULTS);
  assert.equal(g.problem, undefined);
  assert.equal(g.cells.length, 25);
  assert.deepEqual([...new Set(g.cells.map((c) => c.power))], [20, 40, 60, 80, 100]);
  assert.deepEqual([...new Set(g.cells.map((c) => c.depth))], [10, 30, 50, 70, 90]);
  for (const c of g.cells) assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.size <= 100 && c.y + c.size <= 100);
  assert.equal(g.labels.length, 10);
  assert.match(gridLayout({ ...GRID_DEFAULTS, cols: 12, cell: 10 }).problem ?? '', /must fit/);
  assert.deepEqual(steps(30, 30, 1), [30]);
});

test('safety checks flag hard burns, long jobs and tiny codes', () => {
  assert.deepEqual(jobWarnings([square()], 60), []);
  const hot = jobWarnings([square({ power: 100, depth: 90 })], 60);
  assert.equal(hot[0].level, 'danger');
  assert.ok(needsAttendance(hot));
  assert.match(jobWarnings([square()], 45 * 60)[0].text, /45 min/);
  assert.match(jobWarnings([square({ name: 'QR: hi', w: 5, h: 5 })], 60)[0].text, /phones/);
  assert.ok(!needsAttendance(jobWarnings([square({ passes: 6 })], 60)));
});

test('every built-in shape fits its box', () => {
  for (const kind of ['square', 'rounded', 'circle', 'polygon', 'star', 'heart'] as const) {
    const s = shapePaths(kind);
    for (const [x, y] of s.paths.flat()) assert.ok(x >= -1e-9 && y >= -1e-9 && x <= s.w + 1e-9 && y <= s.h + 1e-9, kind);
  }
});
