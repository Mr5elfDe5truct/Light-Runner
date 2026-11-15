import { app, BrowserWindow, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeviceSettings } from '../shared/lp2.ts';
import type { JobSpec, LaserEvent, PreviewSpec } from '../shared/types.ts';
import { Laser } from './device.ts';
import { loadMaterials } from './materials.ts';

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
