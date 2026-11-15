/** The app's dialogs: engrave confirmation, text, device settings, material test, saving a material. */
import { useState, type ReactNode } from 'react';
import type { DeviceSettings } from '../shared/lp2.ts';
import type { JobSpec } from '../shared/types.ts';
import { MODE_LABEL } from './Properties.tsx';
import type { Item } from './model.ts';
import { GRID_DEFAULTS, gridLayout, type GridSpec } from './testGrid.ts';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const round = (v: number) => Math.round(v * 10) / 10;

export function ConfirmDialog({ items, jobs, onCancel, onGo }: { items: Item[]; jobs: number; onCancel: () => void; onGo: () => void }) {
  return (
    <Modal title={`Engrave ${items.length === 1 ? 'this' : `these ${items.length} items`}?`} onClose={onCancel}>
      <div className="table-scroll">
        <table>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td>{MODE_LABEL[i.mode]}</td>
                <td>
                  {round(i.w)} × {round(i.h)} mm
                </td>
                <td>power {i.power} %</td>
                <td>depth {i.depth}</td>
                <td>
                  {i.passes} pass{i.passes === 1 ? '' : 'es'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {jobs !== items.length && <p className="hint">Outlines with the same settings go together, so this is {jobs} job{jobs === 1 ? '' : 's'} on the laser.</p>}
      <p className="warn">The laser will fire. Wear eye protection and keep the work area clear.</p>
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" autoFocus onClick={onGo}>
          Engrave
        </button>
      </div>
    </Modal>
  );
}

export const FONTS = ['"Segoe UI", sans-serif', 'Arial, sans-serif', 'Georgia, serif', '"Times New Roman", serif', '"Courier New", monospace', 'Impact, sans-serif', '"Comic Sans MS", cursive', '"Brush Script MT", cursive', 'Consolas, monospace', '"Segoe Script", cursive'];

export function TextDialog({ onCancel, onAdd }: { onCancel: () => void; onAdd: (text: string, font: string, bold: boolean, italic: boolean) => void }) {
  const [text, setText] = useState('');
  const [font, setFont] = useState(FONTS[0]);
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  return (
    <Modal title="Add text" onClose={onCancel}>
      <textarea
        autoFocus
        rows={3}
        value={text}
        placeholder="Type the text to engrave"
        style={{ fontFamily: font, fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal' }}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row">
        <label className="grow">
          Font
          <select value={font} onChange={(e) => setFont(e.target.value)}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f.split(',')[0].replace(/"/g, '')}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Bold
        </label>
        <label className="check">
          <input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /> Italic
        </label>
      </div>
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!text.trim()} onClick={() => onAdd(text, font, bold, italic)}>
          Add
        </button>
      </div>
    </Modal>
  );
}

export function SettingsDialog({ initial, connected, onCancel, onSave }: { initial: DeviceSettings; connected: boolean; onCancel: () => void; onSave: (s: DeviceSettings) => void }) {
  const [s, setS] = useState(initial);
  return (
    <Modal title="Device settings" onClose={onCancel}>
      <label className="check">
        <input type="checkbox" checked={s.beep} onChange={(e) => setS({ ...s, beep: e.target.checked })} /> Beep when a job starts and ends
      </label>
      <label className="check">
        <input type="checkbox" checked={s.reverseDirection} onChange={(e) => setS({ ...s, reverseDirection: e.target.checked })} /> Reverse engraving direction (handheld use)
      </label>
      <p className="hint">These are sent to the LP2 when you save{connected ? '' : '; connect first to send them now'}.</p>
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={() => onSave(s)}>
          Save
        </button>
      </div>
    </Modal>
  );
}

export function TestGridDialog({ onCancel, onCreate }: { onCancel: () => void; onCreate: (spec: GridSpec, labelPower: number, labelDepth: number) => void }) {
  const [s, setS] = useState<GridSpec>(GRID_DEFAULTS);
  const [labelPower, setLabelPower] = useState(30);
  const [labelDepth, setLabelDepth] = useState(50);
  const layout = gridLayout(s);
  const n = (key: keyof GridSpec) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [key]: Number(e.target.value) });
  return (
    <Modal title="Material test grid" onClose={onCancel}>
      <p className="hint">Engraves a square for each power and depth, so you can see what works on a material before the real job.</p>
      <div className="grid3">
        <label>
          Power from
          <input type="number" min="1" max="100" value={s.powerMin} onChange={n('powerMin')} />
        </label>
        <label>
          to
          <input type="number" min="1" max="100" value={s.powerMax} onChange={n('powerMax')} />
        </label>
        <label>
          steps
          <input type="number" min="1" max="12" value={s.cols} onChange={n('cols')} />
        </label>
        <label>
          Depth from
          <input type="number" min="1" max="100" value={s.depthMin} onChange={n('depthMin')} />
        </label>
        <label>
          to
          <input type="number" min="1" max="100" value={s.depthMax} onChange={n('depthMax')} />
        </label>
        <label>
          steps
          <input type="number" min="1" max="12" value={s.rows} onChange={n('rows')} />
        </label>
        <label>
          Square mm
          <input type="number" min="2" max="30" step="0.5" value={s.cell} onChange={n('cell')} />
        </label>
        <label>
          Gap mm
          <input type="number" min="0.5" max="20" step="0.5" value={s.gap} onChange={n('gap')} />
        </label>
        <label>
          Passes
          <input type="number" min="1" max="20" value={s.passes} onChange={n('passes')} />
        </label>
      </div>
      <div className="row">
        <label className="grow">
          Squares are
          <select value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as 'fill' | 'line' })}>
            <option value="fill">Filled</option>
            <option value="line">Outlines</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.labels} onChange={(e) => setS({ ...s, labels: e.target.checked })} /> Labels
        </label>
      </div>
      {s.labels && (
        <div className="row">
          <label className="grow">
            Label power %
            <input type="number" min="1" max="100" value={labelPower} onChange={(e) => setLabelPower(Number(e.target.value))} />
          </label>
          <label className="grow">
            Label depth
            <input type="number" min="1" max="100" value={labelDepth} onChange={(e) => setLabelDepth(Number(e.target.value))} />
          </label>
        </div>
      )}
      <p className={layout.problem ? 'warn' : 'hint'}>
        {layout.problem ?? `${s.cols * s.rows} squares, ${layout.width.toFixed(0)} × ${layout.height.toFixed(0)} mm, centred in the field. Each square is its own job.`}
      </p>
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!!layout.problem} onClick={() => onCreate(s, labelPower, labelDepth)}>
          Add to the design
        </button>
      </div>
    </Modal>
  );
}

export function SaveMaterialDialog({ suggested, onCancel, onSave }: { suggested: string; onCancel: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(suggested);
  return (
    <Modal title="Save as my material" onClose={onCancel}>
      <p className="hint">Saves this power, depth and number of passes for this kind of job and resolution.</p>
      <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Birch plywood 3 mm" />
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
          Save
        </button>
      </div>
    </Modal>
  );
}

export function LogDrawer({ log, onClose }: { log: { level: string; message: string; at: string }[]; onClose: () => void }) {
  return (
    <div className="drawer">
      <div className="drawer-head">
        <strong>Activity</strong>
        <button className="small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="drawer-body">
        {log.length === 0 && <div className="hint">Nothing yet.</div>}
        {[...log].reverse().map((l, i) => (
          <div key={i} className={l.level}>
            <time>{l.at}</time> {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export type { JobSpec };
