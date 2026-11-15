/** Test fire for G-code lasers: a steady beam or a strobe, timed by the controller itself. */
import { useEffect, useRef, useState } from 'react';
import { FIRE_LIMIT_S, type FireSpec } from '../shared/grbl.ts';
import { Modal } from './dialogs.tsx';
import { Slider } from './Properties.tsx';

interface Props {
  firing: boolean;
  onStart: (spec: FireSpec) => Promise<void>;
  onStop: () => Promise<void>;
  onClose: () => void;
}

export function FireDialog({ firing, onStart, onStop, onClose }: Props) {
  const [spec, setSpec] = useState<FireSpec>({ power: 2, mode: 'beam', seconds: 1, onMs: 50, offMs: 450 });
  const [safe, setSafe] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!firing && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
      setLeft(null);
    }
  }, [firing]);
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  const start = async () => {
    setError(null);
    const end = Date.now() + spec.seconds * 1000;
    setLeft(spec.seconds);
    timer.current = setInterval(() => setLeft(Math.max(0, (end - Date.now()) / 1000)), 100);
    try {
      await onStart(spec);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const flashes = spec.mode === 'strobe' ? Math.max(1, Math.floor(spec.seconds / (((spec.onMs ?? 50) + (spec.offMs ?? 450)) / 1000))) : 0;
  const n = (key: keyof FireSpec, scale = 1) => (e: React.ChangeEvent<HTMLInputElement>) => setSpec({ ...spec, [key]: Number(e.target.value) * scale });

  return (
    <Modal title="Fire laser (test)" onClose={() => (firing ? undefined : onClose())}>
      <p className="danger-note">
        ⚠ The beam comes on with the head standing still. Wear laser eye protection, point it at a non-flammable scrap (not your hand, not reflective metal), and keep the time short.
        Even a few seconds at high power can burn through material.
      </p>

      <div className="tabs">
        <button className={spec.mode === 'beam' ? 'on' : ''} disabled={firing} onClick={() => setSpec({ ...spec, mode: 'beam' })}>
          Beam (steady)
        </button>
        <button className={spec.mode === 'strobe' ? 'on' : ''} disabled={firing} onClick={() => setSpec({ ...spec, mode: 'strobe', seconds: Math.max(spec.seconds, 2) })}>
          Strobe (pulses)
        </button>
      </div>

      <Slider label="Power %" value={spec.power} min={1} max={100} onChange={(v) => setSpec({ ...spec, power: v })} />
      {spec.power > 10 && <p className="warn">Above 10 % the test fire will burn most materials. For focusing and aiming, 1–3 % is plenty.</p>}

      <div className="grid3">
        <label>
          {spec.mode === 'beam' ? 'On for (s)' : 'Total time (s)'}
          <input type="number" min="0.1" max={FIRE_LIMIT_S} step="0.1" value={spec.seconds} disabled={firing} onChange={n('seconds')} />
        </label>
        {spec.mode === 'strobe' && (
          <>
            <label>
              Each flash (ms)
              <input type="number" min="10" max="2000" step="10" value={spec.onMs} disabled={firing} onChange={n('onMs')} />
            </label>
            <label>
              Gap between (ms)
              <input type="number" min="10" max="5000" step="10" value={spec.offMs} disabled={firing} onChange={n('offMs')} />
            </label>
          </>
        )}
      </div>
      <p className="hint">
        {spec.mode === 'beam'
          ? `A steady beam for ${spec.seconds} s, then off by itself.`
          : `${flashes} flash${flashes === 1 ? '' : 'es'} of ${spec.onMs} ms, ${spec.offMs} ms apart, then off by itself.`}{' '}
        The controller times it, so it switches off even if the app or the cable goes away. Up to {FIRE_LIMIT_S} s.
      </p>

      <label className="check">
        <input type="checkbox" checked={safe} disabled={firing} onChange={(e) => setSafe(e.target.checked)} /> I'm wearing laser eye protection and the head is over a safe scrap
      </label>
      {error && <p className="warn">{error}</p>}

      <div className="buttons">
        <button onClick={onClose} disabled={firing}>
          Close
        </button>
        <button className="danger" onClick={() => onStop().catch((e) => setError((e as Error).message))} disabled={!firing}>
          Stop
        </button>
        <button className="primary" onClick={start} disabled={firing || !safe || !(spec.seconds > 0)}>
          {firing ? `Firing… ${left !== null ? `${left.toFixed(1)} s` : ''}` : 'Start'}
        </button>
      </div>
    </Modal>
  );
}
