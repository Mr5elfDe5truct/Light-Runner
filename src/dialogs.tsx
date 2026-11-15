/** The app's dialogs: engrave confirmation, text, device settings, material test, saving a material. */
import { useEffect, useState, type ReactNode } from 'react';
import { formatDuration } from '../shared/estimate.ts';
import type { DeviceSettings } from '../shared/lp2.ts';
import { BARCODE_FORMATS, type QrLevel } from './codes.ts';
import { supported } from './hershey.ts';
import { needsAttendance, type Warning } from './safety.ts';
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

export function ConfirmDialog({ items, jobs, seconds, warnings, onCancel, onGo }: { items: Item[]; jobs: number; seconds: number; warnings: Warning[]; onCancel: () => void; onGo: () => void }) {
  const mustAttend = needsAttendance(warnings);
  const [attending, setAttending] = useState(false);
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
      <p className="estimate">
        Estimated time: <strong>about {formatDuration(seconds)}</strong> <span className="hint">(a rough guide; material and settings change it)</span>
      </p>
      {warnings.map((w, i) => (
        <p key={i} className={w.level === 'danger' ? 'danger-note' : 'warn'}>
          ⚠ {w.text}
        </p>
      ))}
      <p className="warn">The laser will fire. Wear eye protection and keep the work area clear.</p>
      {mustAttend && (
        <label className="check">
          <input type="checkbox" checked={attending} onChange={(e) => setAttending(e.target.checked)} /> I'll stay with the laser while it runs
        </label>
      )}
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" autoFocus disabled={mustAttend && !attending} onClick={onGo}>
          Engrave
        </button>
      </div>
    </Modal>
  );
}

export const FONTS = ['"Segoe UI", sans-serif', 'Arial, sans-serif', 'Georgia, serif', '"Times New Roman", serif', '"Courier New", monospace', 'Impact, sans-serif', '"Comic Sans MS", cursive', '"Brush Script MT", cursive', 'Consolas, monospace', '"Segoe Script", cursive'];

export interface TextChoice {
  text: string;
  style: 'filled' | 'single';
  font: string;
  bold: boolean;
  italic: boolean;
  heightMm: number; // capital-letter height for single-line text
  align: 'left' | 'center' | 'right';
}

export function TextDialog({ onCancel, onAdd }: { onCancel: () => void; onAdd: (t: TextChoice) => void }) {
  const [t, setT] = useState<TextChoice>({ text: '', style: 'filled', font: FONTS[0], bold: true, italic: false, heightMm: 5, align: 'left' });
  const missing = t.style === 'single' ? [...new Set([...t.text].filter((c) => c !== '\n' && !supported(c)))] : [];
  return (
    <Modal title="Add text" onClose={onCancel}>
      <div className="tabs">
        <button className={t.style === 'filled' ? 'on' : ''} onClick={() => setT({ ...t, style: 'filled' })}>
          Filled letters
        </button>
        <button className={t.style === 'single' ? 'on' : ''} onClick={() => setT({ ...t, style: 'single' })}>
          Single line (fast)
        </button>
      </div>
      <p className="hint">
        {t.style === 'filled'
          ? 'Any font on this PC, engraved as a picture. Best for bold, solid lettering.'
          : 'Each letter is drawn as a few strokes (Hershey font), so it engraves as quick outlines. Best for small labels and serial numbers.'}
      </p>
      <textarea
        autoFocus
        rows={3}
        value={t.text}
        placeholder="Type the text to engrave"
        style={t.style === 'filled' ? { fontFamily: t.font, fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? 'italic' : 'normal' } : { fontFamily: 'Consolas, monospace' }}
        onChange={(e) => setT({ ...t, text: e.target.value })}
      />
      {t.style === 'filled' ? (
        <div className="row">
          <label className="grow">
            Font
            <select value={t.font} onChange={(e) => setT({ ...t, font: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f.split(',')[0].replace(/"/g, '')}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={t.bold} onChange={(e) => setT({ ...t, bold: e.target.checked })} /> Bold
          </label>
          <label className="check">
            <input type="checkbox" checked={t.italic} onChange={(e) => setT({ ...t, italic: e.target.checked })} /> Italic
          </label>
        </div>
      ) : (
        <div className="row">
          <label className="grow">
            Letter height mm
            <input type="number" min="0.5" max="80" step="0.5" value={t.heightMm} onChange={(e) => setT({ ...t, heightMm: Number(e.target.value) })} />
          </label>
          <label className="grow">
            Lines
            <select value={t.align} onChange={(e) => setT({ ...t, align: e.target.value as TextChoice['align'] })}>
              <option value="left">Left</option>
              <option value="center">Centred</option>
              <option value="right">Right</option>
            </select>
          </label>
        </div>
      )}
      {missing.length > 0 && <p className="warn">This font has no {missing.join(' ')}; they'll be left blank.</p>}
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!t.text.trim() || (t.style === 'single' && !(t.heightMm > 0))} onClick={() => onAdd(t)}>
          Add
        </button>
      </div>
    </Modal>
  );
}

export interface CodeChoice {
  kind: 'qr' | 'barcode';
  text: string;
  level: QrLevel;
  border: boolean;
  format: string;
  sizeMm: number; // QR: width; barcode: width
}

export function CodeDialog({ onCancel, onAdd }: { onCancel: () => void; onAdd: (c: CodeChoice) => void }) {
  const [c, setC] = useState<CodeChoice>({ kind: 'qr', text: '', level: 'M', border: false, format: 'CODE128', sizeMm: 20 });
  return (
    <Modal title="QR code or barcode" onClose={onCancel}>
      <div className="tabs">
        <button className={c.kind === 'qr' ? 'on' : ''} onClick={() => setC({ ...c, kind: 'qr', sizeMm: 20 })}>
          QR code
        </button>
        <button className={c.kind === 'barcode' ? 'on' : ''} onClick={() => setC({ ...c, kind: 'barcode', sizeMm: 40 })}>
          Barcode
        </button>
      </div>
      <label>
        {c.kind === 'qr' ? 'Text or web address' : 'Value'}
        <input type="text" autoFocus value={c.text} onChange={(e) => setC({ ...c, text: e.target.value })} placeholder={c.kind === 'qr' ? 'https://…' : '012345678905'} />
      </label>
      <div className="row">
        {c.kind === 'qr' ? (
          <label className="grow">
            Error correction
            <select value={c.level} onChange={(e) => setC({ ...c, level: e.target.value as QrLevel })}>
              <option value="L">Low (smallest)</option>
              <option value="M">Medium</option>
              <option value="Q">High</option>
              <option value="H">Highest (survives scratches)</option>
            </select>
          </label>
        ) : (
          <label className="grow">
            Type
            <select value={c.format} onChange={(e) => setC({ ...c, format: e.target.value })}>
              {BARCODE_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grow">
          Width mm
          <input type="number" min="3" max="100" step="1" value={c.sizeMm} onChange={(e) => setC({ ...c, sizeMm: Number(e.target.value) })} />
        </label>
      </div>
      {c.kind === 'qr' && (
        <label className="check">
          <input type="checkbox" checked={c.border} onChange={(e) => setC({ ...c, border: e.target.checked })} /> Include the blank border (needed on dark materials)
        </label>
      )}
      <p className="hint">It's added as a filled shape. On light materials the burnt parts are the dark modules, which is what phone cameras expect.</p>
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!c.text.trim() || !(c.sizeMm > 0)} onClick={() => onAdd(c)}>
          Add
        </button>
      </div>
    </Modal>
  );
}

export function PdfPageDialog({ name, pages, onCancel, onPick }: { name: string; pages: number; onCancel: () => void; onPick: (page: number) => void }) {
  const [page, setPage] = useState(1);
  return (
    <Modal title={`Which page of ${name}?`} onClose={onCancel}>
      <label>
        Page (1 to {pages})
        <input type="number" autoFocus min="1" max={pages} value={page} onChange={(e) => setPage(Math.max(1, Math.min(pages, Math.round(Number(e.target.value)) || 1)))} />
      </label>
      <p className="hint">The page comes in as a picture at its printed size, shrunk to fit the field if needed.</p>
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={() => onPick(page)}>
          Import
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

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ version: string; electron: string; data: string } | null>(null);
  const [update, setUpdate] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    window.laser.appInfo().then(setInfo).catch(() => undefined);
  }, []);
  const check = async () => {
    setChecking(true);
    try {
      const u = await window.laser.checkUpdate();
      setLink(u.newer ? u.url : null);
      setUpdate(u.note ?? (u.newer ? `Version ${u.latest} is available.` : `You have the latest version (${u.current}).`));
    } catch (e) {
      setUpdate(`Couldn't check: ${(e as Error).message}`);
    } finally {
      setChecking(false);
    }
  };
  return (
    <Modal title="Light Runner" onClose={onClose}>
      <div className="about">
        <img src="./icon.png" alt="" width={72} height={72} />
        <div>
          <div>Version {info?.version ?? '…'} · by RG Studios</div>
          <div className="hint">Design and engrave on the LaserPecker LP2, without LaserPecker Design Space.</div>
          <div className="hint">Your designs and settings are kept in {info?.data ?? '…'}</div>
        </div>
      </div>
      <div className="row">
        <button onClick={check} disabled={checking}>
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {link && (
          <button className="primary" onClick={() => window.laser.openUrl(link)}>
            Get it
          </button>
        )}
      </div>
      {update && <p className="hint">{update}</p>}
      <p className="hint">Open-source parts: React, serialport, pdf.js, qrcode-generator, JsBarcode, the Hershey fonts (Dr. A. V. Hershey, U.S. National Bureau of Standards; data format by James Hurt) and Electron. See THIRD_PARTY_NOTICES.md.</p>
      <div className="buttons">
        <button className="primary" onClick={onClose}>
          Close
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
