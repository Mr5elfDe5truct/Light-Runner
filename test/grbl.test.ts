// GRBL G-code generation, reply parsing, and streaming against a simulated controller.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PROFILE, FIRE_LIMIT_S, fireGcode, frameGcode, gcodeFor, linesToSend, parseGrblSettings, parseGrblStatus, profileFromSettings, programLines, RX_BUFFER } from '../shared/grbl.ts';

const p = { ...DEFAULT_PROFILE, bedW: 400, bedH: 400, maxS: 1000, originBottomLeft: true };

test('outlines become G0/G1 moves with power on the first burn move, Y flipped for a bottom-left origin', () => {
  const g = programLines(gcodeFor([{ kind: 'vector', paths: [[[10, 10], [20, 10], [20, 20]]], power: 50, speed: 1200, passes: 1 }], p));
  assert.deepEqual(g.slice(0, 3), ['G21', 'G90', 'M4 S0']);
  assert.ok(g.includes('F1200'));
  assert.ok(g.includes('G0 X10 Y390'));
  assert.ok(g.includes('G1 X20 Y390 S500'));
  assert.ok(g.includes('G1 X20 Y380'));
  assert.equal(g.at(-2), 'M5 S0');
});

test('passes repeat the moves', () => {
  const one = programLines(gcodeFor([{ kind: 'vector', paths: [[[0, 0], [5, 0]]], power: 10, speed: 600, passes: 1 }], p)).length;
  const three = programLines(gcodeFor([{ kind: 'vector', paths: [[[0, 0], [5, 0]]], power: 10, speed: 600, passes: 3 }], p)).length;
  assert.equal(three - one, 2 * 3);
});

test('rasters scan back and forth with overscan, skipping empty rows, power by shade', () => {
  // 4 x 3 image: row 0 dark in the middle, row 1 empty, row 2 half-grey at the left.
  const W = 255;
  const px = Uint8Array.from([W, 0, 0, W, W, W, W, W, 128, W, W, W]);
  const g = programLines(gcodeFor([{ kind: 'raster', pixels: px, width: 4, height: 3, x: 10, y: 10, pixelMm: 1, power: 100, speed: 3000, passes: 1, overscan: 2 }], p));
  const moves = g.filter((l) => l.startsWith('G0'));
  assert.equal(moves.length, 2 + 1, 'two burning rows plus the final return');
  assert.ok(g.includes('G0 X9 Y389.5'), 'row 0 starts 2 mm before its first dark pixel');
  assert.ok(g.includes('G1 X13 S1000'), 'full burn over the dark run');
  // Row 2 goes the other way (right to left) and is half power.
  assert.ok(g.includes('G0 X13 Y387.5'));
  assert.ok(g.includes('G1 X10 S498'));
});

test('character counting never lets in-flight lines exceed the buffer', () => {
  const lines = programLines(gcodeFor([{ kind: 'vector', paths: [Array.from({ length: 400 }, (_, i) => [i * 0.25, (i % 7) * 1.5] as [number, number])], power: 40, speed: 900, passes: 1 }], p));
  const inFlight: number[] = [];
  let next = 0;
  let maxUsed = 0;
  let oks = 0;
  // Simulated GRBL: answers "ok" for one line per tick.
  while (oks < lines.length) {
    const k = linesToSend(inFlight, lines.slice(next));
    for (let i = 0; i < k; i++) inFlight.push(lines[next++].length + 1);
    maxUsed = Math.max(maxUsed, inFlight.reduce((s, v) => s + v, 0));
    assert.ok(inFlight.length > 0, 'something is always in flight until the end');
    inFlight.shift();
    oks++;
  }
  assert.equal(next, lines.length);
  assert.ok(maxUsed < RX_BUFFER, `peak ${maxUsed}`);
});

test('status and settings replies are read', () => {
  assert.deepEqual(parseGrblStatus('<Run|MPos:10.500,20.000,0.000|FS:1000,0>'), { state: 'Run', x: 10.5, y: 20 });
  assert.deepEqual(parseGrblStatus('<Hold:0|WPos:1,2,3>'), { state: 'Hold:0', x: 1, y: 2 });
  assert.equal(parseGrblStatus('ok'), null);
  const s = parseGrblSettings(['$30=1000', '$32=1', '$130=410.000', '$131=400.000', 'ok']);
  assert.deepEqual(profileFromSettings(s), { bedW: 410, bedH: 400, maxS: 1000, originBottomLeft: true, laserMode: true });
});

test('test fire: beam is one timed burst, strobe repeats, both end with the laser off', () => {
  const beam = programLines(fireGcode({ power: 2, mode: 'beam', seconds: 1.5 }, p));
  assert.deepEqual(beam, ['G21', 'G90', 'M5 S0', 'G1 F1000', 'M3 S20', 'G4 P1.5', 'M5 S0', 'G0']);
  const strobe = programLines(fireGcode({ power: 5, mode: 'strobe', seconds: 2, onMs: 100, offMs: 400 }, p));
  assert.equal(strobe.filter((l) => l.startsWith('M3')).length, 4);
  assert.ok(strobe.includes('G4 P0.1') && strobe.includes('G4 P0.4'));
  assert.equal(strobe.at(-2), 'G4 P0.4');
  assert.equal(strobe.at(-3), 'M5 S0');
  // Never longer than the limit, never zero power.
  const capped = programLines(fireGcode({ power: 0, mode: 'beam', seconds: 999 }, p));
  assert.ok(capped.includes(`G4 P${FIRE_LIMIT_S}`) && capped.includes('M3 S1'));
});

test('the frame goes round the box with the laser off', () => {
  const g = programLines(frameGcode({ x: 10, y: 10, w: 20, h: 5 }, p));
  assert.ok(g.includes('M5 S0'));
  assert.ok(!g.some((l) => / S[1-9]/.test(l)));
  assert.equal(g.filter((l) => l.startsWith('G1')).length, 4);
});
