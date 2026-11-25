/** The LP2 driver against a pretend LP2, including the slow and silent ones. Nothing here touches a real port. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Laser, type PortOpener } from '../electron/device.ts';
import * as lp2 from '../shared/lp2.ts';
import type { JobSpec } from '../shared/types.ts';

interface Behaviour {
  idleDelay?: number; // leaving a preview
  announceDelay?: number;
  closeHangs?: boolean;
}

class FakeLp2 extends EventEmitter {
  isOpen = true;
  sent: { at: number; kind: string }[] = [];
  behave: Behaviour;
  private expecting = 0;
  private fileSize = 0;
  private state = [0x06, 0x00];

  constructor(behave: Behaviour = {}) {
    super();
    this.behave = behave;
  }

  private reply(payloads: number[][], ms = 2) {
    setTimeout(() => this.emit('data', Buffer.concat(payloads.map((p) => Buffer.from(lp2.frame(p))))), ms);
  }

  write(data: Buffer, cb: (e?: Error | null) => void) {
    setImmediate(() => cb());
    if (this.expecting > 0) {
      this.sent.push({ at: Date.now(), kind: 'data' });
      this.expecting -= data.length;
      // As captured: both frames arrive glued together.
      if (this.expecting <= 0) this.reply([[0x05, 0x02, 0x01, 0, 0, 0], [0xff, 0x01, 0, 0, this.fileSize >> 8, this.fileSize & 0xff]]);
      return true;
    }
    const p = lp2.takeFrames(new Uint8Array(data)).frames[0];
    const kind = lp2.hex(p.slice(0, 2));
    this.sent.push({ at: Date.now(), kind });
    if (kind === '00 03') this.reply([[0, 0x01, 0x79, 0, 0, 0]]);
    else if (kind === '00 05') this.reply([[0, 0xdc, 0x0d, 0x30, 0x11, 0xbf, 0x1f]]);
    else if (kind === '00 01') this.reply([[0, 0, ...new Array(126).fill(0xff)]]);
    else if (kind === '00 00') {
      this.reply([[0, ...this.state, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
      if (this.state[0] === 1) this.state = [0x01, 0x03];
    } else if (kind === 'ff 00') {
      this.state = [0x06, 0x00];
      this.reply([[0xff, 0, 0, 0, 0, 0]], this.behave.idleDelay);
    } else if (kind === '02 02') {
      this.state = [0x02, 0x02];
      this.reply([[0x02, 0x02, 0, 1, 0, 0]]);
    } else if (kind === '05 01') {
      this.fileSize = this.expecting = (p[2] << 24) | (p[3] << 16) | (p[4] << 8) | p[5];
      this.reply([[0x05, 0x01, 0x01, 0, 0, 0]], this.behave.announceDelay);
    } else if (kind === '01 01') {
      this.state = [0x01, 0x01];
      this.reply([[0x01, 0x01, 0, 0, 0, 0]]);
    }
    return true;
  }

  drain(cb: (e?: Error | null) => void) {
    setImmediate(() => cb());
  }

  close(cb?: () => void) {
    if (this.behave.closeHangs) return;
    this.isOpen = false;
    this.emit('close');
    cb?.();
  }
}

const job = (): JobSpec => ({ name: 'test', file: new Uint8Array(3000), power: 10, depth: 10, passes: 1, xMm: 0, yMm: 0, dithered: false });

async function connected(behave: Behaviour = {}) {
  const port = new FakeLp2();
  const laser = new Laser((async () => port) as unknown as PortOpener);
  await laser.connect('COM-test');
  port.behave = behave;
  return { port, laser };
}

test('after tracing the field, a laser that is slow to stop the light can still engrave', async () => {
  const { port, laser } = await connected({ idleDelay: 2600 });
  await laser.preview({ x: 0, y: 0, width: 1000, height: 1000, brightness: 1 });
  await laser.stopPreview();
  port.behave = { announceDelay: 2600 }; // and slow to make room for the file
  await laser.run([job()]);
  assert.ok(port.sent.some((s) => s.kind === '01 01'));
  await laser.disconnect();
});

test('the engrave command waits about a second after the upload, as LDS does', async () => {
  const { port, laser } = await connected();
  await laser.run([job()]);
  const at = port.sent.findIndex((s) => s.kind === '01 01');
  assert.ok(port.sent[at].at - port.sent[at - 1].at >= 1000);
  await laser.disconnect();
});

test('Stop during an upload sends nothing into the file, and never starts the job', async () => {
  const { port, laser } = await connected();
  const running = laser.run([job()]);
  while (!port.sent.some((s) => s.kind === 'data')) await new Promise((r) => setTimeout(r, 5));
  await laser.stop();
  await running;
  const data = port.sent.map((s, i) => (s.kind === 'data' ? i : -1)).filter((i) => i >= 0);
  assert.equal(data.at(-1)! - data[0], data.length - 1);
  assert.ok(!port.sent.some((s) => s.kind === '01 01'));
  await laser.disconnect();
});

test('a port that will not close does not hang disconnecting', async () => {
  const { laser } = await connected({ closeHangs: true });
  await laser.disconnect();
  assert.equal(laser.connected, false);
  assert.equal(laser.stuck, true);
});
