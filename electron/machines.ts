/** Picks the right driver for the laser that's plugged in: LaserPecker LP2, or a GRBL laser. */
import { EventEmitter } from 'node:events';
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

  get connected() {
    return this.current.connected;
  }

  ports() {
    return this.lp2.ports();
  }

  /** "auto" tries the LP2's handshake first, then GRBL. */
  async connect(path: string, kind: MachineKind | 'auto' = 'auto'): Promise<DeviceInfo> {
    await this.disconnect();
    if (kind === 'lp2' || kind === 'auto') {
      try {
        const info = await this.lp2.connect(path);
        this.current = this.lp2;
        return info;
      } catch (e) {
        await this.lp2.disconnect().catch(() => undefined);
        if (kind === 'lp2') throw e;
      }
    }
    try {
      const info = await this.grbl.connect(path);
      this.current = this.grbl;
      return info;
    } catch (e) {
      throw new Error(kind === 'auto' ? `Neither an LP2 nor a GRBL laser answered on ${path}. Is another program using it?` : (e as Error).message);
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
  applySettings(s: DeviceSettings) {
    return this.current === this.lp2 ? this.lp2.applySettings(s) : this.grbl.applySettings();
  }
}
