/** Picks the right driver for the laser that's plugged in: LaserPecker LP2, or a GRBL laser. */
import { EventEmitter } from 'node:events';
import type { FireSpec } from '../shared/grbl.ts';
import type { DeviceSettings } from '../shared/lp2.ts';
import type { DeviceInfo, JobSpec, MachineKind, PreviewSpec } from '../shared/types.ts';
import { Laser } from './device.ts';
import { GrblLaser } from './grblDevice.ts';

export class Machines extends EventEmitter {
  private lp2 = new Laser();
  private grbl = new GrblLaser();
  private current: Laser | GrblLaser = this.lp2;

  constructor() {
    super();
    for (const d of [this.lp2, this.grbl]) d.on('event', (e) => this.emit('event', e));
  }

  /** The USB driver is holding the port open: a normal exit could hang. */
  get stuck() {
    return this.lp2.stuck;
  }

  get connected() {
    return this.current.connected;
  }

  /** The connected laser, if any (for a window that was reloaded). */
  get info() {
    return this.current.connected ? this.current.info : null;
  }

  ports() {
    return this.lp2.ports();
  }

  /**
   * "auto" asks GRBL first ("$I" at 115200: harmless to an LP2, which only acts on checksummed
   * frames), then tries the LP2's handshake.
   */
  async connect(path: string, kind: MachineKind | 'auto' = 'auto'): Promise<DeviceInfo> {
    await this.disconnect();
    if (kind === 'grbl' || kind === 'auto') {
      try {
        const info = await this.grbl.connect(path);
        this.current = this.grbl;
        return info;
      } catch (e) {
        await this.grbl.disconnect().catch(() => undefined);
        if (kind === 'grbl') throw e;
      }
    }
    try {
      const info = await this.lp2.connect(path);
      this.current = this.lp2;
      return info;
    } catch (e) {
      throw new Error(kind === 'auto' ? `Neither a GRBL laser nor an LP2 answered on ${path}. Is another program using it?` : (e as Error).message);
    }
  }

  async disconnect() {
    await this.current.disconnect();
  }

  run(jobs: JobSpec[]) {
    return this.current.run(jobs);
  }
  pause() {
    return this.current.pause();
  }
  resume() {
    return this.current.resume();
  }
  stop() {
    return this.current.stop();
  }
  preview(spec: PreviewSpec) {
    return this.current.preview(spec);
  }
  stopPreview() {
    return this.current.stopPreview();
  }
  private grblOnly(what: string): GrblLaser {
    if (this.current !== this.grbl || !this.grbl.connected) throw new Error(`${what} is for G-code lasers; the LP2 has no moving head or test-fire command.`);
    return this.grbl;
  }
  home(how: 'origin' | 'zero' | 'cycle' = 'origin') {
    return this.grblOnly('Homing').home(how);
  }
  fire(spec: FireSpec) {
    return this.grblOnly('Test fire').fire(spec);
  }
  jog(move: { dx?: number; dy?: number; to?: { x: number; y: number } }, feed?: number) {
    return this.grblOnly('Jogging').jog(move, feed);
  }
  cancelJog() {
    return this.current === this.grbl ? this.grbl.cancelJog() : Promise.resolve();
  }
  stopFire() {
    return this.current === this.grbl ? this.grbl.stopFire() : Promise.resolve();
  }
  applySettings(s: DeviceSettings) {
    return this.current === this.lp2 ? this.lp2.applySettings(s) : this.grbl.applySettings();
  }
}
