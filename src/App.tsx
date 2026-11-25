import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateSeconds, formatDuration } from '../shared/estimate.ts';
import type { DeviceSettings, Status } from '../shared/lp2.ts';
import type { DeviceInfo, JobSpec, LaserEvent, Material, PortInfo, RunPhase } from '../shared/types.ts';
import { barcodePaths, qrPaths } from './codes.ts';
import { AboutDialog, BatchDialog, CodeDialog, ConfirmDialog, NextPartDialog, LogDrawer, PdfPageDialog, SaveMaterialDialog, SettingsDialog, TestGridDialog, TextDialog, type CodeChoice, type TextChoice } from './dialogs.tsx';
import { alignGroupToField, boundsOf, insideField } from './geometry.ts';
import { hersheyText } from './hershey.ts';
import { buildJobs, gcodeText, loadImage, previewUrl, traceItem } from './imaging.ts';
import { readDxf, readGcode, type Outline } from './importers.ts';
import { DEFAULTS, fitToField, IMAGE_DEFAULTS, newId, normalizeItem, type ImageItem, type Item, type TextSource, type VectorItem } from './model.ts';
import { pdfPageCount, renderPdfPage } from './pdf.ts';
import { MODE_LABEL, MultiProperties, Properties } from './Properties.tsx';
import { shapePaths, SHAPES, type ShapeKind } from './shapes.ts';
import { gridLayout, type GridSpec } from './testGrid.ts';
import { jobWarnings, type Warning } from './safety.ts';
import { useHistory } from './useHistory.ts';
import { makeTextItem, rewordItem } from './textItems.ts';
import { BATCH_DEFAULTS, batchCount, batchValues, fillTemplate, hasPlaceholders, type BatchSpec } from './batch.ts';
import { combineItems, offsetItem } from './vectorOps.ts';
import { readSvg, textImage } from './vector.ts';
import { Workspace } from './Workspace.tsx';
import { CameraDialog } from './CameraDialog.tsx';
import { HelpDialog, HistoryDialog, LibraryDialog, WelcomeDialog } from './panels.tsx';
import { thumbnail } from './thumbnail.ts';
import { itemsFromSource } from './folderImport.ts';
import { ImportFolderDialog } from './ImportFolderDialog.tsx';
import { SimulateDialog } from './SimulateDialog.tsx';
import { ArrayDialog, JogPad } from './tools.tsx';
import { arrayCopies } from './arrayCopies.ts';
import { FireDialog } from './FireDialog.tsx';
import { DesignsPanel, MaterialsPanel } from './SidePanels.tsx';
import { starterMaterials } from './starterMaterials.ts';
import { buildGrblJobs } from './grblJobs.ts';
import { DEFAULT_PROFILE, estimateProgramSeconds, type MachineProfile } from '../shared/grbl.ts';
import { FIELD } from './model.ts';

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
type DialogName = null | 'text' | 'settings' | 'grid' | 'material' | 'shapes' | 'code' | 'about' | 'batch' | 'camera' | 'library' | 'history' | 'help' | 'welcome' | 'fire' | 'simulate' | 'array' | 'importFolder';
const AIR_KEY = 'lightrunner.airAssist';
const WATTS_KEY = 'lightrunner.laserWatts';
const WELCOME_KEY = 'lightrunner.welcomed';
const MACHINE_KEY = 'lightrunner.machine';
type Machine = { kind: 'lp2' | 'grbl'; bed: { w: number; h: number }; profile?: MachineProfile };
const loadMachine = (): Machine => {
  try {
    return JSON.parse(localStorage.getItem(MACHINE_KEY) ?? '') as Machine;
  } catch {
    return { kind: 'lp2', bed: { w: 100, h: 100 } };
  }
};
const jobSeconds = (jobs: JobSpec[]) => jobs.reduce((s, j) => s + (j.gcode ? estimateProgramSeconds(j.gcode) : estimateSeconds(j)), 0);
const THEME_KEY = 'lightrunner.theme';

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

/** A system notification (shown even when the window is behind others). */
function notify(title: string, body: string) {
  try {
    new Notification(title, { body, silent: false });
  } catch {
    // notifications unavailable: the activity log still has it
  }
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
  const [machine, setMachine] = useState<Machine>(loadMachine);
  const [connectKind, setConnectKind] = useState<'auto' | 'lp2' | 'grbl'>('auto');
  // The work field follows the machine (the last one connected, so designs fit while offline).
  FIELD.w = machine.bed.w;
  FIELD.h = machine.bed.h;
  const isGrbl = machine.kind === 'grbl';
  const buildFor = (list: Item[]) => (isGrbl ? buildGrblJobs(list, machine.profile ?? { ...DEFAULT_PROFILE, bedW: machine.bed.w, bedH: machine.bed.h }, { airAssist }) : buildJobs(list));
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const [log, setLog] = useState<LogLine[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [ldsMaterials, setLdsMaterials] = useState<Material[]>([]);
  const [myMaterials, setMyMaterials] = useState<Material[]>(loadMyMaterials);
  const [brightness, setBrightness] = useState(1);
  const [lockAspect, setLockAspect] = useState(true);
  const [sideTab, setSideTab] = useState<'layers' | 'materials' | 'designs'>('layers');
  const [watts, setWatts] = useState(() => Number(localStorage.getItem(WATTS_KEY)) || 10);
  const [designsKey, setDesignsKey] = useState(0);
  const [homeMenu, setHomeMenu] = useState(false);
  const [jogOpen, setJogOpen] = useState(false);
  const [airAssist, setAirAssist] = useState(() => localStorage.getItem(AIR_KEY) === '1');
  const [snap, setSnap] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [pdf, setPdf] = useState<{ name: string; data: ArrayBuffer; pages: number } | null>(null);
  const [confirm, setConfirm] = useState<{ items: Item[]; jobs: JobSpec[]; seconds: number; warnings: Warning[] } | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [batchWait, setBatchWait] = useState<{ done: number; total: number; resolve: (go: boolean) => void } | null>(null);
  const [batchPerPart, setBatchPerPart] = useState(0);
  const batchStop = useRef(false);
  const [cameraBg, setCameraBg] = useState<{ url: string; opacity: number; show: boolean } | null>(null);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'));
  const materialsInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!localStorage.getItem(WELCOME_KEY)) setDialog('welcome');
  }, []);
  const [settings, setSettings] = useState<DeviceSettings>({ beep: false, reverseDirection: false });
  const [busy, setBusy] = useState(false);
  const [runStarted, setRunStarted] = useState<number | null>(null);
  const [, tick] = useState(0);
  const clipboard = useRef<Item[]>([]);
  const restored = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const note = (message: string, level = 'info') => setLog((l) => [...l.slice(-499), { level, message, at: new Date().toLocaleTimeString() }]);
  const fail = (e: unknown) => note((e as Error)?.message ?? String(e), 'error');

  const allMaterials = useMemo(
    () => [...myMaterials.map((m) => ({ ...m, machine: m.machine ?? 'lp2', name: `★ ${m.name}` })), ...ldsMaterials.map((m) => ({ ...m, machine: 'lp2' as const })), ...starterMaterials(watts)],
    [myMaterials, ldsMaterials, watts],
  );

  const refreshPorts = async () => {
    const list = await laser.ports();
    setPorts(list);
    setPort((cur) => (list.some((p) => p.path === cur) ? cur : list.find((p) => p.likelyLp2)?.path || list[0]?.path || ''));
  };

  // ---------------------------------------------------------------- start-up and laser events

  useEffect(() => {
    refreshPorts().catch(fail);
    // After a window reload the laser may still be connected in the background.
    laser
      .state()
      .then((info) => {
        if (!info) return;
        setDevice(info);
        setMachine({ kind: info.kind, bed: info.bed, profile: info.profile });
        setPort(info.path);
      })
      .catch(() => undefined);
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
        setReconnecting(!e.connected && !!e.reconnecting);
        if (e.connected) {
          setDevice(e.info ?? null);
          if (e.info) {
            const m: Machine = { kind: e.info.kind, bed: e.info.bed, profile: e.info.profile };
            setMachine(m);
            localStorage.setItem(MACHINE_KEY, JSON.stringify(m));
          }
        }
        else if (!e.reconnecting) {
          setDevice(null);
          setStatus(null);
          note('Disconnected from the laser.');
        }
      }
    });
  }, []);

  // Autosave the design a moment after each change.
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => laser.saveDraft(JSON.stringify({ app: 'Light Runner', version: 3, items })).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [items]);

  // A clock for the elapsed time while a job runs.
  useEffect(() => {
    if (run.phase === 'idle' || run.phase === 'previewing') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [run.phase]);

  // Keep the on-screen look of images up to date. Each image is drawn once per look and cached,
  // so a change to one doesn't redraw the rest and one failure can't hold up the others.
  const previewCache = useRef(new Map<string, string>());
  const lookOf = (i: ImageItem) => [i.src.length, i.src.slice(-32), i.mode, i.threshold, i.invert, i.brightness, i.contrast, i.ditherMethod, i.gamma, i.sharpen, i.removeBackground, i.backgroundTolerance, i.w.toFixed(1), i.h.toFixed(1), i.resolution].join(':');
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
        const cached = previewCache.current.get(look);
        if (cached) {
          setPreviews((p) => (p[item.id] === cached ? p : { ...p, [item.id]: cached }));
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

  const selected = useMemo(() => new Set(selection), [selection]);
  const selItems = items.filter((i) => selected.has(i.id));
  const sel = selItems.length === 1 ? selItems[0] : null;
  const update = (id: string, patch: Partial<Item>, key?: string) =>
    history.commit((list) => list.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i)), key ? `${id}:${key}` : undefined);
  const updateMany = (ids: Set<string>, patch: Partial<Item> | ((i: Item) => Partial<Item>), key?: string) =>
    history.commit((list) => list.map((i) => (ids.has(i.id) ? ({ ...i, ...(typeof patch === 'function' ? patch(i) : patch) } as Item) : i)), key ? `many:${key}` : undefined);
  const visible = items.filter((i) => i.visible);
  const working = run.phase !== 'idle' && run.phase !== 'previewing';

  const select = (ids: string[], additive: boolean) => {
    if (!additive) return setSelection(ids);
    setSelection((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (ids.length === 1 && next.has(id)) next.delete(id);
        else next.add(id);
      }
      return [...next];
    });
  };

  // ---------------------------------------------------------------- adding things

  const addItems = (added: Item[]) => {
    if (!added.length) return;
    history.commit((l) => [...l, ...added]);
    setSelection(added.map((i) => i.id));
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
        } else if (['gcode', 'nc', 'gc', 'ngc', 'tap'].includes(ext)) {
          added.push(vectorItem(file.name, readGcode(await file.text()), 100));
        } else if (ext === 'pdf') {
          const data = await file.arrayBuffer();
          const pages = await pdfPageCount(data);
          if (pages > 1) setPdf({ name: file.name, data, pages });
          else added.push(await pdfItem(file.name, data, 1));
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

  const pdfItem = async (name: string, data: ArrayBuffer, page: number): Promise<ImageItem> => {
    const p = await renderPdfPage(data, page);
    return imageItem(`${name} p${page}`, p.src, p.widthMm, p.heightMm, { mode: 'bw', ...fitToField(p.widthMm, p.heightMm, 100) });
  };

  const addText = (t: TextChoice) => {
    setDialog(null);
    const src: TextSource = {
      template: t.text,
      style: t.style,
      font: t.font,
      bold: t.bold,
      italic: t.italic,
      heightMm: t.style === 'single' ? t.heightMm : 5,
      align: t.align,
      arc: t.style === 'single' && t.arc ? { radiusMm: t.radiusMm, bottom: t.bottom } : undefined,
    };
    try {
      // Show the first part's words while designing; batches fill in each part's.
      addItems([makeTextItem(src, fillTemplate(t.text, batchValues(BATCH_DEFAULTS, 0)))]);
    } catch (e) {
      fail(e);
    }
  };

  const addCode = async (c: CodeChoice) => {
    try {
      if (c.kind === 'qr') {
        const qr = qrPaths(c.text.trim(), c.level, c.border ? 4 : 0);
        const item = vectorItem(`QR: ${c.text.slice(0, 24)}`, { paths: qr.paths, width: qr.size, height: qr.size });
        addItems([{ ...item, mode: 'fill', ...fitToField(c.sizeMm, c.sizeMm, 100) }]);
        const module = c.sizeMm / qr.size;
        if (module < 0.3) note(`Each QR square is only ${module.toFixed(2)} mm; make the code bigger or use 2K if phones can't read it.`, 'error');
      } else {
        const b = await barcodePaths(c.text.trim(), c.format);
        const item = vectorItem(`Barcode: ${c.text.slice(0, 24)}`, { paths: b.paths, width: b.width, height: b.height });
        const h = (c.sizeMm * b.height) / b.width;
        addItems([{ ...item, mode: 'fill', ...fitToField(c.sizeMm, Math.max(h, c.sizeMm * 0.3), 100) }]);
      }
      setDialog(null);
    } catch (e) {
      fail(e);
    }
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
      ...(spec.speedMode ? { speed: c.depth, depth: DEFAULTS.depth } : { depth: c.depth }),
      passes: spec.passes,
    }));
    // Labels in the fast single-line font.
    for (const l of labels) {
      const t = hersheyText(l.text, l.h * 0.8);
      const w = Math.min(l.w, t.width);
      const h = (t.height * w) / t.width;
      made.push({ ...vectorItem(`Label ${l.text}`, { paths: t.paths, width: t.width, height: t.height }), x: l.x + (l.w - w) / 2, y: l.y + (l.h - h) / 2, w, h, power: labelPower, depth: labelDepth });
    }
    addItems(made);
    note(`Added a ${spec.cols} × ${spec.rows} material test (${cells.length} squares).`);
  };

  /** A small set covering every kind of job, for checking a new version or a new laser on scrap. */
  const addSelfTest = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 200, 0);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#fff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 200, 200);
    const gradient = canvas.toDataURL('image/png');
    const sq = shapePaths('square');
    const circle = shapePaths('circle');
    const label = hersheyText('LIGHT RUNNER TEST', 2.5);
    const at = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
    const made: Item[] = [
      { ...vectorItem('Self-test: outline', { paths: sq.paths, width: 20, height: 20 }), ...at(30, 30, 15, 15) },
      { ...vectorItem('Self-test: fill', { paths: circle.paths, width: 20, height: 20 }), mode: 'fill', ...at(55, 30, 15, 15) },
      imageItem('Self-test: dither', gradient, 15, 15, { mode: 'dither', ...at(30, 55, 15, 15) }),
      imageItem('Self-test: greyscale', gradient, 15, 15, { mode: 'grey', ...at(55, 55, 15, 15) }),
      { ...vectorItem('Self-test: label', { paths: label.paths, width: label.width, height: label.height }), ...at(30, 75, 40, (40 * label.height) / label.width) },
    ];
    addItems(made);
    note('Added the self-test: engrave it on scrap and check the outline is closed, the circle is evenly filled and the two gradients run from dark to light.');
  };

  // ---------------------------------------------------------------- editing

  const removeSelected = () => {
    if (!selection.length) return;
    history.commit((l) => l.filter((i) => !selected.has(i.id)));
    setSelection([]);
  };

  const duplicate = (sources: Item[] = selItems, offset = 3) => {
    if (!sources.length) return;
    addItems(sources.map((s) => ({ ...structuredClone(s), id: newId(), name: sources.length === 1 ? `${s.name} copy` : s.name, x: s.x + offset, y: s.y + offset })));
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

  const materialPatch = (item: Item, materialId: string): Partial<Item> | null => {
    const m = allMaterials.find((x) => x.id === materialId);
    if (!m) return { material: undefined };
    const dpi = item.resolution === '2K' ? 508 : 254;
    const best = m.presets.filter((p) => p.mode === presetMode(item)).sort((a, b) => Math.abs(a.dpi - dpi) - Math.abs(b.dpi - dpi))[0];
    if (!best) {
      note(`${m.name} has no setting for ${MODE_LABEL[item.mode].toLowerCase()} jobs; ${item.name} is unchanged.`, 'error');
      return null;
    }
    return { material: materialId, power: best.power, depth: Math.max(1, best.depth), passes: best.passes, ...(best.speed ? { speed: best.speed } : {}) };
  };

  const applyMaterial = (targets: Item[], materialId: string) => {
    if (materialId === '?') return;
    const patches = new Map(targets.map((i) => [i.id, materialPatch(i, materialId)] as const));
    updateMany(new Set(targets.map((i) => i.id)), (i) => patches.get(i.id) ?? {});
  };

  const saveMaterial = (name: string) => {
    setDialog(null);
    if (!sel) return;
    const preset = { mode: presetMode(sel), dpi: sel.resolution === '2K' ? 508 : 254, power: sel.power, depth: sel.depth, passes: sel.passes, ...(isGrbl ? { speed: sel.speed ?? 1500 } : {}) };
    const existing = myMaterials.find((m) => m.name.toLowerCase() === name.toLowerCase() && (m.machine ?? 'lp2') === machine.kind);
    const next = existing
      ? myMaterials.map((m) => (m === existing ? { ...m, presets: [...m.presets.filter((p) => !(p.mode === preset.mode && p.dpi === preset.dpi)), preset] } : m))
      : [...myMaterials, { id: `my-${newId()}`, name, machine: machine.kind, ...(isGrbl ? { watts } : {}), presets: [preset] }];
    setMyMaterials(next);
    localStorage.setItem(MY_MATERIALS_KEY, JSON.stringify(next));
    update(sel.id, { material: (existing ?? next[next.length - 1]).id });
    note(`Saved "${name}" for ${MODE_LABEL[sel.mode].toLowerCase()} at ${sel.resolution}.`);
  };

  // ---------------------------------------------------------------- projects

  const saveDesign = async (name: string, id?: string) => {
    const thumb = await thumbnail(items, previews);
    const saved = await laser.library.save(name, { app: 'Light Runner', version: 3, items }, thumb, id);
    setLibraryId(saved);
    setDesignsKey((k) => k + 1);
    note(`Saved "${name}" to My designs.`);
  };

  const openDesign = async (id: string, name: string) => {
    try {
      const stored = await laser.library.load(id);
      const loaded = stored.source ? await itemsFromSource(stored.source) : ((stored.design as { items: Item[] }).items ?? []).map(normalizeItem);
      history.commit(loaded);
      setSelection([]);
      // An imported design opens as a new one (saving makes your own copy).
      setLibraryId(stored.source ? null : id);
      setDialog(null);
      note(`Opened "${name}".`);
    } catch (e) {
      fail(e);
    }
  };

  const saveProject = () => download('design.lightrunner.json', JSON.stringify({ app: 'Light Runner', version: 3, items }, null, 1), 'application/json');

  const openProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'Light Runner' || !Array.isArray(data.items)) throw new Error('That is not a Light Runner design.');
      history.commit(data.items.map(normalizeItem));
      setSelection([]);
      note(`Opened ${file.name}.`);
    } catch (e) {
      fail(e);
    }
  };

  const newDesign = () => {
    if (items.length && !window.confirm('Start a new design? You can undo this.')) return;
    history.commit([]);
    setSelection([]);
    setLibraryId(null);
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

  const connect = () => act(async () => (device ? laser.disconnect() : laser.connect(port, connectKind)));

  const previewTargets = selItems.filter((i) => i.visible).length ? selItems.filter((i) => i.visible) : visible;
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
      const jobs = await buildFor(visible);
      const seconds = jobSeconds(jobs);
      setConfirm({ items: visible, jobs, seconds, warnings: jobWarnings(visible, seconds, machine.kind) });
    });

  const engrave = (jobs: JobSpec[]) =>
    act(async () => {
      setConfirm(null);
      if (run.phase === 'previewing') await laser.stopPreview();
      note(`Sending ${jobs.length} job${jobs.length === 1 ? '' : 's'}.`);
      const started = Date.now();
      setRunStarted(started);
      let result: 'finished' | 'stopped' | 'failed' = 'finished';
      try {
        batchStop.current = false;
        await laser.run(jobs);
        if (batchStop.current) result = 'stopped';
        note(`Done in ${formatDuration((Date.now() - started) / 1000)}.`);
        notify(batchStop.current ? 'Job stopped' : 'Job finished', `${jobs.length === 1 ? jobs[0].name : `${jobs.length} jobs`} · ${formatDuration((Date.now() - started) / 1000)}`);
      } catch (e) {
        result = 'failed';
        throw e;
      } finally {
        setRunStarted(null);
        const snapshot = confirm?.items ?? visible;
        laser.history
          .add({ at: started, names: snapshot.map((i) => i.name), jobs: jobs.length, seconds: (Date.now() - started) / 1000, result }, { app: 'Light Runner', version: 3, items: snapshot })
          .catch(() => undefined);
      }
    });

  /** Opens the batch dialog with a time estimate for one part. */
  const askBatch = () =>
    act(async () => {
      if (!visible.length) throw new Error('Add something to engrave first.');
      const outside = visible.filter((i) => !insideField(i));
      if (outside.length) throw new Error(`${outside.map((i) => i.name).join(', ')} ${outside.length === 1 ? 'is' : 'are'} outside the field.`);
      const jobs = await buildFor(visible);
      setBatchPerPart(jobSeconds(jobs));
      setDialog('batch');
    });

  const runBatch = (spec: BatchSpec) =>
    act(async () => {
      setDialog(null);
      batchStop.current = false;
      const total = batchCount(spec);
      const base = visible;
      if (run.phase === 'previewing') await laser.stopPreview();
      for (let i = 0; i < total && !batchStop.current; i++) {
        const values = batchValues(spec, i);
        const part = base.map((it) => (it.text && hasPlaceholders(it.text.template) ? rewordItem(it, fillTemplate(it.text.template, values)) : it));
        const jobs = await buildFor(part);
        note(`Batch part ${i + 1} of ${total}${spec.lines.length ? `: ${values.line}` : `: #${values.n}`}.`);
        await laser.run(jobs);
        if (batchStop.current) break;
        if (i < total - 1) {
          const go = await new Promise<boolean>((resolve) => setBatchWait({ done: i + 1, total, resolve }));
          setBatchWait(null);
          if (!go) break;
        }
      }
      note(batchStop.current ? 'Batch stopped.' : `Batch finished: ${total} parts.`);
    });

  // ---------------------------------------------------------------- keyboard

  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    if (dialog || confirm || pdf) return;
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
    } else if (ctrl && k === 'a') {
      e.preventDefault();
      setSelection(items.filter((i) => i.visible).map((i) => i.id));
    } else if (ctrl && k === 'd') {
      e.preventDefault();
      duplicate();
    } else if (ctrl && k === 'c' && selItems.length) {
      clipboard.current = structuredClone(selItems);
    } else if (ctrl && k === 'v' && clipboard.current.length) {
      duplicate(clipboard.current, 5);
    } else if ((k === 'delete' || k === 'backspace') && selection.length) {
      removeSelected();
    } else if (k === 'escape') {
      setSelection([]);
    } else if (selection.length && k.startsWith('arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
      const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
      const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
      updateMany(selected, (i) => ({ x: Math.round((i.x + dx) * 100) / 100, y: Math.round((i.y + dy) * 100) / 100 }), 'nudge');
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  // ---------------------------------------------------------------- view

  const elapsed = runStarted ? ` · ${formatDuration((Date.now() - runStarted) / 1000)}` : '';
  const statusText = (() => {
    if (reconnecting) return 'Connection lost — reconnecting to the LP2… (check the USB cable)';
    if (!device) return 'Not connected';
    if (run.phase === 'uploading') return `Sending ${run.name ?? ''} — ${run.size ? Math.round(((run.uploaded ?? 0) / run.size) * 100) : 0} %${elapsed}`;
    if (run.phase === 'engraving' || run.phase === 'paused')
      return `${run.phase === 'paused' ? 'Paused' : 'Engraving'} ${run.name ?? ''} — ${status?.progress ?? 0} %${run.jobs && run.jobs > 1 ? ` · job ${run.job} of ${run.jobs}` : ''}${elapsed}`;
    if (run.phase === 'previewing') return isGrbl ? 'Framing — the head traces the outline with the laser off' : 'Previewing — the LP2 is tracing the frame';
    if (run.phase === 'stopping') return 'Stopping';
    return 'Ready';
  })();

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
        <select value={connectKind} onChange={(e) => setConnectKind(e.target.value as 'auto' | 'lp2' | 'grbl')} disabled={!!device} title="What kind of laser is on this port">
          <option value="auto">Find out</option>
          <option value="lp2">LaserPecker LP2</option>
          <option value="grbl">G-code laser (GRBL)</option>
        </select>
        <button onClick={() => refreshPorts().catch(fail)} disabled={!!device} title="Look for serial ports again">
          ↻
        </button>
        <button className={device ? '' : 'primary'} onClick={connect} disabled={busy || (!device && !port) || working}>
          {device ? 'Disconnect' : 'Connect'}
        </button>
        <div className="device">
          {device
            ? device.kind === 'grbl'
              ? `${device.firmware ?? 'GRBL'} · ${device.bed.w} × ${device.bed.h} mm`
              : `LP2${device.deviceId ? `-${device.deviceId}` : ''} · firmware ${device.firmware ?? '?'}`
            : isGrbl
              ? `Designing for the G-code laser (${machine.bed.w} × ${machine.bed.h} mm)`
              : ''}
        </div>
        <div className="spacer" />
        <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)">
          ↷ Redo
        </button>
        <button onClick={() => setDialog('library')} title="Your saved designs, and sharing materials">
          My designs
        </button>
        <button onClick={() => setDialog('history')} title="Jobs you've engraved; run one again">
          History
        </button>
        {!isGrbl && <button onClick={() => setDialog('settings')}>Device settings</button>}
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} aria-label="Switch theme">
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button onClick={() => setDialog('help')}>Help</button>
        <button onClick={() => setDialog('about')} title="Version and updates">
          About
        </button>
      </header>

      <div className="main">
        <nav className="tools">
          <button onClick={() => fileInput.current?.click()} title="SVG, DXF, PDF, G-code or a picture (Ctrl+I); you can also drop files on the window">
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
          <button onClick={() => setDialog('code')} title="QR codes and barcodes">
            QR / barcode
          </button>
          <button onClick={() => setDialog('grid')} title="A grid of power and depth settings to test a material">
            Test grid
          </button>
          <button onClick={() => setDialog('simulate')} disabled={!visible.length} title="Play back the path the laser will take, without firing">
            Simulate
          </button>
          <button onClick={() => setDialog('array')} disabled={!selItems.length} title="Copies of the selection in rows and columns">
            Array
          </button>
          <button onClick={() => setDialog('camera')} title="See the real object under your design (webcam or photo)">
            Camera
          </button>
          <button onClick={addSelfTest} title="One of each kind of job, to check the laser and the app on scrap">
            Self-test
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
          <input ref={fileInput} type="file" multiple accept=".svg,.dxf,.pdf,.gcode,.nc,.gc,.ngc,.tap,.png,.jpg,.jpeg,.bmp,.webp,.gif" hidden onChange={(e) => importFiles(e.target.files).then(() => (e.target.value = ''))} />
          <input ref={projectInput} type="file" accept=".json" hidden onChange={(e) => openProject(e.target.files?.[0]).then(() => (e.target.value = ''))} />
        </nav>

        <section className="canvas">
          <Workspace
            items={items}
            previews={previews}
            selected={selected}
            snap={snap}
            onSelect={select}
            onMoveStart={history.checkpoint}
            onMove={(pos) => history.replace((l) => l.map((i) => (pos.has(i.id) ? { ...i, ...pos.get(i.id)! } : i)))}
            background={cameraBg?.show ? cameraBg : null}
            head={isGrbl && device ? (status?.pos ?? null) : null}
          />
          {cameraBg && (
            <div className="camera-bar">
              <label className="check">
                <input type="checkbox" checked={cameraBg.show} onChange={(e) => setCameraBg({ ...cameraBg, show: e.target.checked })} /> Photo
              </label>
              <input type="range" min="10" max="100" value={Math.round(cameraBg.opacity * 100)} onChange={(e) => setCameraBg({ ...cameraBg, opacity: Number(e.target.value) / 100 })} title="How strongly the photo shows" />
              <button className="small" onClick={() => setDialog('camera')}>
                Retake
              </button>
            </div>
          )}
          {!items.length && <div className="empty">Import an SVG, DXF, PDF, G-code or picture (or drop it here), or add text, a shape, a QR code or a test grid.</div>}
        </section>

        <aside className="side">
          <div className="side-tabs" role="tablist">
            {(['layers', 'materials', 'designs'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={sideTab === t} className={sideTab === t ? 'on' : ''} onClick={() => setSideTab(t)}>
                {t === 'layers' ? `Layers${items.length ? ` (${items.length})` : ''}` : t === 'materials' ? 'Materials' : 'Designs'}
              </button>
            ))}
          </div>
          {sideTab === 'materials' && (
            <MaterialsPanel
              machine={machine.kind}
              materials={allMaterials}
              watts={watts}
              onWatts={(w) => {
                setWatts(w);
                localStorage.setItem(WATTS_KEY, String(w));
              }}
              selectedCount={selItems.length}
              onApply={(id) => applyMaterial(selItems, id)}
              onSaveFromSelection={() => setDialog('material')}
              onDelete={(id) => {
                const next = myMaterials.filter((m) => m.id !== id);
                setMyMaterials(next);
                localStorage.setItem(MY_MATERIALS_KEY, JSON.stringify(next));
              }}
              onExport={() => download('my-materials.lightrunner-materials.json', JSON.stringify({ app: 'Light Runner materials', version: 1, materials: myMaterials }, null, 1), 'application/json')}
              onImport={() => materialsInput.current?.click()}
            />
          )}
          {sideTab === 'designs' && <DesignsPanel currentId={libraryId} onOpen={openDesign} onSave={saveDesign} refreshKey={designsKey} onImportFolder={() => setDialog('importFolder')} />}
          {sideTab === 'layers' && (
          <>
          <h3>Engrave order</h3>
          <ul className="layers">
            {items.map((i) => (
              <li
                key={i.id}
                tabIndex={0}
                className={selected.has(i.id) ? 'on' : ''}
                onClick={(e) => select([i.id], e.ctrlKey || e.shiftKey || e.metaKey)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select([i.id], e.ctrlKey || e.shiftKey))}
                title="Ctrl- or Shift-click to select several"
              >
                <input type="checkbox" checked={i.visible} title="Engrave this" onChange={(e) => update(i.id, { visible: e.target.checked })} onClick={(e) => e.stopPropagation()} />
                <span>{i.name}</span>
                <small>{MODE_LABEL[i.mode]}</small>
              </li>
            ))}
            {!items.length && <li className="hint">Nothing yet.</li>}
          </ul>

          {sel && (
            <Properties
              machine={machine.kind}
              item={sel}
              materials={allMaterials.filter((m) => m.machine === machine.kind)}
              lockAspect={lockAspect}
              onLockAspect={setLockAspect}
              onChange={(patch, key) => update(sel.id, patch, key)}
              onMaterial={(id) => applyMaterial([sel], id)}
              onSaveMaterial={() => setDialog('material')}
              onTrace={trace}
              onOffset={(mm) => {
                try {
                  if (sel.kind === 'vector') addItems([offsetItem(sel, mm)]);
                } catch (e) {
                  fail(e);
                }
              }}
              onExportGcode={() => sel.kind === 'vector' && download(`${sel.name.replace(/\.[^.]+$/, '')}.gcode`, gcodeText(sel))}
              onDuplicate={() => duplicate()}
              onDelete={removeSelected}
              onOrder={(dir) => reorder(sel.id, dir)}
            />
          )}
          {selItems.length > 1 && (
            <MultiProperties
              machine={machine.kind}
              items={selItems}
              materials={allMaterials.filter((m) => m.machine === machine.kind)}
              onChangeAll={(patch, key) => updateMany(selected, patch, key)}
              onAlign={(how) => {
                const pos = alignGroupToField(selItems, how);
                updateMany(selected, (i) => pos.get(i.id) ?? {});
              }}
              onMaterial={(id) => applyMaterial(selItems, id)}
              onCombine={(op) => {
                try {
                  const shapes = items.filter((i): i is VectorItem => selected.has(i.id) && i.kind === 'vector');
                  const made = combineItems(shapes, op);
                  history.commit((l) => [...l.filter((i) => !selected.has(i.id)), made]);
                  setSelection([made.id]);
                } catch (e) {
                  fail(e);
                }
              }}
              onDuplicate={() => duplicate()}
              onDelete={removeSelected}
            />
          )}
          </>
          )}
        </aside>
      </div>

      <footer className="bar run">
        <div className="statusline">
          <span className={`dot ${reconnecting ? 'busy' : device ? (working ? 'busy' : 'ok') : ''}`} />
          <span className="status-text">{statusText}</span>
          <div className="progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
        {!isGrbl && (
          <label className="bright" title="How bright the preview light is">
          Preview light
          <input type="range" min="1" max="10" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
        </label>
        )}
        {run.phase === 'previewing' ? (
          <button onClick={() => laser.stopPreview().catch(fail)}>
            Stop preview
          </button>
        ) : (
          <>
            {isGrbl && (
              <>
                <div className="menu-wrap up">
                  <button onClick={() => setHomeMenu(!homeMenu)} disabled={!device || busy || working} title="Go to 0,0, set 0,0 here, or run the homing cycle">
                    Home ▾
                  </button>
                  {homeMenu && (
                    <div className="menu" onMouseLeave={() => setHomeMenu(false)}>
                      <button onClick={() => (setHomeMenu(false), act(() => laser.home('origin')))}>Go to 0,0</button>
                      <button onClick={() => (setHomeMenu(false), act(() => laser.home('zero')))}>Set this spot as 0,0</button>
                      <button onClick={() => (setHomeMenu(false), act(() => laser.home('cycle')))}>Homing cycle ($H, needs limit switches)</button>
                    </div>
                  )}
                </div>
                <div className="menu-wrap up">
                  <button onClick={() => setJogOpen(!jogOpen)} disabled={!device} title="Move the head with the arrows">
                    Jog
                  </button>
                  {jogOpen && (
                    <JogPad
                      pos={status?.pos ? { x: status.pos.x, y: (machine.profile?.originBottomLeft ?? true) ? FIELD.h - status.pos.y : status.pos.y } : null}
                      busy={busy || working}
                      canGoToSelection={!!selItems.length}
                      onJog={(dx, dy) => laser.jog({ dx, dy }).catch(fail)}
                      onGoTo={(x, y) => laser.jog({ to: { x, y } }).catch(fail)}
                      onGoToSelection={() => {
                        const b = boundsOf(selItems);
                        if (b) laser.jog({ to: { x: b.x, y: b.y } }).catch(fail);
                      }}
                      onClose={() => setJogOpen(false)}
                    />
                  )}
                </div>
                <label className="check" title="Turn air assist on (M8) for the whole job">
                  <input
                    type="checkbox"
                    checked={airAssist}
                    onChange={(e) => {
                      setAirAssist(e.target.checked);
                      localStorage.setItem(AIR_KEY, e.target.checked ? '1' : '0');
                    }}
                  />{' '}
                  Air
                </label>
                <button className="danger" onClick={() => setDialog('fire')} disabled={!device || busy || working} title="Test fire the laser (beam or strobe)">
                  Fire laser…
                </button>
              </>
            )}
            <button onClick={() => startPreview(false)} disabled={!device || busy || working || !previewTargets.length} title="Trace the frame of what will be engraved">
              Preview {selItems.some((i) => i.visible) ? 'selected' : 'all'}
            </button>
            <button onClick={() => startPreview(true)} disabled={isGrbl || !device || busy || working || !previewTargets.length} title={isGrbl ? 'The LP2 can show a centre point; G-code lasers trace the frame' : 'Show just the centre point'}>
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
        <button onClick={askBatch} disabled={!device || busy || working} title="Engrave the design on several parts, with serial numbers or names">
          Batch…
        </button>
        <button
          className="danger"
          onClick={() => {
            batchStop.current = true;
            act(() => laser.stop());
          }}
          disabled={!device || run.phase === 'idle'}
        >
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

      {confirm && <ConfirmDialog items={confirm.items} jobs={confirm.jobs.length} seconds={confirm.seconds} warnings={confirm.warnings} machine={machine.kind} onCancel={() => setConfirm(null)} onGo={() => engrave(confirm.jobs)} />}
      {dialog === 'text' && <TextDialog onCancel={() => setDialog(null)} onAdd={addText} />}
      {dialog === 'batch' && (
        <BatchDialog
          templates={visible.filter((i) => i.text && hasPlaceholders(i.text.template)).map((i) => i.text!.template)}
          secondsPerPart={batchPerPart}
          onCancel={() => setDialog(null)}
          onStart={runBatch}
        />
      )}
      {batchWait && (
        <NextPartDialog
          done={batchWait.done}
          total={batchWait.total}
          onNext={() => batchWait.resolve(true)}
          onStop={() => {
            batchStop.current = true;
            batchWait.resolve(false);
          }}
        />
      )}
      {dialog === 'camera' && (
        <CameraDialog
          connected={!!device}
          previewing={run.phase === 'previewing'}
          onTraceField={() => laser.preview({ x: 0, y: 0, width: FIELD.w * 10, height: FIELD.h * 10, brightness })}
          onStopTrace={() => laser.stopPreview()}
          onCancel={() => {
            setDialog(null);
            if (run.phase === 'previewing') act(() => laser.stopPreview());
          }}
          onDone={(url) => {
            setCameraBg({ url, opacity: 0.6, show: true });
            setDialog(null);
            if (run.phase === 'previewing') act(() => laser.stopPreview()); // busy until the light has stopped
            note('The photo is under your design. Line the design up with the object, then Preview to check.');
          }}
        />
      )}
      {dialog === 'importFolder' && <ImportFolderDialog onClose={() => setDialog(null)} onDone={() => setDesignsKey((k) => k + 1)} />}
      {dialog === 'simulate' && <SimulateDialog items={visible} machine={machine.kind} onClose={() => setDialog(null)} />}
      {dialog === 'array' && selItems.length > 0 && (
        <ArrayDialog
          items={selItems}
          onCancel={() => setDialog(null)}
          onMake={(rows, cols, gapX, gapY) => {
            const copies = arrayCopies(selItems, rows, cols, gapX, gapY);
            history.commit((l) => [...l, ...copies]);
            setSelection([...selection, ...copies.map((c) => c.id)]);
            setDialog(null);
            note(`Made ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} (${rows} × ${cols}).`);
          }}
        />
      )}
      {dialog === 'fire' && (
        <FireDialog
          firing={run.phase === 'firing'}
          onStart={(spec) => laser.fire(spec)}
          onStop={() => laser.stopFire()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'library' && (
        <LibraryDialog
          currentId={libraryId}
          onClose={() => setDialog(null)}
          onSave={saveDesign}
          onOpen={openDesign}
          onExportMaterials={() => download('my-materials.lightrunner-materials.json', JSON.stringify({ app: 'Light Runner materials', version: 1, materials: myMaterials }, null, 1), 'application/json')}
          onImportMaterials={() => materialsInput.current?.click()}
          onImportFolder={() => setDialog('importFolder')}
        />
      )}
      {dialog === 'history' && (
        <HistoryDialog
          onClose={() => setDialog(null)}
          onLoad={async (id, rerun) => {
            try {
              const design = (await laser.history.design(id)) as { items: Item[] };
              const loaded = design.items.map(normalizeItem);
              history.commit(loaded);
              setSelection([]);
              setDialog(null);
              if (rerun) {
                if (!device) throw new Error('Connect the laser to run it again.');
                const jobs = await buildFor(loaded.filter((i) => i.visible));
                const seconds = jobSeconds(jobs);
                setConfirm({ items: loaded.filter((i) => i.visible), jobs, seconds, warnings: jobWarnings(loaded, seconds, machine.kind) });
              }
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} onWelcome={() => setDialog('welcome')} />}
      {dialog === 'welcome' && (
        <WelcomeDialog
          onClose={(dontShow) => {
            if (dontShow) localStorage.setItem(WELCOME_KEY, '1');
            setDialog(null);
          }}
        />
      )}
      <input
        ref={materialsInput}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            if (data.app !== 'Light Runner materials' || !Array.isArray(data.materials)) throw new Error('That is not a Light Runner materials file.');
            const known = new Set(myMaterials.map((m) => m.name.toLowerCase()));
            const added = (data.materials as Material[]).filter((m) => m && m.name && Array.isArray(m.presets) && !known.has(m.name.toLowerCase())).map((m) => ({ ...m, id: `my-${newId()}` }));
            const next = [...myMaterials, ...added];
            setMyMaterials(next);
            localStorage.setItem(MY_MATERIALS_KEY, JSON.stringify(next));
            note(added.length ? `Added ${added.length} material${added.length === 1 ? '' : 's'}.` : 'Those materials are already here.');
          } catch (err) {
            fail(err);
          }
        }}
      />
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      {dialog === 'code' && <CodeDialog onCancel={() => setDialog(null)} onAdd={addCode} />}
      {dialog === 'grid' && <TestGridDialog speedMode={isGrbl} onCancel={() => setDialog(null)} onCreate={addTestGrid} />}
      {dialog === 'material' && sel && <SaveMaterialDialog suggested="" onCancel={() => setDialog(null)} onSave={saveMaterial} />}
      {pdf && (
        <PdfPageDialog
          name={pdf.name}
          pages={pdf.pages}
          onCancel={() => setPdf(null)}
          onPick={(page) => {
            const p = pdf;
            setPdf(null);
            pdfItem(p.name, p.data, page)
              .then((item) => addItems([item]))
              .catch(fail);
          }}
        />
      )}
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
