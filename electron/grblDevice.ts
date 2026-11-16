/**
 * A GRBL laser over USB serial: streams G-code with character counting, shows progress, and
 * supports hold (pause), resume, stop (feed hold + soft reset) and a laser-off frame for placement.
 */
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { DEFAULT_PROFILE, fireGcode, frameGcode, type FireSpec, GRBL_BAUD, linesToSend, parseGrblSettings, parseGrblStatus, profileFromSettings, programLines, type MachineProfile } from '../shared/grbl.ts';
import type { DeviceInfo, JobSpec, LaserEvent, PreviewSpec, RunPhase } from '../shared/types.ts';

type SerialPortType = import('serialport').SerialPort;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GrblLaser extends EventEmitter {
  private port: SerialPortType | null = null;
  private text = '';
  private lineWaiters: ((line: string) => boolean)[] = [];
  private inFlight: number[] = [];
  private acked = 0;
  private phase: RunPhase = 'idle';
  private stopRequested = false;
  private poller: NodeJS.Timeout | null = null;
  profile: MachineProfile = DEFAULT_PROFILE;
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

  get connected() {
    return !!this.port?.isOpen;
  }

  /** Optional trace of the whole conversation (set LR_GRBL_LOG to a file path). */
  private trace(dir: '>' | '<', text: string) {
    const file = process.env.LR_GRBL_LOG;
    if (!file) return;
    try {
      const shown = text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      appendFileSync(file, `${new Date().toISOString().slice(11, 23)} ${dir} ${shown}\n`);
    } catch {
      // tracing must never break a job
    }
  }

  private lastState = '';
  private lastAlarm = 0; // the code from the last "ALARM:n" line
  private failure: string | null = null; // set when an alarm ends a job early

  /**
   * GRBL refuses commands while in alarm; unlock first ($X). After a limit alarm (1, 2, 10) the
   * machine no longer knows where the head is, so that needs the person: unless `force` (used by
   * Home's "set this spot as 0,0" and the homing cycle, which re-establish the position), refuse.
   */
  private async unlockIfAlarm(force = false) {
    if (!this.lastState.startsWith('Alarm')) return;
    if (!force && [1, 2, 10].includes(this.lastAlarm)) {
      throw new Error(
        `The machine hit a limit (ALARM:${this.lastAlarm}), so it no longer knows where the head is. Move the head clear by hand, then use Home → "Set this spot as 0,0" (or the homing cycle) before running anything.`,
      );
    }
    this.inFlight = [];
    await this.command('$X').catch(() => undefined);
    this.lastState = 'Idle';
    this.lastAlarm = 0;
    this.log('Unlocked the machine ($X).');
  }

  private onLine(line: string) {
    this.trace('<', line);
    if (line.startsWith('<')) {
      const s = parseGrblStatus(line);
      if (s) {
        const state = s.state.startsWith('Hold') ? 'paused' : s.state === 'Run' ? 'engraving' : s.state === 'Idle' ? 'idle' : 'unknown';
        const progress = this.total ? Math.round((this.acked / this.total) * 100) : 0;
        const pos = { x: s.x, y: this.profile.originBottomLeft ? this.profile.bedH - s.y : s.y };
        this.emitEvent({ type: 'status', status: { state, progress, power: 0, depth: 0, fileId: '', pos } });
        if (s.state.startsWith('Alarm') && !this.lastState.startsWith('Alarm')) this.log('The machine is in alarm (locked). Light Runner unlocks it ($X) before the next command.', 'error');
        this.lastState = s.state;
      }
      // Status lines go to anyone waiting for one (the end of a job waits for "Idle").
      for (let i = 0; i < this.lineWaiters.length; i++) {
        if (this.lineWaiters[i](line)) {
          this.lineWaiters.splice(i, 1);
          break;
        }
      }
      return;
    }
    if (line === 'ok' || line.startsWith('error')) {
      this.inFlight.shift();
      this.acked++;
      if (line.startsWith('error')) this.log(`GRBL refused a line (${line}).`, 'error');
    }
    if (line.startsWith('ALARM')) {
      this.lastAlarm = Number(line.split(':')[1]) || 0;
      const meaning: Record<number, string> = { 1: 'hard limit hit', 2: 'move would leave the work area (soft limit)', 3: 'reset while moving', 6: 'homing reset', 8: 'homing could not clear the switch', 9: 'homing found no limit switch', 10: 'limit hit while homing' };
      this.log(`GRBL alarm: ${line}${meaning[this.lastAlarm] ? ` (${meaning[this.lastAlarm]})` : ''}.`, 'error');
      if (this.total) this.failure = `The machine stopped with ${line}${meaning[this.lastAlarm] ? ` (${meaning[this.lastAlarm]})` : ''}.`;
    }
    for (let i = 0; i < this.lineWaiters.length; i++) {
      if (this.lineWaiters[i](line)) {
        this.lineWaiters.splice(i, 1);
        break;
      }
    }
  }

  private total = 0;

  private write(s: string | Buffer): Promise<void> {
    this.trace('>', typeof s === 'string' ? s : `[${[...s].map((b) => b.toString(16)).join(' ')}]`);
    const port = this.port;
    if (!port?.isOpen) return Promise.reject(new Error('Not connected.'));
    return new Promise((resolve, reject) => port.write(s, (e) => (e ? reject(e) : resolve())));
  }

  private waitLine(match: (l: string) => boolean, ms: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.lineWaiters = this.lineWaiters.filter((w) => w !== fn);
        reject(new Error('No answer from GRBL.'));
      }, ms);
      const fn = (l: string) => {
        if (!match(l)) return false;
        clearTimeout(t);
        resolve(l);
        return true;
      };
      this.lineWaiters.push(fn);
    });
  }

  /** Sends a command line and collects the reply lines up to its "ok". */
  private async command(cmd: string, ms = 3000): Promise<string[]> {
    const lines: string[] = [];
    const collector = (l: string) => {
      if (l === 'ok' || l.startsWith('error')) return true;
      if (!l.startsWith('<')) lines.push(l);
      return false;
    };
    const done = this.waitLine(collector, ms);
    this.inFlight.push(cmd.length + 1);
    await this.write(`${cmd}\n`);
    await done;
    return lines;
  }

  async connect(path: string, baud = GRBL_BAUD): Promise<DeviceInfo> {
    const { SerialPort, ReadlineParser } = await import('serialport');
    const port = new SerialPort({ path, baudRate: baud, autoOpen: false });
    await new Promise<void>((resolve, reject) => port.open((e) => (e ? reject(new Error(`Couldn't open ${path}: ${e.message}`)) : resolve())));
    this.port = port;
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (l: string) => this.onLine(l.trim()));
    port.on('close', () => this.onClosed());
    try {
      // Ask for the build info ($I: "[VER:1.1f.20220618:]"). Boards that reset when the port opens
      // (Arduino-style) need a moment first, so try twice. No reset is sent: it would stop a job.
      await sleep(300);
      await this.write('\r\n\r\n');
      await sleep(400);
      this.inFlight = [];
      let info = await this.command('$I', 1500).catch(() => null);
      if (!info?.some((l) => l.startsWith('[VER:'))) {
        await sleep(1500);
        this.inFlight = [];
        info = await this.command('$I', 2000);
      }
      const ver = /\[VER:([^:\]]+)/.exec(info.join('\n'))?.[1];
      if (!ver) throw new Error('It answered, but not like GRBL.');
      const greeting = `GRBL ${ver.split('.').slice(0, 2).join('.')}`;
      await sleep(100);
      this.inFlight = [];
      const settings = parseGrblSettings(await this.command('$$'));
      const prof = profileFromSettings(settings);
      this.profile = prof;
      if (!prof.laserMode) this.log('GRBL laser mode ($32) is off; the laser may stay on during moves. Turn it on with $32=1 in your machine\'s console.', 'error');
      this.info = { path, firmware: greeting.split(' ').slice(0, 2).join(' '), deviceId: null, storedFiles: 0, kind: 'grbl', bed: { w: prof.bedW, h: prof.bedH }, profile: { bedW: prof.bedW, bedH: prof.bedH, maxS: prof.maxS, originBottomLeft: prof.originBottomLeft } };
    } catch (e) {
      await new Promise<void>((r) => port.close(() => r()));
      this.port = null;
      throw new Error(`No GRBL controller answered on ${path}. ${(e as Error).message}`);
    }
    this.emitEvent({ type: 'connection', connected: true, info: this.info });
    this.log(`Connected to ${this.info.firmware} on ${path}: ${this.profile.bedW} × ${this.profile.bedH} mm.`);
    this.poller = setInterval(() => this.port?.isOpen && this.port.write('?'), 300);
    return this.info;
  }

  async disconnect() {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
    const port = this.port;
    if (port?.isOpen) await new Promise<void>((r) => port.close(() => r()));
    this.port = null;
  }

  private onClosed() {
    if (this.poller) clearInterval(this.poller);
    this.port = null;
    this.info = null;
    this.setPhase('idle');
    this.emitEvent({ type: 'connection', connected: false });
  }

  /** Streams a program, keeping GRBL's receive buffer full without overflowing it. */
  private async stream(gcode: string, onProgress?: (done: number, total: number) => void) {
    const lines = programLines(gcode);
    this.total = lines.length;
    this.acked = 0;
    this.inFlight = [];
    let next = 0;
    this.failure = null;
    while (this.acked < lines.length) {
      if (this.stopRequested || !this.connected) return;
      if (this.failure) throw new Error(this.failure);
      const k = linesToSend(this.inFlight, lines.slice(next, next + 64));
      for (let i = 0; i < k; i++) {
        this.inFlight.push(lines[next].length + 1);
        await this.write(`${lines[next++]}\n`);
      }
      onProgress?.(this.acked, lines.length);
      await sleep(k ? 2 : 10);
    }
    // Wait for the motion to finish (give the planner a moment to start moving first).
    await sleep(400);
    for (;;) {
      const s = await this.waitLine((l) => l.startsWith('<'), 3000).catch(() => '');
      if (this.failure) throw new Error(this.failure);
      if (/^<Alarm/.test(s)) throw new Error('The machine went into alarm before the job finished.');
      if (/^<Idle/.test(s) || this.stopRequested || !this.connected) return;
    }
  }

  async run(jobs: JobSpec[]) {
    if (!this.connected) throw new Error('Connect the laser first.');
    await this.unlockIfAlarm();
    this.stopRequested = false;
    try {
      for (const [i, job] of jobs.entries()) {
        if (this.stopRequested) break;
        if (!job.gcode) throw new Error(`${job.name} has no G-code.`);
        this.setPhase('engraving', { job: i + 1, jobs: jobs.length, name: job.name });
        this.log(`Engraving ${job.name}.`);
        await this.stream(job.gcode);
      }
      if (!this.stopRequested) this.log('Finished.');
    } finally {
      this.total = 0;
      this.setPhase('idle');
    }
  }

  async pause() {
    await this.write('!');
    this.setPhase('paused');
  }

  async resume() {
    await this.write('~');
    this.setPhase('engraving');
  }

  /** Feed hold, then soft reset (drops the rest of the program), then unlock. */
  async stop() {
    this.stopRequested = true;
    this.setPhase('stopping');
    await this.write('!').catch(() => undefined);
    await sleep(300);
    await this.write(Buffer.from([0x18])).catch(() => undefined);
    await this.waitLine((l) => /^Grbl /i.test(l), 3000).catch(() => undefined);
    this.inFlight = [];
    await this.command('$X').catch(() => undefined);
    await this.command('M5 S0').catch(() => undefined);
    this.setPhase('idle');
    this.log('Stopped.');
  }

  /** Traces the box with the laser off (spec in 0.1 mm, as for the LP2). */
  async preview(spec: PreviewSpec) {
    if (this.phase !== 'idle') throw new Error('The laser is busy.');
    await this.unlockIfAlarm();
    this.stopRequested = false;
    this.setPhase('previewing');
    this.log('Framing with the laser off.');
    try {
      await this.stream(frameGcode({ x: spec.x / 10, y: spec.y / 10, w: spec.width / 10, h: spec.height / 10 }, this.profile));
      if (!this.stopRequested) this.log('Frame done.');
    } finally {
      this.setPhase('idle');
    }
  }

  async stopPreview() {
    if (this.phase === 'previewing') await this.stop();
  }

  /**
   * "origin": move to 0,0. "zero": make where the head is now 0,0 (work origin).
   * "cycle": the homing cycle ($H), for machines with limit switches.
   */
  async home(how: 'origin' | 'zero' | 'cycle' = 'origin') {
    if (this.phase !== 'idle') throw new Error('The laser is busy.');
    await this.unlockIfAlarm(how !== 'origin');
    this.setPhase('homing');
    try {
      this.inFlight = [];
      if (how === 'zero') {
        await this.command('G10 L20 P1 X0 Y0');
        this.log('This spot is now 0,0 for your jobs.');
      } else if (how === 'origin') {
        this.log('Going to 0,0…');
        await this.stream(['G90', 'M5 S0', 'G0 X0 Y0'].join('\n'));
        this.log('At 0,0.');
      } else {
        this.log('Homing (finding the limit switches)…');
        const reply = await this.command('$H', 90_000);
        if (reply.some((l) => /ALARM|error/i.test(l))) throw new Error(reply.join(' '));
        this.log('Homed: the head is at 0,0.');
      }
    } catch (e) {
      const msg = (e as Error).message;
      await this.unlockIfAlarm().catch(() => undefined);
      if (how === 'cycle' && /ALARM:9|ALARM:8/.test(msg)) throw new Error('Homing found no limit switch (ALARM:9). This machine may not have them: use "Go to 0,0" or "Set this spot as 0,0" instead. The machine has been unlocked.');
      throw new Error(`That didn't finish: ${msg}`);
    } finally {
      this.setPhase('idle');
    }
  }

  /**
   * Jogs the head (GRBL's $J), laser off. Relative moves are in design directions (+y = towards
   * the front, down the screen); `to` moves to a design position. Clamped to the bed.
   */
  async jog(move: { dx?: number; dy?: number; to?: { x: number; y: number } }, feed = 3000) {
    if (this.phase !== 'idle') throw new Error('The laser is busy.');
    await this.unlockIfAlarm();
    const flip = this.profile.originBottomLeft ? -1 : 1;
    let cmd: string;
    if (move.to) {
      const x = Math.max(0, Math.min(this.profile.bedW, move.to.x));
      const yDesign = Math.max(0, Math.min(this.profile.bedH, move.to.y));
      const y = this.profile.originBottomLeft ? this.profile.bedH - yDesign : yDesign;
      cmd = `$J=G90 G21 X${x.toFixed(3)} Y${y.toFixed(3)} F${Math.round(feed)}`;
    } else {
      cmd = `$J=G91 G21 X${(move.dx ?? 0).toFixed(3)} Y${((move.dy ?? 0) * flip).toFixed(3)} F${Math.round(feed)}`;
    }
    this.inFlight = [];
    await this.command(cmd, 5000);
  }

  /** Stops a jog straight away (GRBL's jog-cancel real-time command). */
  async cancelJog() {
    await this.write(Buffer.from([0x85])).catch(() => undefined);
  }

  /** A timed test fire (beam or strobe); the program switches the laser off by itself at the end. */
  async fire(spec: FireSpec) {
    if (this.phase !== 'idle') throw new Error('The laser is busy.');
    await this.unlockIfAlarm();
    this.stopRequested = false;
    this.setPhase('firing');
    this.log(`Test fire: ${spec.mode}, ${spec.power} % for ${spec.seconds} s.`);
    try {
      await this.stream(fireGcode(spec, this.profile));
      if (!this.stopRequested) this.log('Test fire finished; the laser is off.');
    } finally {
      this.setPhase('idle');
    }
  }

  /** Stops a test fire at once (soft reset kills the beam). */
  async stopFire() {
    if (this.phase === 'firing') await this.stop();
  }

  async applySettings() {
    this.log('Device settings are for the LP2; GRBL settings stay in your machine.');
  }
}
