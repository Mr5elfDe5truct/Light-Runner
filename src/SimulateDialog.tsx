/** Simulate: the job's path played back on the design, before anything fires. */
import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../shared/estimate.ts';
import { gcodeFor } from '../shared/grbl.ts';
import { headAt, segmentAt, toolpath, type Segment } from '../shared/simulate.ts';
import { Modal } from './dialogs.tsx';
import { opFor } from './grblJobs.ts';
import { FIELD, type Item } from './model.ts';

const SIZE = 620;
const SPEEDS = [1, 2, 5, 10, 25, 50, 100];

/** LP2 speeds from its measured timings: outlines (101 - depth) x 2 mm/s, rasters ~45 mm/s. */
const lp2Speed = (i: Item) => (i.kind === 'vector' && i.mode === 'line' ? (101 - i.depth) * 2 * 60 : 2700);

export function SimulateDialog({ items, machine, onClose }: { items: Item[]; machine: 'lp2' | 'grbl'; onClose: () => void }) {
  const [segs, setSegs] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(10);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(-1); // the last segment fully drawn
  const total = segs?.length ? segs[segs.length - 1].t1 : 0;
  const scale = SIZE / Math.max(FIELD.w, FIELD.h);

  useEffect(() => {
    (async () => {
      const ops = [];
      for (const i of items) ops.push(await opFor(machine === 'grbl' ? i : { ...i, speed: lp2Speed(i) }));
      // Design coordinates throughout; a G-code laser starts and ends at its home (front left,
      // the bottom of the design), the LP2 at its first point.
      const g = gcodeFor(ops, { bedW: FIELD.w, bedH: FIELD.h, maxS: 1000, originBottomLeft: false }, { returnHome: false });
      if (machine === 'grbl') {
        const home = { x: 0, y: FIELD.h };
        const segs = toolpath(g, 1000, 6000, home);
        const last = segs.at(-1);
        if (last) {
          const len = Math.hypot(home.x - last.x1, home.y - last.y1);
          segs.push({ x0: last.x1, y0: last.y1, x1: home.x, y1: home.y, burn: 0, t0: last.t1, t1: last.t1 + (len / 6000) * 60 });
        }
        setSegs(segs);
      } else {
        setSegs(toolpath(g, 1000, 60000, 'first-move'));
      }
    })().catch((e) => setError((e as Error).message));
  }, []);

  // Playback clock.
  useEffect(() => {
    if (!playing || !segs) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((cur) => {
        const next = Math.min(total, cur + dt * speed);
        if (next >= total) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, segs, total]);

  // Drawing: burned lines accumulate; going back in time redraws from the start.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !segs) return;
    const ctx = c.getContext('2d')!;
    const upTo = segmentAt(segs, t);
    const redraw = upTo < drawn.current;
    if (redraw || drawn.current === -1) {
      ctx.fillStyle = '#f7f7f4';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = '#d9dbe0';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, FIELD.w * scale - 1, FIELD.h * scale - 1);
      drawn.current = -1;
    }
    ctx.lineCap = 'round';
    for (let i = drawn.current + 1; i < upTo; i++) drawSeg(ctx, segs[i], 1, scale);
    drawn.current = Math.max(drawn.current, upTo - 1);
    // The segment in progress and the head go on a top layer.
    const top = c.nextElementSibling as HTMLCanvasElement | null;
    if (top) {
      const tctx = top.getContext('2d')!;
      tctx.clearRect(0, 0, top.width, top.height);
      if (upTo >= 0) {
        const s = segs[upTo];
        const k = s.t1 > s.t0 ? Math.min(1, (t - s.t0) / (s.t1 - s.t0)) : 1;
        drawSeg(tctx, { ...s, x1: s.x0 + (s.x1 - s.x0) * k, y1: s.y0 + (s.y1 - s.y0) * k }, 1, scale);
      }
      const h = headAt(segs, t);
      tctx.fillStyle = upTo >= 0 && segs[upTo].burn > 0 ? '#ff4d2e' : '#3d8bff';
      tctx.beginPath();
      tctx.arc(h.x * scale, h.y * scale, 4, 0, Math.PI * 2);
      tctx.fill();
    }
  }, [t, segs]);

  const burnTime = segs?.filter((s) => s.burn > 0).reduce((a, s) => a + s.t1 - s.t0, 0) ?? 0;

  return (
    <Modal title="Simulate" onClose={onClose}>
      <p className="hint">The path the laser will follow, played back. Burns are dark; moves with the laser off are faint blue. Nothing is sent to the laser.</p>
      <div className="sim-stage" style={{ width: FIELD.w * scale, height: FIELD.h * scale }}>
        <canvas ref={canvas} width={FIELD.w * scale} height={FIELD.h * scale} />
        <canvas width={FIELD.w * scale} height={FIELD.h * scale} className="sim-top" />
        {!segs && !error && <div className="sim-wait">Working out the path…</div>}
      </div>
      {error && <p className="warn">{error}</p>}
      <input type="range" min={0} max={Math.max(0.001, total)} step={total / 1000 || 0.001} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} />
      <div className="row">
        <button className="primary" disabled={!segs} onClick={() => (t >= total ? (setT(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? 'Pause' : t >= total ? 'Replay' : 'Play'}
        </button>
        <label className="row" style={{ alignItems: 'center' }}>
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <span className="grow" />
        <span className="hint">
          {formatDuration(t)} of {formatDuration(total)} · burning {formatDuration(burnTime)}
          {machine === 'lp2' ? ' (LP2 times are estimates)' : ''}
        </span>
      </div>
      <div className="buttons">
        <button onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function drawSeg(ctx: CanvasRenderingContext2D, s: Segment, alpha: number, scale: number) {
  ctx.beginPath();
  ctx.moveTo(s.x0 * scale, s.y0 * scale);
  ctx.lineTo(s.x1 * scale, s.y1 * scale);
  if (s.burn > 0) {
    ctx.strokeStyle = `rgba(30, 20, 15, ${(0.35 + 0.65 * s.burn) * alpha})`;
    ctx.lineWidth = 1.6;
  } else {
    ctx.strokeStyle = `rgba(61, 139, 255, ${0.25 * alpha})`;
    ctx.lineWidth = 0.8;
  }
  ctx.stroke();
}
