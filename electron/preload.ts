import { contextBridge, ipcRenderer } from 'electron';
import type { LaserApi, LaserEvent } from '../shared/types.ts';

const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: LaserApi = {
  ports: call('laser:ports') as LaserApi['ports'],
  connect: call('laser:connect') as LaserApi['connect'],
  disconnect: call('laser:disconnect') as LaserApi['disconnect'],
  run: call('laser:run') as LaserApi['run'],
  pause: call('laser:pause') as LaserApi['pause'],
  resume: call('laser:resume') as LaserApi['resume'],
  stop: call('laser:stop') as LaserApi['stop'],
  preview: call('laser:preview') as LaserApi['preview'],
  stopPreview: call('laser:stop-preview') as LaserApi['stopPreview'],
  applySettings: call('laser:apply-settings') as LaserApi['applySettings'],
  loadSettings: call('laser:load-settings') as LaserApi['loadSettings'],
  materials: call('laser:materials') as LaserApi['materials'],
  saveDraft: call('app:save-draft') as LaserApi['saveDraft'],
  loadDraft: call('app:load-draft') as LaserApi['loadDraft'],
  appInfo: call('app:info') as LaserApi['appInfo'],
  checkUpdate: call('app:check-update') as LaserApi['checkUpdate'],
  openUrl: call('app:open-url') as LaserApi['openUrl'],
  library: {
    list: call('library:list') as LaserApi['library']['list'],
    save: call('library:save') as LaserApi['library']['save'],
    load: call('library:load') as LaserApi['library']['load'],
    remove: call('library:remove') as LaserApi['library']['remove'],
    rename: call('library:rename') as LaserApi['library']['rename'],
  },
  history: {
    list: call('history:list') as LaserApi['history']['list'],
    add: call('history:add') as LaserApi['history']['add'],
    design: call('history:design') as LaserApi['history']['design'],
    clear: call('history:clear') as LaserApi['history']['clear'],
  },
  onEvent(listener) {
    const fn = (_e: unknown, event: LaserEvent) => listener(event);
    ipcRenderer.on('laser:event', fn);
    return () => ipcRenderer.removeListener('laser:event', fn);
  },
};

contextBridge.exposeInMainWorld('laser', api);
