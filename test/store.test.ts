// The design library and job history on disk.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from '../electron/store.ts';

test('library: save, list newest first, rename, load, delete', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lr-store-'));
  try {
    const s = new Store(dir);
    const a = await s.saveToLibrary('Coaster', { items: [1, 2] }, 'data:a');
    await new Promise((r) => setTimeout(r, 5));
    const b = await s.saveToLibrary('Keyring', { items: [1] }, 'data:b');
    const list = await s.listLibrary();
    assert.deepEqual(list.map((e) => e.name), ['Keyring', 'Coaster']);
    assert.equal(list[1].items, 2);
    await s.renameInLibrary(a, 'Round coaster');
    assert.deepEqual((await s.loadFromLibrary(a)).design, { items: [1, 2] });
    await s.saveToLibrary('Keyring v2', { items: [1, 2, 3] }, 'data:b2', b); // overwrite in place
    assert.equal((await s.listLibrary()).length, 2);
    await s.deleteFromLibrary(a);
    assert.deepEqual((await s.listLibrary()).map((e) => e.name), ['Keyring v2']);
    await assert.rejects(s.loadFromLibrary('../../etc'), /Bad id/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('library: imported designs keep their file and folder; the index survives a restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lr-index-'));
  try {
    const s = new Store(dir);
    const source = { kind: 'svg' as const, name: 'Coaster 1', text: '<svg/>' };
    const id = await s.saveToLibrary('Coaster 1', null, 'data:t', undefined, { folder: 'EXTRAs_2/Coasters', source });
    await s.saveToLibrary('Mine', { items: [1, 2, 3] }, 'data:m');
    assert.deepEqual(await s.loadFromLibrary(id), { design: undefined, source });
    await s.flush();
    // A fresh store (the app restarted) lists from the index, folder included.
    const again = new Store(dir);
    const list = await again.listLibrary();
    assert.equal(list.length, 2);
    assert.equal(list.find((e) => e.id === id)!.folder, 'EXTRAs_2/Coasters');
    assert.equal(list.find((e) => e.name === 'Mine')!.items, 3);
    await again.deleteFromLibrary(id);
    await again.flush();
    assert.equal((await new Store(dir).listLibrary()).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('history keeps the newest 50 runs with their designs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lr-hist-'));
  try {
    const s = new Store(dir);
    for (let i = 0; i < 53; i++) await s.addHistory({ at: i, names: [`job ${i}`], jobs: 1, seconds: 10, result: 'finished' }, { n: i });
    const list = await s.listHistory();
    assert.equal(list.length, 50);
    assert.equal(list[0].names[0], 'job 52');
    assert.deepEqual(await s.historyDesign(list[0].id), { n: 52 });
    await s.clearHistory();
    assert.deepEqual(await s.listHistory(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
