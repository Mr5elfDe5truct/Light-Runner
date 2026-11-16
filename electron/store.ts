/**
 * The design library and the job history, kept as JSON files in the app's data folder.
 * Library: one file per design (with a thumbnail). History: one index plus a design per run.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesignSource, HistoryEntry, LibraryEntry } from '../shared/types.ts';

const HISTORY_LIMIT = 50;
const safeId = (id: string) => {
  if (!/^[a-z0-9-]{4,40}$/i.test(id)) throw new Error('Bad id.');
  return id;
};
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function entryOf(id: string, body: { name: string; updated: number; thumbnail: string; folder?: string; design?: unknown; source?: DesignSource }): LibraryEntry {
  const items = (body.design as { items?: unknown[] } | undefined)?.items;
  return { id, name: body.name, updated: body.updated, thumbnail: body.thumbnail, folder: body.folder, items: Array.isArray(items) ? items.length : body.source ? 1 : 0 };
}

export class Store {
  constructor(private root: string) {}

  private dir(name: string) {
    return path.join(this.root, name);
  }

  // ---------------------------------------------------------------- library
  //
  // One file per design: { name, updated, thumbnail, folder?, design? | source? }. A design made in
  // the app keeps its items; one imported from a file keeps the original file (source) and is read
  // when opened. An index (_index.json) holds what the list needs, so hundreds of designs list fast.

  private index: LibraryEntry[] | null = null;
  private indexTimer: NodeJS.Timeout | null = null;

  private indexFile() {
    return path.join(this.dir('library'), '_index.json');
  }

  private async loadIndex(): Promise<LibraryEntry[]> {
    if (this.index) return this.index;
    const dir = this.dir('library');
    await mkdir(dir, { recursive: true });
    try {
      this.index = JSON.parse(await readFile(this.indexFile(), 'utf8')) as LibraryEntry[];
      return this.index;
    } catch {
      // No index yet (or it's damaged): build it from the design files.
    }
    const out: LibraryEntry[] = [];
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      try {
        const body = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
        out.push(entryOf(f.slice(0, -5), body));
      } catch {
        // skip a damaged file
      }
    }
    this.index = out;
    await this.writeIndex();
    return out;
  }

  private async writeIndex() {
    if (this.index) await writeFile(this.indexFile(), JSON.stringify(this.index));
  }

  /** Writes the index a moment after the last change (an import saves hundreds in a row). */
  private scheduleIndexWrite() {
    if (this.indexTimer) clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => {
      this.indexTimer = null;
      this.writeIndex().catch(() => undefined);
    }, 400);
  }

  /** Writes any pending index change now. */
  async flush() {
    if (this.indexTimer) {
      clearTimeout(this.indexTimer);
      this.indexTimer = null;
      await this.writeIndex();
    }
  }

  async listLibrary(): Promise<LibraryEntry[]> {
    return [...(await this.loadIndex())].sort((a, b) => b.updated - a.updated);
  }

  async saveToLibrary(name: string, design: unknown, thumbnail: string, id?: string, extra: { folder?: string; source?: DesignSource } = {}): Promise<string> {
    const index = await this.loadIndex();
    const key = id ? safeId(id) : newId();
    const body = { name, updated: Date.now(), thumbnail, folder: extra.folder, ...(extra.source ? { source: extra.source } : { design }) };
    await writeFile(path.join(this.dir('library'), `${key}.json`), JSON.stringify(body));
    const entry = entryOf(key, body);
    const at = index.findIndex((e) => e.id === key);
    if (at >= 0) index[at] = entry;
    else index.push(entry);
    this.scheduleIndexWrite();
    return key;
  }

  /** The design's items, or the original file it was imported from. */
  async loadFromLibrary(id: string): Promise<{ design?: unknown; source?: DesignSource }> {
    const body = JSON.parse(await readFile(path.join(this.dir('library'), `${safeId(id)}.json`), 'utf8'));
    return { design: body.design, source: body.source };
  }

  async deleteFromLibrary(id: string) {
    const index = await this.loadIndex();
    await rm(path.join(this.dir('library'), `${safeId(id)}.json`), { force: true });
    this.index = index.filter((e) => e.id !== id);
    this.scheduleIndexWrite();
  }

  async renameInLibrary(id: string, name: string) {
    const file = path.join(this.dir('library'), `${safeId(id)}.json`);
    const body = JSON.parse(await readFile(file, 'utf8'));
    body.name = name;
    await writeFile(file, JSON.stringify(body));
    const index = await this.loadIndex();
    const e = index.find((x) => x.id === id);
    if (e) e.name = name;
    this.scheduleIndexWrite();
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
