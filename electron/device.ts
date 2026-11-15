/**
 * Talks to the LP2 over its USB serial port, in the order LaserPecker Design Space does:
 * idle, announce the file, send it raw, idle, engrave, then poll status until it's finished.
 */
import { EventEmitter } from 'node:events';
import * as lp2 from '../shared/lp2.ts';
import type { DeviceInfo, JobSpec, LaserEvent, PortInfo, PreviewSpec, RunPhase } from '../shared/types.ts';

type SerialPortType = import('serialport').SerialPort;

const POLL_MS = 1000;
const CHUNK = 2048; // LDS sends files in 2 KB pieces about 100 ms apart
const CHUNK_GAP_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Waiter {
  match: (p: Uint8Array) => boolean;
  resolve: (p: Uint8Array) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class Laser extends EventEmitter {
  private port: SerialPortType | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  private waiters: Waiter[] = [];
  private lock: Promise<unknown> = Promise.resolve();
  private poller: NodeJS.Timeout | null = null;
  private phase: RunPhase = 'idle';
  private stopRequested = false;
  info: DeviceInfo | null = null;

  private emitEvent(e: LaserEvent) {
    this.emit('event', e);
  }

  private log(message: string, level: 'info' | 'error' = 'info') {
    this.emitEvent({ type: 'log', level, message });
  }

  private setPhase(phase: RunPhase, extra: Omit<Extract<LaserEvent, { type: 'run' }>, 'type' | 'phase'> = {}) {
    this.phase = phase;
    this.emitEvent({ type: 'run', phase, ...extra });
  }

  async ports(): Promise<PortInfo[]> {
    const { SerialPort } = await import('serialport');
    const list = await SerialPort.list();
    return list.map((p) => {
      const likelyLp2 = p.vendorId?.toLowerCase() === lp2.USB_ID.vendorId && p.productId?.toLowerCase() === lp2.USB_ID.productId;
      return { path: p.path, label: `${p.path}${p.friendlyName ? ` (${p.friendlyName.replace(/\s*\(COM\d+\)/, '')})` : ''}`, likelyLp2 };
    });
  }

  get connected() {
    return !!this.port?.isOpen;
  }

  async connect(path: string): Promise<DeviceInfo> {
    await this.disconnect();
    const { SerialPort } = await import('serialport');
    const port = new SerialPort({ path, baudRate: lp2.BAUD, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false });
    await new Promise<void>((resolve, reject) => port.open((e) => (e ? reject(new Error(`Couldn't open ${path}: ${e.message}. Is LaserPecker Design Space using it?`)) : resolve())));
    await new Promise<void>((resolve) => port.set({ dtr: true, rts: true }, () => resolve()));
    this.port = port;
    this.buffer = new Uint8Array(0);
    port.on('data', (chunk: Buffer) => this.onData(chunk));
    port.on('close', () => this.onClosed());
    port.on('error', (e) => this.log(`Serial error: ${e.message}`, 'error'));
    await sleep(200);

    try {
      const firmware = lp2.parseFirmware(await this.ask(lp2.query(lp2.QUERY.firmware), (p) => p[0] === 0x00 && p.length < 12));
      const idReply = await this.ask(lp2.query(lp2.QUERY.deviceId), (p) => p[0] === 0x00 && p.length < 12).catch(() => null);
      const files = lp2.parseFileList(await this.ask(lp2.query(lp2.QUERY.files), (p) => p[0] === 0x00 && p.length > 100, 3000));
      this.info = { path, firmware, deviceId: idReply ? lp2.hex(idReply.slice(4, 7), '').toUpperCase() : null, storedFiles: files.length };
    } catch (e) {
      await this.disconnect();
      throw new Error(`The device on ${path} didn't answer like an LP2. ${(e as Error).message}`);
    }
    this.emitEvent({ type: 'connection', connected: true, info: this.info });
    this.log(`Connected to LP2${this.info.deviceId ? `-${this.info.deviceId}` : ''} on ${path}, firmware ${this.info.firmware ?? 'unknown'}.`);
    this.startPolling();
    return this.info;
  }

  async disconnect() {
    this.stopPolling();
    const port = this.port;
    this.port = null;
    if (port?.isOpen) await new Promise<void>((r) => port.close(() => r()));
  }

  private onClosed() {
    this.stopPolling();
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error('The serial port closed.'));
    }
    this.port = null;
    this.info = null;
    this.setPhase('idle');
    this.emitEvent({ type: 'connection', connected: false });
  }

  private onData(chunk: Buffer) {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    const { frames, rest } = lp2.takeFrames(merged);
    this.buffer = rest.length > 4096 ? rest.slice(-4096) : rest;
    for (const f of frames) {
      const i = this.waiters.findIndex((w) => w.match(f));
      if (i >= 0) {
        const [w] = this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(f);
      }
    }
  }

  private write(data: Uint8Array): Promise<void> {
    const port = this.port;
    if (!port?.isOpen) return Promise.reject(new Error('Not connected.'));
    return new Promise((resolve, reject) => port.write(Buffer.from(data), (e) => (e ? reject(e) : port.drain(() => resolve()))));
  }

  private waitFor(match: (p: Uint8Array) => boolean, timeoutMs: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        match,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((x) => x !== w);
          reject(new Error('The laser didn\'t answer in time.'));
        }, timeoutMs),
      };
      this.waiters.push(w);
    });
  }

  /** Sends a command and waits for the reply that matches, one exchange at a time. */
  private ask(command: Uint8Array, match: (p: Uint8Array) => boolean, timeoutMs = 2000): Promise<Uint8Array> {
    const go = async () => {
      const reply = this.waitFor(match, timeoutMs);
      await this.write(command);
      return reply;
    };
    const next = this.lock.then(go, go);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private startPolling() {
    this.stopPolling();
    this.poller = setInterval(() => {
      if (!this.connected || this.phase === 'uploading') return;
      this.status().catch(() => undefined);
    }, POLL_MS);
  }

  private stopPolling() {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  async status(): Promise<lp2.Status | null> {
    const reply = await this.ask(lp2.query(lp2.QUERY.status), (p) => p[0] === 0x00 && p.length >= 15 && p.length < 64);
    const status = lp2.parseStatus(reply);
    if (status) this.emitEvent({ type: 'status', status });
    return status;
  }

  private idle() {
    return this.ask(lp2.idle(), (p) => p[0] === 0xff);
  }

  /** Uploads and engraves each job in turn, as LDS does with several objects. */
  async run(jobs: JobSpec[]) {
    if (!this.connected) throw new Error('Connect the laser first.');
    if (this.phase !== 'idle') throw new Error('The laser is busy.');
    this.stopRequested = false;
    try {
      for (const [i, job] of jobs.entries()) {
        if (this.stopRequested) break;
        await this.runOne(job, i + 1, jobs.length);
      }
      if (!this.stopRequested) this.log(jobs.length > 1 ? `All ${jobs.length} jobs finished.` : 'Finished.');
    } finally {
      this.setPhase('idle');
    }
  }

  private async runOne(job: JobSpec, n: number, total: number) {
    const fileId = job.file.slice(5, 9);
    const where = { job: n, jobs: total, name: job.name };
    this.setPhase('uploading', { ...where, uploaded: 0, size: job.file.length });
    await this.idle();
    const ready = await this.ask(lp2.announceFile(job.file.length), (p) => p[0] === 0x05 && p[1] === 0x01);
    if (ready[2] !== 0x01) throw new Error('The laser refused the file.');
    const received = this.waitFor((p) => p[0] === 0x05 && p[1] === 0x02, 15_000 + job.file.length / 5);
    for (let at = 0; at < job.file.length; at += CHUNK) {
      await this.write(job.file.slice(at, at + CHUNK));
      this.setPhase('uploading', { ...where, uploaded: Math.min(at + CHUNK, job.file.length), size: job.file.length });
      if (at + CHUNK < job.file.length) await sleep(CHUNK_GAP_MS);
    }
    await received;
    await this.idle();
    if (this.stopRequested) return;

    await this.ask(
      lp2.engrave({ fileId, power: job.power, depth: job.depth, xMm: job.xMm, yMm: job.yMm, passes: job.passes, dithered: job.dithered }),
      (p) => p[0] === 0x01 && p[1] === 0x01,
    );
    this.setPhase('engraving', where);
    this.log(`Engraving ${job.name}: power ${job.power} %, depth ${job.depth}, ${job.passes} pass${job.passes === 1 ? '' : 'es'}.`);

    // Wait until the laser says it's done (the poller keeps the UI updated meanwhile).
    for (;;) {
      await sleep(POLL_MS);
      if (!this.connected) throw new Error('The laser disconnected during the job.');
      const s = await this.status().catch(() => null);
      if (!s) continue;
      if (s.state === 'paused' && this.phase !== 'paused') this.setPhase('paused', where);
      if ((s.state === 'engraving' || s.state === 'resumed') && this.phase === 'paused') this.setPhase('engraving', where);
      if (s.state === 'finished' || s.state === 'done' || s.state === 'idle') break;
    }
    await this.idle();
  }

  async pause() {
    await this.ask(lp2.pause(), (p) => p[0] === 0x01 && p[1] === 0x04);
    this.setPhase('paused');
  }

  async resume() {
    await this.ask(lp2.resume(), (p) => p[0] === 0x01 && p[1] === 0x02);
    this.setPhase('engraving');
  }

  /** Stops a job or a preview straight away. */
  async stop() {
    this.stopRequested = true;
    if (this.phase !== 'idle') this.setPhase('stopping');
    await this.idle();
    this.log('Stopped.');
  }

  async preview(spec: PreviewSpec) {
    if (this.phase !== 'idle' && this.phase !== 'previewing') throw new Error('The laser is busy.');
    const clamp = (v: number) => Math.max(0, Math.round(v));
    await this.ask(lp2.preview(Math.max(1, clamp(spec.width)), Math.max(1, clamp(spec.height)), clamp(spec.x), clamp(spec.y), spec.brightness), (p) => p[0] === 0x02 && p[1] === 0x02);
    this.setPhase('previewing');
  }

  async stopPreview() {
    await this.idle();
    this.setPhase('idle');
  }

  async applySettings(s: lp2.DeviceSettings) {
    await this.ask(lp2.settings(s), (p) => p[0] === 0x06 && p[1] === 0x01);
  }
}
