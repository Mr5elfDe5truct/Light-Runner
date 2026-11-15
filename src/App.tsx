import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceSettings, Status } from '../shared/lp2.ts';
import type { DeviceInfo, LaserEvent, Material, PortInfo, RunPhase } from '../shared/types.ts';
import { ConfirmDialog, LogDrawer, SaveMaterialDialog, SettingsDialog, TestGridDialog, TextDialog } from './dialogs.tsx';
import { boundsOf, insideField } from './geometry.ts';
import { buildJobs, gcodeText, loadImage, previewUrl, traceItem } from './imaging.ts';
import { readDxf, readGcode, type Outline } from './importers.ts';
import { DEFAULTS, fitToField, IMAGE_DEFAULTS, newId, normalizeItem, type ImageItem, type Item, type VectorItem } from './model.ts';
import { MODE_LABEL, Properties } from './Properties.tsx';
import { shapePaths, SHAPES, type ShapeKind } from './shapes.ts';
import { gridLayout, type GridSpec } from './testGrid.ts';
import { useHistory } from './useHistory.ts';
import { readSvg, textImage } from './vector.ts';
import { Workspace } from './Workspace.tsx';

const laser = window.laser;
const MY_MATERIALS_KEY = 'lightrunner.materials';

interface RunState {
  phase: RunPhase;
  job?: number;
  jobs?: number;
  name?: string;
  uploaded?: number;
  size?: number;
}
type LogLine = { level: string; message: string; at: string };

function presetMode(item: Item): 'line' | 'fill' | 'image' {
  if (item.kind === 'vector') return item.mode === 'line' ? 'line' : 'fill';
  return item.mode === 'bw' ? 'fill' : 'image';
}

const loadMyMaterials = (): Material[] => {
  try {
    return JSON.parse(localStorage.getItem(MY_MATERIALS_KEY) ?? '[]');
  } catch {
    return [];
  }
};

function download(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export function App() {
  const history = useHistory<Item[]>([]);
  const items = history.present;
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [port, setPort] = useState('');
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const [log, setLog] = useState<LogLine[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [ldsMaterials, setLdsMaterials] = useState<Material[]>([]);
  const [myMaterials, setMyMaterials] = useState<Material[]>(loadMyMaterials);
  const [brightness, setBrightness] = useState(1);
  const [lockAspect, setLockAspect] = useState(true);
  const [snap, setSnap] = useState(false);
  const [dialog, setDialog] = useState<null | 'text' | 'settings' | 'grid' | 'material' | 'shapes'>(null);
  const [confirm, setConfirm] = useState<{ items: Item[]; jobs: number } | null>(null);
  const [settings, setSettings] = useState<DeviceSettings>({ beep: false, reverseDirection: false });
  const [busy, setBusy] = useState(false);
  const clipboard = useRef<Item | null>(null);
  const restored = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const note = (message: string, level = 'info') => setLog((l) => [...l.slice(-499), { level, message, at: new Date().toLocaleTimeString() }]);
  const fail = (e: unknown) => note((e as Error)?.message ?? String(e), 'error');

  const materials = useMemo(() => [...myMaterials.map((m) => ({ ...m, name: `★ ${m.name}` })), ...ldsMaterials], [myMaterials, ldsMaterials]);

  const refreshPorts = async () => {
    const list = await laser.ports();
    setPorts(list);
    setPort((cur) => (list.some((p) => p.path === cur) ? cur : list.find((p) => p.likelyLp2)?.path || list[0]?.path || ''));
  };

  // ---------------------------------------------------------------- start-up and laser events

  useEffect(() => {
    refreshPorts().catch(fail);
    laser.materials().then(setLdsMaterials).catch(fail);
    laser.loadSettings().then(setSettings).catch(fail);
    laser
      .loadDraft()
      .then((json) => {
        if (json) {
          const data = JSON.parse(json);
          if (Array.isArray(data.items) && data.items.length) {
            history.reset(data.items.map(normalizeItem));
            note(`Restored your last design (${data.items.length} item${data.items.length === 1 ? '' : 's'}).`);
          }
        }
      })
      .catch(() => undefined)
      .finally(() => (restored.current = true));
    return laser.onEvent((e: LaserEvent) => {
      if (e.type === 'status') setStatus(e.status);
      else if (e.type === 'run') setRun({ ...e });
      else if (e.type === 'log') note(e.message, e.level);
      else if (e.type === 'connection') {
        setDevice(e.connected ? (e.info ?? null) : null);
        if (!e.connected) {
          setStatus(null);
          note('Disconnected from the laser.');
        }
      }
    });
  }, []);

  // Autosave the design a moment after each change.
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => laser.saveDraft(JSON.stringify({ app: 'Light Runner', version: 2, items })).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [items]);

  // Keep the on-screen look of images up to date. Each image is drawn once per look and cached,
  // so a change to one doesn't redraw the rest and one failure can't hold up the others.
  const previewCache = useRef(new Map<string, string>());
  const lookOf = (i: ImageItem) => [i.src.length, i.src.slice(-32), i.mode, i.threshold, i.invert, i.brightness, i.contrast, i.w.toFixed(1), i.h.toFixed(1), i.resolution].join(':');
  const imageKey = items
    .filter((i): i is ImageItem => i.kind === 'image')
    .map((i) => `${i.id}=${lookOf(i)}`)
    .join('|');
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      for (const item of items) {
        if (item.kind !== 'image' || cancelled) continue;
        const look = lookOf(item);
        if (previewCache.current.has(look)) {
          setPreviews((p) => (p[item.id] === previewCache.current.get(look) ? p : { ...p, [item.id]: previewCache.current.get(look)! }));
          continue;
        }
        try {
          const url = await previewUrl(item);
          previewCache.current.set(look, url);
          if (!cancelled) setPreviews((p) => ({ ...p, [item.id]: url }));
        } catch (e) {
          fail(new Error(`${item.name}: ${(e as Error).message}`));
        }
      }
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [imageKey]);

  const sel = items.find((i) => i.id === selected) ?? null;
  const update = (id: string, patch: Partial<Item>, key?: string) =>
    history.commit((list) => list.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i)), key ? `${id}:${key}` : undefined);
  const visible = items.filter((i) => i.visible);
  const working = run.phase !== 'idle' && run.phase !== 'previewing';

  // ---------------------------------------------------------------- adding things

  const addItems = (added: Item[]) => {
    if (!added.length) return;
    history.commit((l) => [...l, ...added]);
    setSelected(added[added.length - 1].id);
  };

  const vectorItem = (name: string, o: Outline, maxMm = 60): VectorItem => ({
    id: newId(),
    kind: 'vector',
    name,
    visible: true,
    mode: 'line',
    paths: o.paths,
    naturalW: o.width,
    naturalH: o.height,
    ...DEFAULTS,
    ...fitToField(o.width, o.height, maxMm),
  });

  const imageItem = (name: string, src: string, w: number, h: number, patch: Partial<ImageItem> = {}): ImageItem => ({
    id: newId(),
    kind: 'image',
    name,
    visible: true,
    mode: 'dither',
    src,
    ...IMAGE_DEFAULTS,
    ...DEFAULTS,
    ...fitToField(w, h, 30),
    ...patch,
  });

  const importFiles = async (files: FileList | File[] | null) => {
    const added: Item[] = [];
    for (const file of Array.from(files ?? [])) {
      try {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (ext === 'svg' || file.type === 'image/svg+xml') {
          const v = readSvg(await file.text());
          added.push(vectorItem(file.name, { paths: v.paths, width: v.width, height: v.height }));
        } else if (ext === 'dxf') {
          added.push(vectorItem(file.name, readDxf(await file.text())));
        } else if (['gcode', 'nc', 'gc', 'ngc', 'tap', 'txt'].includes(ext)) {
          added.push(vectorItem(file.name, readGcode(await file.text()), 100));
        } else if (ext === 'json') {
          await openProject(file);
          return;
        } else {
          const src = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
            r.readAsDataURL(file);
          });
          const img = await loadImage(src);
          added.push(imageItem(file.name, src, img.naturalWidth, img.naturalHeight));
        }
      } catch (e) {
        fail(new Error(`${file.name}: ${(e as Error).message}`));
      }
    }
    addItems(added);
  };

  const addText = (text: string, font: string, bold: boolean, italic: boolean) => {
    setDialog(null);
    const { src, aspect } = textImage(text, font, bold, italic);
    const h = 8 * text.split('\n').length;
    addItems([imageItem(`Text: ${text.replace(/\s+/g, ' ').slice(0, 24)}`, src, h * aspect, h, { mode: 'bw', ...fitToField(h * aspect, h, 60) })]);
  };

  const addShape = (kind: ShapeKind) => {
    setDialog(null);
    const s = shapePaths(kind);
    const item = vectorItem(SHAPES.find((x) => x.kind === kind)!.label, { paths: s.paths, width: s.w, height: s.h });
    addItems([{ ...item, ...fitToField(s.w, s.h, 30) }]);
  };

  const addTestGrid = (spec: GridSpec, labelPower: number, labelDepth: number) => {
    setDialog(null);
    const { cells, labels } = gridLayout(spec);
    const square = shapePaths('square');
    const made: Item[] = cells.map((c) => ({
      ...vectorItem(`Test P${c.power} D${c.depth}`, { paths: square.paths, width: 20, height: 20 }),
      mode: spec.mode,
      x: c.x,
      y: c.y,
      w: c.size,
      h: c.size,
      power: c.power,
      depth: c.depth,
      passes: spec.passes,
    }));
    for (const l of labels) {
      const { src, aspect } = textImage(l.text, '"Segoe UI", sans-serif', true);
      const h = l.h;
      const w = Math.min(l.w, h * aspect);
      made.push(imageItem(`Label ${l.text}`, src, w, h, { mode: 'bw', x: l.x + (l.w - w) / 2, y: l.y, w, h, power: labelPower, depth: labelDepth }));
    }
    addItems(made);
    note(`Added a ${spec.cols} × ${spec.rows} material test (${cells.length} squares).`);
  };

  // ---------------------------------------------------------------- editing

  const remove = (id = selected) => {
    if (!id) return;
    history.commit((l) => l.filter((i) => i.id !== id));
    setSelected(null);
  };

  const duplicate = (source = sel, offset = 3) => {
    if (!source) return;
    const copy = { ...structuredClone(source), id: newId(), name: `${source.name} copy`, x: source.x + offset, y: source.y + offset };
    addItems([copy]);
  };

  const reorder = (id: string, dir: -1 | 1) =>
    history.commit((l) => {
      const i = l.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const next = l.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const trace = async () => {
    if (!sel || sel.kind !== 'image') return;
    try {
      const outline = await traceItem(sel);
      addItems([outline]);
      note(`Traced ${sel.name}: ${outline.paths.length} outline${outline.paths.length === 1 ? '' : 's'}.`);
    } catch (e) {
      fail(e);
    }
  };

  const applyMaterial = (item: Item, materialId: string) => {
    const m = materials.find((x) => x.id === materialId);
    if (!m) return update(item.id, { material: undefined });
    const dpi = item.resolution === '2K' ? 508 : 254;
    const mode = presetMode(item);
    const best = m.presets.filter((p) => p.mode === mode).sort((a, b) => Math.abs(a.dpi - dpi) - Math.abs(b.dpi - dpi))[0];
    if (!best) return note(`${m.name} has no setting for ${MODE_LABEL[item.mode].toLowerCase()} jobs.`, 'error');
    update(item.id, { material: materialId, power: best.power, depth: Math.max(1, best.depth), passes: best.passes });
  };

  const saveMaterial = (name: string) => {
    setDialog(null);
    if (!sel) return;
    const preset = { mode: presetMode(sel), dpi: sel.resolution === '2K' ? 508 : 254, power: sel.power, depth: sel.depth, passes: sel.passes };
    const existing = myMaterials.find((m) => m.name.toLowerCase() === name.toLowerCase());
    const next = existing
      ? myMaterials.map((m) => (m === existing ? { ...m, presets: [...m.presets.filter((p) => !(p.mode === preset.mode && p.dpi === preset.dpi)), preset] } : m))
      : [...myMaterials, { id: `my-${newId()}`, name, presets: [preset] }];
    setMyMaterials(next);
    localStorage.setItem(MY_MATERIALS_KEY, JSON.stringify(next));
    const id = (existing ?? next[next.length - 1]).id;
    update(sel.id, { material: id });
    note(`Saved "${name}" for ${MODE_LABEL[sel.mode].toLowerCase()} at ${sel.resolution}.`);
  };

  // ---------------------------------------------------------------- projects

  const saveProject = () => download('design.lightrunner.json', JSON.stringify({ app: 'Light Runner', version: 2, items }, null, 1), 'application/json');

  const openProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'Light Runner' || !Array.isArray(data.items)) throw new Error('That is not a Light Runner design.');
      history.commit(data.items.map(normalizeItem));
      setSelected(null);
      note(`Opened ${file.name}.`);
    } catch (e) {
      fail(e);
    }
  };

  const newDesign = () => {
    if (items.length && !window.confirm('Start a new design? You can undo this.')) return;
    history.commit([]);
    setSelected(null);
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

  const connect = () => act(async () => (device ? laser.disconnect() : laser.connect(port)));

  const previewTargets = sel && sel.visible ? [sel] : visible;
  const startPreview = (center = false) =>
    act(async () => {
      const b = boundsOf(previewTargets);
      if (!b) throw new Error('Add something to preview first.');
      const x = Math.floor(b.x * 10);
      const y = Math.floor(b.y * 10);
      const w = Math.ceil(b.w * 10);
      const h = Math.ceil(b.h * 10);
      await laser.preview(center ? { x: x + Math.round(w / 2), y: y + Math.round(h / 2), width: 1, height: 1, brightness } : { x, y, width: w, height: h, brightness });
    });

  const askToEngrave = () =>
    act(async () => {
      if (!visible.length) throw new Error('Add something to engrave first.');
      const outside = visible.filter((i) => !insideField(i));
      if (outside.length) throw new Error(`${outside.map((i) => i.name).join(', ')} ${outside.length === 1 ? 'is' : 'are'} outside the 100 × 100 mm field.`);
      const jobs = await buildJobs(visible);
      setConfirm({ items: visible, jobs: jobs.length });
    });

  const engrave = (list: Item[]) =>
    act(async () => {
      setConfirm(null);
      if (run.phase === 'previewing') await laser.stopPreview();
      const jobs = await buildJobs(list);
      note(`Sending ${jobs.length} job${jobs.length === 1 ? '' : 's'}.`);
      const started = Date.now();
      await laser.run(jobs);
      note(`Done in ${formatTime((Date.now() - started) / 1000)}.`);
    });

  // ---------------------------------------------------------------- keyboard

  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    if (dialog || confirm) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      history.undo();
    } else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      history.redo();
    } else if (ctrl && k === 's') {
      e.preventDefault();
      saveProject();
    } else if (ctrl && k === 'o') {
      e.preventDefault();
      projectInput.current?.click();
    } else if (ctrl && k === 'i') {
      e.preventDefault();
      fileInput.current?.click();
    } else if (isTyping(e)) {
      return;
    } else if (ctrl && k === 'd') {
      e.preventDefault();
      duplicate();
    } else if (ctrl && k === 'c' && sel) {
      clipboard.current = structuredClone(sel);
    } else if (ctrl && k === 'v' && clipboard.current) {
      duplicate(clipboard.current, 5);
    } else if ((k === 'delete' || k === 'backspace') && sel) {
      remove();
    } else if (k === 'escape') {
      setSelected(null);
    } else if (sel && k.startsWith('arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
      const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
      const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
      update(sel.id, { x: Math.round((sel.x + dx) * 100) / 100, y: Math.round((sel.y + dy) * 100) / 100 }, 'nudge');
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  // ---------------------------------------------------------------- view

  const statusText = useMemo(() => {
    if (!device) return 'Not connected';
    if (run.phase === 'uploading') return `Sending ${run.name ?? ''} — ${run.size ? Math.round(((run.uploaded ?? 0) / run.size) * 100) : 0} %`;
    if (run.phase === 'engraving' || run.phase === 'paused')
      return `${run.phase === 'paused' ? 'Paused' : 'Engraving'} ${run.name ?? ''} — ${status?.progress ?? 0} %${run.jobs && run.jobs > 1 ? ` · job ${run.job} of ${run.jobs}` : ''}`;
    if (run.phase === 'previewing') return 'Previewing — the LP2 is tracing the frame';
    if (run.phase === 'stopping') return 'Stopping';
    return 'Ready';
  }, [device, run, status]);

  const progress = run.phase === 'uploading' && run.size ? (run.uploaded ?? 0) / run.size : run.phase === 'engraving' || run.phase === 'paused' ? (status?.progress ?? 0) / 100 : 0;
  const lastLog = log[log.length - 1];

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        importFiles(e.dataTransfer.files);
      }}
    >
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
        <div className="device">{device ? `LP2${device.deviceId ? `-${device.deviceId}` : ''} · firmware ${device.firmware ?? '?'}` : ''}</div>
        <div className="spacer" />
        <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)">
          ↷ Redo
        </button>
        <button onClick={() => setDialog('settings')}>Device settings</button>
      </header>

      <div className="main">
        <nav className="tools">
          <button onClick={() => fileInput.current?.click()} title="SVG, DXF, G-code or a picture (Ctrl+I); you can also drop files on the window">
            Import
          </button>
          <button onClick={() => setDialog('text')}>Text</button>
          <div className="menu-wrap">
            <button onClick={() => setDialog(dialog === 'shapes' ? null : 'shapes')}>Shapes</button>
            {dialog === 'shapes' && (
              <div className="menu" onMouseLeave={() => setDialog(null)}>
                {SHAPES.map((s) => (
                  <button key={s.kind} onClick={() => addShape(s.kind)}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setDialog('grid')} title="A grid of power and depth settings to test a material">
            Test grid
          </button>
          <hr />
          <button onClick={newDesign}>New</button>
          <button onClick={() => projectInput.current?.click()} title="Ctrl+O">
            Open
          </button>
          <button onClick={saveProject} disabled={!items.length} title="Ctrl+S">
            Save
          </button>
          <hr />
          <label className="check small" title="Move in whole millimetres">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap
          </label>
          <input ref={fileInput} type="file" multiple accept=".svg,.dxf,.gcode,.nc,.gc,.ngc,.tap,.png,.jpg,.jpeg,.bmp,.webp,.gif" hidden onChange={(e) => importFiles(e.target.files).then(() => (e.target.value = ''))} />
          <input ref={projectInput} type="file" accept=".json" hidden onChange={(e) => openProject(e.target.files?.[0]).then(() => (e.target.value = ''))} />
        </nav>

        <section className="canvas">
          <Workspace items={items} previews={previews} selected={selected} snap={snap} onSelect={setSelected} onMoveStart={history.checkpoint} onMove={(id, x, y) => history.replace((l) => l.map((i) => (i.id === id ? { ...i, x, y } : i)))} />
          {!items.length && <div className="empty">Import an SVG, DXF, G-code or picture (or drop it here), or add text, a shape or a test grid.</div>}
        </section>

        <aside className="side">
          <h3>Layers · engrave order</h3>
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
            <Properties
              item={sel}
              materials={materials}
              lockAspect={lockAspect}
              onLockAspect={setLockAspect}
              onChange={(patch, key) => update(sel.id, patch, key)}
              onMaterial={(id) => applyMaterial(sel, id)}
              onSaveMaterial={() => setDialog('material')}
              onTrace={trace}
              onExportGcode={() => sel.kind === 'vector' && download(`${sel.name.replace(/\.[^.]+$/, '')}.gcode`, gcodeText(sel))}
              onDuplicate={() => duplicate()}
              onDelete={() => remove()}
              onOrder={(dir) => reorder(sel.id, dir)}
            />
          )}
        </aside>
      </div>

      <footer className="bar run">
        <div className="statusline">
          <span className={`dot ${device ? (working ? 'busy' : 'ok') : ''}`} />
          <span className="status-text">{statusText}</span>
          <div className="progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
        <label className="bright" title="How bright the preview light is">
          Preview light
          <input type="range" min="1" max="10" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
        </label>
        {run.phase === 'previewing' ? (
          <button onClick={() => act(() => laser.stopPreview())} disabled={busy}>
            Stop preview
          </button>
        ) : (
          <>
            <button onClick={() => startPreview(false)} disabled={!device || busy || working || !previewTargets.length} title="Trace the frame of what will be engraved">
              Preview {sel && sel.visible ? 'selected' : 'all'}
            </button>
            <button onClick={() => startPreview(true)} disabled={!device || busy || working || !previewTargets.length} title="Show just the centre point">
              Centre
            </button>
          </>
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

      <div className="logbar" onClick={() => setLogOpen(true)} title="Show the activity log">
        {lastLog ? (
          <span className={lastLog.level}>
            <time>{lastLog.at}</time> {lastLog.message}
          </span>
        ) : (
          <span className="hint">Activity will show here.</span>
        )}
        <span className="logcount">{log.length ? `${log.length} ▴` : ''}</span>
      </div>
      {logOpen && <LogDrawer log={log} onClose={() => setLogOpen(false)} />}

      {confirm && <ConfirmDialog items={confirm.items} jobs={confirm.jobs} onCancel={() => setConfirm(null)} onGo={() => engrave(confirm.items)} />}
      {dialog === 'text' && <TextDialog onCancel={() => setDialog(null)} onAdd={addText} />}
      {dialog === 'grid' && <TestGridDialog onCancel={() => setDialog(null)} onCreate={addTestGrid} />}
      {dialog === 'material' && sel && <SaveMaterialDialog suggested=""onCancel={() => setDialog(null)} onSave={saveMaterial} />}
      {dialog === 'settings' && (
        <SettingsDialog
          initial={settings}
          connected={!!device}
          onCancel={() => setDialog(null)}
          onSave={(s) =>
            act(async () => {
              await laser.applySettings(s);
              setSettings(s);
              setDialog(null);
              note(device ? 'Settings sent to the LP2.' : 'Settings saved.');
            })
          }
        />
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}
