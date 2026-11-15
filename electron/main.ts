import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeviceSettings } from '../shared/lp2.ts';
import type { JobSpec, LaserEvent, PreviewSpec } from '../shared/types.ts';
import { Laser } from './device.ts';
import { loadMaterials } from './materials.ts';
import { Store } from './store.ts';

const laser = new Laser();
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
handle('laser:connect', (p: string) => laser.connect(p));
handle('laser:disconnect', () => laser.disconnect());
handle('laser:run', (jobs: JobSpec[]) => laser.run(jobs.map((j) => ({ ...j, file: new Uint8Array(j.file) }))));
handle('laser:pause', () => laser.pause());
handle('laser:resume', () => laser.resume());
handle('laser:stop', () => laser.stop());
handle('laser:preview', (spec: PreviewSpec) => laser.preview(spec));
handle('laser:stop-preview', () => laser.stopPreview());
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
handle('library:save', (name: string, design: unknown, thumb: string, id?: string) => st().saveToLibrary(name, design, thumb, id));
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

app.whenReady().then(createWindow);
app.on('window-all-closed', async () => {
  if (laser.connected) await laser.stop().catch(() => undefined);
  await laser.disconnect();
  app.quit();
});
