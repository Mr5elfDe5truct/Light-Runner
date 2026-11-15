import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceSettings, Resolution, Status } from '../shared/lp2.ts';
import type { DeviceInfo, LaserEvent, Material, PortInfo, RunPhase } from '../shared/types.ts';
import { buildJob, loadImage, previewUrl } from './imaging.ts';
import { boundsOf, DEFAULTS, fitToField, insideField, newId, type ImageItem, type ImageMode, type Item, type VectorItem, type VectorMode } from './model.ts';
import { readSvg, textImage } from './vector.ts';
import { Workspace } from './Workspace.tsx';

const laser = window.laser;

interface RunState {
  phase: RunPhase;
  job?: number;
  jobs?: number;
  name?: string;
  uploaded?: number;
  size?: number;
}

const MODE_LABEL: Record<ImageMode | VectorMode, string> = { line: 'Line (outline)', fill: 'Fill', bw: 'Black & white', dither: 'Dither', grey: 'Greyscale' };

function presetMode(item: Item): 'line' | 'fill' | 'image' {
  if (item.kind === 'vector') return item.mode === 'line' ? 'line' : 'fill';
  return item.mode === 'bw' ? 'fill' : 'image';
}

export function App() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [port, setPort] = useState('');
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const [log, setLog] = useState<{ level: string; message: string; at: string }[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [materials, setMaterials] = useState<Material[]>([]);
  const [brightness, setBrightness] = useState(1);
  const [lockAspect, setLockAspect] = useState(true);
  const [confirm, setConfirm] = useState<Item[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<DeviceSettings>({ beep: false, reverseDirection: false });
  const [busy, setBusy] = useState(false);
  const [textDraft, setTextDraft] = useState<{ text: string; font: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const note = (message: string, level = 'info') =>
    setLog((l) => [...l.slice(-199), { level, message, at: new Date().toLocaleTimeString() }]);
  const fail = (e: unknown) => note((e as Error).message ?? String(e), 'error');

  const refreshPorts = async () => {
    const list = await laser.ports();
    setPorts(list);
    setPort((cur) => cur || list.find((p) => p.likelyLp2)?.path || list[0]?.path || '');
  };

  useEffect(() => {
    refreshPorts().catch(fail);
    laser.materials().then(setMaterials).catch(fail);
    laser.loadSettings().then(setSettings).catch(fail);
    return laser.onEvent((e: LaserEvent) => {
      if (e.type === 'status') setStatus(e.status);
      else if (e.type === 'run') setRun({ ...e });
      else if (e.type === 'log') note(e.message, e.level);
      else if (e.type === 'connection') {
        setDevice(e.connected ? (e.info ?? null) : null);
        if (!e.connected) setStatus(null);
      }
    });
  }, []);

  // Keep the on-screen look of images up to date.
  const imageKey = items.filter((i) => i.kind === 'image').map((i) => `${i.id}:${(i as ImageItem).mode}:${(i as ImageItem).threshold}:${(i as ImageItem).invert}:${i.w.toFixed(1)}:${i.h.toFixed(1)}:${i.resolution}`).join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const item of items) if (item.kind === 'image') next[item.id] = await previewUrl(item);
      if (!cancelled) setPreviews(next);
    })().catch(fail);
    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  const sel = items.find((i) => i.id === selected) ?? null;
  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i)));
  const visible = items.filter((i) => i.visible);
  const working = run.phase !== 'idle' && run.phase !== 'previewing';

  // ---------------------------------------------------------------- adding things

  const addItem = (item: Item) => {
    setItems((l) => [...l, item]);
    setSelected(item.id);
  };

  const importFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try {
        if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
          const v = readSvg(await file.text());
          addItem({ id: newId(), kind: 'vector', name: file.name, visible: true, mode: 'line', paths: v.paths, naturalW: v.width, naturalH: v.height, ...fitToField(v.width, v.height, 60), ...DEFAULTS });
        } else {
          const src = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
            r.readAsDataURL(file);
          });
          const img = await loadImage(src);
          addItem({ id: newId(), kind: 'image', name: file.name, visible: true, mode: 'dither', src, threshold: 128, invert: false, ...fitToField(img.naturalWidth, img.naturalHeight, 30), ...DEFAULTS });
        }
      } catch (e) {
        fail(e);
      }
    }
  };

  const addText = (text: string, font: string) => {
    setTextDraft(null);
    if (!text.trim()) return;
    const { src, aspect } = textImage(text, `bold 160px ${font}`);
    const w = Math.min(60, 8 * aspect);
    addItem({ id: newId(), kind: 'image', name: `Text: ${text.slice(0, 20)}`, visible: true, mode: 'bw', src, threshold: 128, invert: false, ...fitToField(w, w / aspect, 60), ...DEFAULTS });
  };

  const addShape = (shape: 'rect' | 'circle') => {
    const paths: [number, number][][] =
      shape === 'rect'
        ? [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]
        : [Array.from({ length: 121 }, (_, i) => [10 + 10 * Math.cos((i / 120) * 2 * Math.PI), 10 + 10 * Math.sin((i / 120) * 2 * Math.PI)] as [number, number])];
    addItem({ id: newId(), kind: 'vector', name: shape === 'rect' ? 'Square' : 'Circle', visible: true, mode: 'line', paths, naturalW: 20, naturalH: 20, ...fitToField(20, 20), ...DEFAULTS });
  };

  const remove = () => {
    if (!sel) return;
    setItems((l) => l.filter((i) => i.id !== sel.id));
    setSelected(null);
  };

  // ---------------------------------------------------------------- size, presets

  const resize = (key: 'w' | 'h', value: number) => {
    if (!sel || !(value > 0)) return;
    if (!lockAspect) return update(sel.id, { [key]: value });
    const ratio = sel.w / sel.h;
    update(sel.id, key === 'w' ? { w: value, h: value / ratio } : { h: value, w: value * ratio });
  };

  const applyMaterial = (item: Item, materialId: string) => {
    const m = materials.find((x) => x.id === materialId);
    if (!m) return update(item.id, { material: undefined });
    const dpi = item.resolution === '2K' ? 508 : 254;
    const mode = presetMode(item);
    const candidates = m.presets.filter((p) => p.mode === mode);
    const best = candidates.sort((a, b) => Math.abs(a.dpi - dpi) - Math.abs(b.dpi - dpi))[0];
    if (!best) return note(`${m.name} has no preset for this kind of job.`, 'error');
    update(item.id, { material: materialId, power: best.power, depth: Math.max(1, best.depth), passes: best.passes });
  };

  // ---------------------------------------------------------------- laser actions

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    act(async () => {
      if (device) await laser.disconnect();
      else await laser.connect(port);
    });

  const previewTargets = sel && sel.visible ? [sel] : visible;
  const startPreview = () =>
    act(async () => {
      const b = boundsOf(previewTargets);
      if (!b) throw new Error('Add something to preview first.');
      await laser.preview({ x: Math.floor(b.x * 10), y: Math.floor(b.y * 10), width: Math.ceil(b.w * 10), height: Math.ceil(b.h * 10), brightness });
    });

  const askToEngrave = () => {
    if (!visible.length) return fail(new Error('Add something to engrave first.'));
    const outside = visible.filter((i) => !insideField(i));
    if (outside.length) return fail(new Error(`${outside.map((i) => i.name).join(', ')} is outside the 100 x 100 mm field.`));
    setConfirm(visible);
  };

  const engrave = (list: Item[]) =>
    act(async () => {
      setConfirm(null);
      if (run.phase === 'previewing') await laser.stopPreview();
      const jobs = [];
      for (const item of list) jobs.push(await buildJob(item));
      note(`Sending ${jobs.length} job${jobs.length === 1 ? '' : 's'}.`);
      await laser.run(jobs);
    });

  // ---------------------------------------------------------------- projects

  const saveProject = () => {
    const blob = new Blob([JSON.stringify({ app: 'Light Runner', version: 1, items }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'project.lightrunner.json';
    a.click();
  };

  const openProject = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'Light Runner') throw new Error('That is not a Light Runner project.');
      setItems(data.items);
      setSelected(null);
    } catch (e) {
      fail(e);
    }
  };

  // ---------------------------------------------------------------- view

  const statusText = useMemo(() => {
    if (!device) return 'Not connected';
    if (run.phase === 'uploading') return `Sending ${run.name ?? ''} ${run.size ? Math.round(((run.uploaded ?? 0) / run.size) * 100) : 0} %`;
    if (run.phase === 'engraving' || run.phase === 'paused') return `${run.phase === 'paused' ? 'Paused' : 'Engraving'} ${run.name ?? ''} — ${status?.progress ?? 0} %${run.jobs && run.jobs > 1 ? ` (job ${run.job} of ${run.jobs})` : ''}`;
    if (run.phase === 'previewing') return 'Previewing';
    if (run.phase === 'stopping') return 'Stopping';
    return 'Ready';
  }, [device, run, status]);

  const progress = run.phase === 'uploading' && run.size ? (run.uploaded ?? 0) / run.size : run.phase === 'engraving' || run.phase === 'paused' ? (status?.progress ?? 0) / 100 : 0;

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">Light Runner</div>
        <select value={port} onChange={(e) => setPort(e.target.value)} disabled={!!device}>
          {ports.length === 0 && <option value="">No serial ports</option>}
          {ports.map((p) => (
            <option key={p.path} value={p.path}>
              {p.label}
              {p.likelyLp2 ? ' — LP2?' : ''}
            </option>
          ))}
        </select>
        <button onClick={() => refreshPorts().catch(fail)} disabled={!!device} title="Look for serial ports again">
          ↻
        </button>
        <button className={device ? '' : 'primary'} onClick={connect} disabled={busy || (!device && !port) || working}>
          {device ? 'Disconnect' : 'Connect'}
        </button>
        <div className="device">
          {device ? `LP2${device.deviceId ? `-${device.deviceId}` : ''} · firmware ${device.firmware ?? '?'}` : ''}
        </div>
        <div className="spacer" />
        <button onClick={() => setSettingsOpen(true)}>Device settings</button>
      </header>

      <div className="main">
        <nav className="tools">
          <button onClick={() => fileInput.current?.click()}>Import</button>
          <button onClick={() => setTextDraft({ text: '', font: FONTS[0] })}>Text</button>
          <button onClick={() => addShape('rect')}>Square</button>
          <button onClick={() => addShape('circle')}>Circle</button>
          <hr />
          <button onClick={() => projectInput.current?.click()}>Open</button>
          <button onClick={saveProject} disabled={!items.length}>
            Save
          </button>
          <input ref={fileInput} type="file" multiple accept=".svg,.png,.jpg,.jpeg,.bmp,.webp,.gif" hidden onChange={(e) => importFiles(e.target.files).then(() => (e.target.value = ''))} />
          <input ref={projectInput} type="file" accept=".json" hidden onChange={(e) => openProject(e.target.files).then(() => (e.target.value = ''))} />
        </nav>

        <section className="canvas">
          <Workspace items={items} previews={previews} selected={selected} onSelect={setSelected} onMove={(id, x, y) => update(id, { x, y })} />
          {!items.length && <div className="empty">Import an SVG or picture, or add text or a shape.</div>}
        </section>

        <aside className="side">
          <h3>Layers</h3>
          <ul className="layers">
            {items.map((i) => (
              <li key={i.id} className={i.id === selected ? 'on' : ''} onClick={() => setSelected(i.id)}>
                <input type="checkbox" checked={i.visible} title="Engrave this" onChange={(e) => update(i.id, { visible: e.target.checked })} onClick={(e) => e.stopPropagation()} />
                <span>{i.name}</span>
                <small>{MODE_LABEL[i.mode]}</small>
              </li>
            ))}
            {!items.length && <li className="hint">Nothing yet.</li>}
          </ul>

          {sel && (
            <div className="props">
              <h3>{sel.name}</h3>
              <div className="grid4">
                <label>
                  X mm
                  <input type="number" step="0.1" value={round(sel.x)} onChange={(e) => update(sel.id, { x: Number(e.target.value) })} />
                </label>
                <label>
                  Y mm
                  <input type="number" step="0.1" value={round(sel.y)} onChange={(e) => update(sel.id, { y: Number(e.target.value) })} />
                </label>
                <label>
                  W mm
                  <input type="number" step="0.1" min="0.1" value={round(sel.w)} onChange={(e) => resize('w', Number(e.target.value))} />
                </label>
                <label>
                  H mm
                  <input type="number" step="0.1" min="0.1" value={round(sel.h)} onChange={(e) => resize('h', Number(e.target.value))} />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} /> Keep proportions
              </label>
              <button className="small" onClick={() => update(sel.id, { x: (100 - sel.w) / 2, y: (100 - sel.h) / 2 })}>
                Centre in field
              </button>

              <label>
                Mode
                <select value={sel.mode} onChange={(e) => update(sel.id, { mode: e.target.value } as Partial<Item>)}>
                  {(sel.kind === 'vector' ? (['line', 'fill'] as const) : (['bw', 'dither', 'grey'] as const)).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>

              {sel.kind === 'image' && sel.mode === 'bw' && (
                <label>
                  Threshold {sel.threshold}
                  <input type="range" min="1" max="254" value={sel.threshold} onChange={(e) => update(sel.id, { threshold: Number(e.target.value) })} />
                </label>
              )}
              {sel.kind === 'image' && (
                <label className="check">
                  <input type="checkbox" checked={sel.invert} onChange={(e) => update(sel.id, { invert: e.target.checked })} /> Invert
                </label>
              )}
              {!(sel.kind === 'vector' && sel.mode === 'line') && (
                <label>
                  Resolution
                  <select value={sel.resolution} onChange={(e) => update(sel.id, { resolution: e.target.value as Resolution })}>
                    <option value="1K">1K (0.1 mm)</option>
                    <option value="2K">2K (0.05 mm)</option>
                  </select>
                </label>
              )}

              <label>
                Material
                <select value={sel.material ?? ''} onChange={(e) => applyMaterial(sel, e.target.value)}>
                  <option value="">Custom</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <Slider label="Power %" value={sel.power} min={1} max={100} onChange={(v) => update(sel.id, { power: v, material: undefined })} />
              <Slider label="Depth" value={sel.depth} min={1} max={100} onChange={(v) => update(sel.id, { depth: v, material: undefined })} />
              <label>
                Passes
                <input type="number" min="1" max="50" value={sel.passes} onChange={(e) => update(sel.id, { passes: Math.max(1, Math.min(50, Math.round(Number(e.target.value)) || 1)) })} />
              </label>
              {!insideField(sel) && <p className="warn">This is outside the 100 x 100 mm field.</p>}
              <button className="danger small" onClick={remove}>
                Delete
              </button>
            </div>
          )}
        </aside>
      </div>

      <footer className="bar run">
        <div className="statusline">
          <span className={`dot ${device ? (working ? 'busy' : 'ok') : ''}`} />
          {statusText}
          <div className="progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
        <label className="bright">
          Preview light
          <input type="range" min="1" max="10" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
        </label>
        {run.phase === 'previewing' ? (
          <button onClick={() => act(() => laser.stopPreview())} disabled={busy}>
            Stop preview
          </button>
        ) : (
          <button onClick={startPreview} disabled={!device || busy || working || !previewTargets.length}>
            Preview {sel && sel.visible ? 'selected' : 'all'}
          </button>
        )}
        <button className="primary" onClick={askToEngrave} disabled={!device || busy || working}>
          Engrave
        </button>
        {run.phase === 'paused' ? (
          <button onClick={() => act(() => laser.resume())}>Resume</button>
        ) : (
          <button onClick={() => act(() => laser.pause())} disabled={run.phase !== 'engraving'}>
            Pause
          </button>
        )}
        <button className="danger" onClick={() => act(() => laser.stop())} disabled={!device || run.phase === 'idle'}>
          Stop
        </button>
      </footer>

      <div className="log">
        {log.slice(-3).map((l, i) => (
          <div key={i} className={l.level}>
            <time>{l.at}</time> {l.message}
          </div>
        ))}
      </div>

      {confirm && (
        <div className="modal" onClick={() => setConfirm(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Engrave {confirm.length === 1 ? 'this' : `these ${confirm.length} jobs`}?</h2>
            <table>
              <tbody>
                {confirm.map((i) => (
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
            <p className="warn">The laser will fire. Wear eye protection and keep the work area clear.</p>
            <div className="buttons">
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button className="primary" onClick={() => engrave(confirm)}>
                Engrave
              </button>
            </div>
          </div>
        </div>
      )}

      {textDraft && (
        <div className="modal" onClick={() => setTextDraft(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Add text</h2>
            <textarea
              autoFocus
              rows={3}
              value={textDraft.text}
              placeholder="Type the text to engrave"
              style={{ fontFamily: textDraft.font.replace(/"/g, '') }}
              onChange={(e) => setTextDraft({ ...textDraft, text: e.target.value })}
            />
            <label>
              Font
              <select value={textDraft.font} onChange={(e) => setTextDraft({ ...textDraft, font: e.target.value })}>
                {FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f.split(',')[0].replace(/"/g, '')}
                  </option>
                ))}
              </select>
            </label>
            <div className="buttons">
              <button onClick={() => setTextDraft(null)}>Cancel</button>
              <button className="primary" disabled={!textDraft.text.trim()} onClick={() => addText(textDraft.text, textDraft.font)}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal" onClick={() => setSettingsOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Device settings</h2>
            <label className="check">
              <input type="checkbox" checked={settings.beep} onChange={(e) => setSettings({ ...settings, beep: e.target.checked })} /> Beep when a job starts and ends
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.reverseDirection} onChange={(e) => setSettings({ ...settings, reverseDirection: e.target.checked })} /> Reverse engraving direction (handheld)
            </label>
            <p className="hint">These are sent to the LP2 when you save{device ? '' : ' (connect first to send them now)'}.</p>
            <div className="buttons">
              <button onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button
                className="primary"
                onClick={() =>
                  act(async () => {
                    await laser.applySettings(settings);
                    setSettingsOpen(false);
                    note(device ? 'Settings sent to the LP2.' : 'Settings saved.');
                  })
                }
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

const FONTS = ['"Segoe UI", sans-serif', 'Arial, sans-serif', 'Georgia, serif', '"Times New Roman", serif', '"Courier New", monospace', 'Impact, sans-serif', '"Comic Sans MS", cursive', '"Brush Script MT", cursive'];

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label}
      <div className="slider">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value)) || min)))} />
      </div>
    </label>
  );
}

export type { VectorItem };
