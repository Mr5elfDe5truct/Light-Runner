/** The Array dialog and the jog pad. */
import { useState } from 'react';
import { Modal } from './dialogs.tsx';
import { boundsOf } from './geometry.ts';
import { FIELD, type Item } from './model.ts';

export function ArrayDialog({ items, onCancel, onMake }: { items: Item[]; onCancel: () => void; onMake: (rows: number, cols: number, gapX: number, gapY: number) => void }) {
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(3);
  const [gapX, setGapX] = useState(5);
  const [gapY, setGapY] = useState(5);
  const b = boundsOf(items)!;
  const w = cols * b.w + (cols - 1) * gapX;
  const h = rows * b.h + (rows - 1) * gapY;
  const fits = b.x + w <= FIELD.w + 1e-6 && b.y + h <= FIELD.h + 1e-6;
  const num = (set: (v: number) => void, min: number) => (e: React.ChangeEvent<HTMLInputElement>) => set(Math.max(min, Number(e.target.value) || min));
  return (
    <Modal title="Array: copies in rows and columns" onClose={onCancel}>
      <p className="hint">
        Copies the selection ({items.length} item{items.length === 1 ? '' : 's'}, {b.w.toFixed(1)} × {b.h.toFixed(1)} mm) into a grid, starting where it is now. Handy for engraving a batch of parts in one go.
      </p>
      <div className="grid3">
        <label>
          Rows
          <input type="number" min="1" max="50" value={rows} onChange={num(setRows, 1)} />
        </label>
        <label>
          Columns
          <input type="number" min="1" max="50" value={cols} onChange={num(setCols, 1)} />
        </label>
        <span />
        <label>
          Gap across (mm)
          <input type="number" min="0" step="0.5" value={gapX} onChange={num(setGapX, 0)} />
        </label>
        <label>
          Gap down (mm)
          <input type="number" min="0" step="0.5" value={gapY} onChange={num(setGapY, 0)} />
        </label>
      </div>
      <p className={fits ? 'hint' : 'warn'}>
        {rows * cols} in all, {w.toFixed(1)} × {h.toFixed(1)} mm.{fits ? '' : ' That runs past the edge of the work area: use fewer, smaller gaps, or move the selection up and left first.'}
      </p>
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={rows * cols < 2} onClick={() => onMake(rows, cols, gapX, gapY)}>
          Make {rows * cols - 1} cop{rows * cols - 1 === 1 ? 'y' : 'ies'}
        </button>
      </div>
    </Modal>
  );
}

const STEPS = [0.1, 1, 10, 50];

export function JogPad({ pos, busy, canGoToSelection, onJog, onGoTo, onGoToSelection, onClose }: {
  pos: { x: number; y: number } | null;
  busy: boolean;
  canGoToSelection: boolean;
  onJog: (dx: number, dy: number) => void;
  onGoTo: (x: number, y: number) => void;
  onGoToSelection: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(10);
  const btn = (label: string, dx: number, dy: number, title: string) => (
    <button disabled={busy} onClick={() => onJog(dx * step, dy * step)} title={title} aria-label={title}>
      {label}
    </button>
  );
  return (
    <div className="jog" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="jog-head">
        <strong>Jog</strong>
        <span className="hint">{pos ? `X ${pos.x.toFixed(1)}  Y ${pos.y.toFixed(1)}` : ''}</span>
        <button className="small" onClick={onClose} aria-label="Close the jog pad">
          ✕
        </button>
      </div>
      <div className="jog-grid">
        <span />
        {btn('▲', 0, -1, 'Move away from you (up the screen)')}
        <span />
        {btn('◀', -1, 0, 'Move left')}
        <button disabled={busy} onClick={() => onGoTo(0, FIELD.h)} title="Go to 0,0 (front left)">
          0,0
        </button>
        {btn('▶', 1, 0, 'Move right')}
        <span />
        {btn('▼', 0, 1, 'Move towards you (down the screen)')}
        <span />
      </div>
      <div className="row">
        {STEPS.map((s) => (
          <button key={s} className={`small ${s === step ? 'on' : ''}`} onClick={() => setStep(s)}>
            {s} mm
          </button>
        ))}
      </div>
      <button className="small" disabled={busy || !canGoToSelection} onClick={onGoToSelection} title="Put the head at the top-left corner of the selection">
        Move to the selection
      </button>
    </div>
  );
}
