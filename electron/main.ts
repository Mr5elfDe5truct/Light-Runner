import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, shell } from 'electron';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeviceSettings } from '../shared/lp2.ts';
import type { DesignSource, FolderFile, JobSpec, LaserEvent, PreviewSpec } from '../shared/types.ts';
import { Machines } from './machines.ts';
import { loadMaterials } from './materials.ts';
import { Store } from './store.ts';

const laser = new Machines();
let win: BrowserWindow | null = null;

const settingsFile = () => path.join(app.getPath('userData'), 'device-settings.json');
const DEFAULT_SETTINGS: DeviceSettings = { beep: false, reverseDirection: false };

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Light Runner',
    backgroundColor: '#15171c',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'dist', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // While developing, show the window's warnings and errors in the terminal.
  if (!app.isPackaged) win.webContents.on('console-message', (e) => e.level !== 'info' && e.level !== 'debug' && console.log(`[window ${e.level}] ${e.message}`));
  win.on('closed', () => (win = null));
}

laser.on('event', (e: LaserEvent) => win?.webContents.send('laser:event', e));

const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) =>
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)));

handle('laser:ports', () => laser.ports());
handle('laser:state', () => laser.info);
handle('laser:connect', (p: string, kind?: 'lp2' | 'grbl' | 'auto') => laser.connect(p, kind ?? 'auto'));
handle('laser:disconnect', () => laser.disconnect());
handle('laser:run', async (jobs: JobSpec[]) => {
  // Keep Windows from sleeping mid-job (the screen may still turn off).
  const blocker = powerSaveBlocker.start('prevent-app-suspension');
  try {
    return await laser.run(jobs.map((j) => ({ ...j, file: new Uint8Array(j.file) })));
  } finally {
    powerSaveBlocker.stop(blocker);
  }
});
handle('laser:pause', () => laser.pause());
handle('laser:resume', () => laser.resume());
handle('laser:stop', () => laser.stop());
handle('laser:preview', (spec: PreviewSpec) => laser.preview(spec));
handle('laser:stop-preview', () => laser.stopPreview());
handle('laser:home', (how?: 'origin' | 'zero' | 'cycle') => laser.home(how ?? 'origin'));
handle('laser:fire', (spec: import('../shared/grbl.ts').FireSpec) => laser.fire(spec));
handle('laser:stop-fire', () => laser.stopFire());
handle('laser:jog', (move: { dx?: number; dy?: number; to?: { x: number; y: number } }, feed?: number) => laser.jog(move, feed));
handle('laser:cancel-jog', () => laser.cancelJog());
handle('laser:materials', () => loadMaterials());

// ---------------------------------------------------------------- about and updates

const REPO = 'Mr5elfDe5truct/Light-Runner';
const newer = (a: string, b: string) => {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};
handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, data: app.getPath('userData') }));
/** Asks GitHub for the newest published release. Nothing about the user is sent. */
handle('app:check-update', async () => {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'Light-Runner-update-check', Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return { current: app.getVersion(), latest: null, url: null, newer: false, note: 'No releases have been published yet.' };
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const body = (await res.json()) as { tag_name: string; html_url: string };
  return { current: app.getVersion(), latest: body.tag_name, url: body.html_url, newer: newer(body.tag_name, app.getVersion()) };
});
handle('app:open-url', (url: string) => {
  if (!/^https:\/\/github\.com\//.test(url)) throw new Error('Only GitHub links can be opened from here.');
  return shell.openExternal(url);
});

// ---------------------------------------------------------------- library and history

let store: Store | null = null;
const st = () => (store ??= new Store(app.getPath('userData')));
handle('library:list', () => st().listLibrary());
handle('library:save', (name: string, design: unknown, thumb: string, id?: string, extra?: { folder?: string; source?: DesignSource }) => st().saveToLibrary(name, design, thumb, id, extra));

// Importing a folder: the person picks it, then only files inside folders they picked can be read.
const pickedRoots = new Set<string>();
const KINDS: Record<string, FolderFile['kind']> = { svg: 'svg', dxf: 'dxf', gcode: 'gcode', nc: 'gcode', gc: 'gcode', ngc: 'gcode', png: 'image', jpg: 'image', jpeg: 'image', bmp: 'image', webp: 'image', lbrn: 'unsupported', lbrn2: 'unsupported' };
handle('library:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Choose a folder of designs', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const root = r.filePaths[0];
  pickedRoots.add(path.resolve(root));
  const base = path.dirname(root);
  const files: FolderFile[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 8 || files.length > 20000) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        const kind = KINDS[ext];
        if (!kind) continue;
        files.push({ path: full, name: path.basename(entry.name, path.extname(entry.name)), folder: path.relative(base, dir).split(path.sep).join('/'), kind, ext, size: (await stat(full)).size });
      }
    }
  };
  await walk(root, 0);
  return { root, files };
});
handle('library:read-file', async (file: string) => {
  const full = path.resolve(file);
  if (![...pickedRoots].some((r) => full === r || full.startsWith(r + path.sep))) throw new Error('That file is outside the folder you chose.');
  const ext = path.extname(full).slice(1).toLowerCase();
  if (KINDS[ext] === 'image') {
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return { dataUrl: `data:image/${mime};base64,${(await readFile(full)).toString('base64')}` };
  }
  if ((await stat(full)).size > 20 * 1024 * 1024) throw new Error('That file is over 20 MB.');
  return { text: await readFile(full, 'utf8') };
});
handle('library:load', (id: string) => st().loadFromLibrary(id));
handle('library:remove', (id: string) => st().deleteFromLibrary(id));
handle('library:rename', (id: string, name: string) => st().renameInLibrary(id, name));
handle('history:list', () => st().listHistory());
handle('history:add', (entry: Omit<import('../shared/types.ts').HistoryEntry, 'id'>, design: unknown) => st().addHistory(entry, design));
handle('history:design', (id: string) => st().historyDesign(id));
handle('history:clear', () => st().clearHistory());

const draftFile = () => path.join(app.getPath('userData'), 'draft.lightrunner.json');
handle('app:save-draft', (json: string) => writeFile(draftFile(), json));
handle('app:load-draft', () => readFile(draftFile(), 'utf8').catch(() => null));
handle('laser:load-settings', async () => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) } as DeviceSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
});
handle('laser:apply-settings', async (s: DeviceSettings) => {
  await writeFile(settingsFile(), JSON.stringify(s, null, 2));
  if (laser.connected) await laser.applySettings(s);
});

// While developing, keep a trace of everything said to a G-code laser.
if (!app.isPackaged && !process.env.LR_GRBL_LOG) process.env.LR_GRBL_LOG = path.join(app.getPath('temp'), 'light-runner-grbl.log');
// One copy at a time: only one program can hold the laser's port.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});
app.whenReady().then(createWindow);
app.on('window-all-closed', async () => {
  await store?.flush().catch(() => undefined);
  if (laser.connected) await laser.stop().catch(() => undefined);
  await laser.disconnect().catch(() => undefined);
  // A stuck USB driver must not leave a hidden copy running with the port held.
  if (laser.stuck) process.kill(process.pid, 'SIGKILL');
  app.quit();
});
