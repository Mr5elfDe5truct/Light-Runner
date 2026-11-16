/**
 * Turns SVG path data ("M10 10 C…") into polylines in one pass.
 * The browser's getPointAtLength starts from the beginning of the path on every call, so sampling
 * a long path that way takes quadratic time: a single CorelDRAW path of a few hundred curves can
 * take minutes. This parser is linear.
 */
export type Pt = [number, number];

const CMD = /[MmZzLlHhVvCcSsQqTtAa]/;
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

class Reader {
  i = 0;
  constructor(private s: string) {}
  private skip() {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i])) this.i++;
  }
  /** The next command letter, or null if a number follows (an implicit repeat). */
  command(): string | null | undefined {
    this.skip();
    if (this.i >= this.s.length) return undefined;
    const c = this.s[this.i];
    if (CMD.test(c)) {
      this.i++;
      return c;
    }
    return null;
  }
  hasNumber(): boolean {
    this.skip();
    return NUM.test(this.s.slice(this.i, this.i + 40));
  }
  number(): number {
    this.skip();
    const m = NUM.exec(this.s.slice(this.i, this.i + 40));
    if (!m) throw new Error(`Bad path data near "${this.s.slice(this.i, this.i + 12)}"`);
    this.i += m[0].length;
    return Number(m[0]);
  }
  /** Arc flags may be written without separators ("a1 1 0 011 1"). */
  flag(): boolean {
    this.skip();
    const c = this.s[this.i];
    if (c !== '0' && c !== '1') throw new Error('Bad arc flag in path data');
    this.i++;
    return c === '1';
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const pieces = (len: number, step: number) => Math.min(1000, Math.max(1, Math.ceil(len / step)));

/** Polylines for some path data, with points about `step` apart along curves (in the path's own units). */
export function flattenPathData(d: string, step: number): Pt[][] {
  const r = new Reader(d);
  const out: Pt[][] = [];
  let line: Pt[] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastCtrl: Pt | null = null; // for S/T reflection
  let lastCmd = '';
  let cmd: string | null | undefined;

  const end = () => {
    if (line.length > 1) out.push(line);
    line = [];
  };
  const to = (p: Pt) => {
    if (!line.length) line.push(cur);
    line.push(p);
    cur = p;
  };
  const cubic = (c1: Pt, c2: Pt, p: Pt) => {
    const p0 = cur;
    const n = pieces(dist(p0, c1) + dist(c1, c2) + dist(c2, p), step);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      to([
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p[1],
      ]);
    }
    lastCtrl = c2;
  };
  const quad = (c: Pt, p: Pt) => {
    const p0 = cur;
    const n = pieces(dist(p0, c) + dist(c, p), step);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      to([u * u * p0[0] + 2 * u * t * c[0] + t * t * p[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p[1]]);
    }
    lastCtrl = c;
  };
  const arc = (rx: number, ry: number, rot: number, large: boolean, sweep: boolean, p: Pt) => {
    const [x0, y0] = cur;
    const [x, y] = p;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry || (x0 === x && y0 === y)) return to(p);
    const phi = (rot * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const x1p = (cos * (x0 - x)) / 2 + (sin * (y0 - y)) / 2;
    const y1p = (-sin * (x0 - x)) / 2 + (cos * (y0 - y)) / 2;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
    const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = pieces(Math.abs(dt) * Math.max(rx, ry), step);
    for (let k = 1; k < n; k++) {
      const t = t1 + (dt * k) / n;
      to([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
    }
    to(p);
  };

  while ((cmd = r.command()) !== undefined) {
    if (cmd === null) {
      // Numbers with no letter repeat the last command (after M they mean L).
      if (!lastCmd || lastCmd === 'Z' || lastCmd === 'z') throw new Error('Path data must start with M');
      cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
    }
    const rel = cmd === cmd.toLowerCase();
    const P = (): Pt => {
      const x = r.number();
      const y = r.number();
      return rel ? [cur[0] + x, cur[1] + y] : [x, y];
    };
    const C = cmd.toUpperCase();
    // Remember the control point only across a C/S (or Q/T) run, as the spec says.
    const keepCtrl = (C === 'S' && 'CS'.includes(lastCmd.toUpperCase())) || (C === 'T' && 'QT'.includes(lastCmd.toUpperCase()));
    const reflected: Pt = keepCtrl && lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
    if (C !== 'S' && C !== 'C' && C !== 'Q' && C !== 'T') lastCtrl = null;
    switch (C) {
      case 'M': {
        end();
        cur = P();
        start = cur;
        break;
      }
      case 'L':
        to(P());
        break;
      case 'H': {
        const x = r.number();
        to([rel ? cur[0] + x : x, cur[1]]);
        break;
      }
      case 'V': {
        const y = r.number();
        to([cur[0], rel ? cur[1] + y : y]);
        break;
      }
      case 'C': {
        const c1 = P();
        const c2 = P();
        cubic(c1, c2, P());
        break;
      }
      case 'S': {
        const c2 = P();
        cubic(reflected, c2, P());
        break;
      }
      case 'Q': {
        const c = P();
        quad(c, P());
        break;
      }
      case 'T':
        quad(reflected, P());
        break;
      case 'A': {
        const rx = r.number();
        const ry = r.number();
        const rot = r.number();
        const large = r.flag();
        const sweep = r.flag();
        arc(rx, ry, rot, large, sweep, P());
        break;
      }
      case 'Z':
        if (line.length) to(start);
        end();
        cur = start;
        break;
    }
    lastCmd = cmd;
  }
  end();
  return out;
}
