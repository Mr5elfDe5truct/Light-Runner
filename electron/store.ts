/**
 * The design library and the job history, kept as JSON files in the app's data folder.
 * Library: one file per design (with a thumbnail). History: one index plus a design per run.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HistoryEntry, LibraryEntry } from '../shared/types.ts';

const HISTORY_LIMIT = 50;
const safeId = (id: string) => {
  if (!/^[a-z0-9-]{4,40}$/i.test(id)) throw new Error('Bad id.');
  return id;
};
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class Store {
  constructor(private root: string) {}

  private dir(name: string) {
    return path.join(this.root, name);
  }

  // ---------------------------------------------------------------- library

  async listLibrary(): Promise<LibraryEntry[]> {
    const dir = this.dir('library');
    await mkdir(dir, { recursive: true });
    const out: LibraryEntry[] = [];
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const body = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
        out.push({ id: f.slice(0, -5), name: body.name, updated: body.updated, thumbnail: body.thumbnail, items: Array.isArray(body.design?.items) ? body.design.items.length : 0 });
      } catch {
        // skip a damaged file
      }
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  async saveToLibrary(name: string, design: unknown, thumbnail: string, id?: string): Promise<string> {
    const dir = this.dir('library');
    await mkdir(dir, { recursive: true });
    const key = id ? safeId(id) : newId();
    await writeFile(path.join(dir, `${key}.json`), JSON.stringify({ name, updated: Date.now(), thumbnail, design }));
    return key;
  }

  async loadFromLibrary(id: string): Promise<unknown> {
    const body = JSON.parse(await readFile(path.join(this.dir('library'), `${safeId(id)}.json`), 'utf8'));
    return body.design;
  }

  async deleteFromLibrary(id: string) {
    await rm(path.join(this.dir('library'), `${safeId(id)}.json`), { force: true });
  }

  async renameInLibrary(id: string, name: string) {
    const file = path.join(this.dir('library'), `${safeId(id)}.json`);
    const body = JSON.parse(await readFile(file, 'utf8'));
    body.name = name;
    await writeFile(file, JSON.stringify(body));
  }

  // ---------------------------------------------------------------- history

  private historyIndex() {
    return path.join(this.dir('history'), 'index.json');
  }

  async listHistory(): Promise<HistoryEntry[]> {
    try {
      return JSON.parse(await readFile(this.historyIndex(), 'utf8'));
    } catch {
      return [];
    }
  }

  async addHistory(entry: Omit<HistoryEntry, 'id'>, design: unknown): Promise<void> {
    const dir = this.dir('history');
    await mkdir(dir, { recursive: true });
    const id = newId();
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify(design));
    const list = [{ ...entry, id }, ...(await this.listHistory())];
    for (const old of list.slice(HISTORY_LIMIT)) await rm(path.join(dir, `${safeId(old.id)}.json`), { force: true });
    await writeFile(this.historyIndex(), JSON.stringify(list.slice(0, HISTORY_LIMIT)));
  }

  async historyDesign(id: string): Promise<unknown> {
    return JSON.parse(await readFile(path.join(this.dir('history'), `${safeId(id)}.json`), 'utf8'));
  }

  async clearHistory() {
    await rm(this.dir('history'), { recursive: true, force: true });
  }

  async sizeOf(name: 'library' | 'history'): Promise<number> {
    try {
      let total = 0;
      for (const f of await readdir(this.dir(name))) total += (await stat(path.join(this.dir(name), f))).size;
      return total;
    } catch {
      return 0;
    }
  }
}
