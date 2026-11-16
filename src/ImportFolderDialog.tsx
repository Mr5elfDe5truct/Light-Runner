/** Import a folder (and its subfolders) of designs into My designs, with progress. */
import { useRef, useState } from 'react';
import type { FolderFile } from '../shared/types.ts';
import { Modal } from './dialogs.tsx';
import { itemsFromSource } from './folderImport.ts';
import { thumbnail } from './thumbnail.ts';

interface Result {
  imported: number;
  skipped: number; // already in My designs
  unsupported: number;
  failed: { name: string; why: string }[];
}

export function ImportFolderDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<{ root: string; files: FolderFile[] } | null>(null);
  const [pictures, setPictures] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef(false);

  const pick = async () => {
    setError(null);
    setResult(null);
    try {
      const r = await window.laser.library.pickFolder();
      if (r) setPicked(r);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const count = (k: FolderFile['kind']) => picked?.files.filter((f) => f.kind === k).length ?? 0;
  const wanted = (picked?.files ?? []).filter((f) => f.kind === 'svg' || f.kind === 'dxf' || f.kind === 'gcode' || (pictures && f.kind === 'image'));
  const folders = new Set(picked?.files.map((f) => f.folder)).size;

  const run = async () => {
    if (!picked) return;
    setRunning(true);
    cancel.current = false;
    const existing = new Set((await window.laser.library.list()).map((e) => `${e.folder ?? ''}|${e.name}`));
    const res: Result = { imported: 0, skipped: 0, unsupported: count('unsupported'), failed: [] };
    for (let i = 0; i < wanted.length && !cancel.current; i++) {
      const f = wanted[i];
      setProgress({ done: i, total: wanted.length, current: `${f.folder}/${f.name}` });
      if (existing.has(`${f.folder}|${f.name}`)) {
        res.skipped++;
        continue;
      }
      try {
        const body = await window.laser.library.readFile(f.path);
        const source = { kind: f.kind as 'svg' | 'dxf' | 'gcode' | 'image', name: f.name, ...body };
        const items = await itemsFromSource(source);
        const thumb = await thumbnail(items, {}, 160, 'image/jpeg');
        await window.laser.library.save(f.name, null, thumb, undefined, { folder: f.folder, source });
        res.imported++;
      } catch (e) {
        res.failed.push({ name: `${f.folder}/${f.name}.${f.ext}`, why: (e as Error).message });
      }
      // Let the window breathe between files.
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    setProgress((p) => ({ ...p, done: cancel.current ? p.done : wanted.length }));
    setResult(res);
    setRunning(false);
    onDone();
  };

  return (
    <Modal title="Import a folder into My designs" onClose={() => (running ? undefined : onClose())}>
      <p className="hint">
        Adds every design in a folder and its subfolders to My designs on this PC, grouped by folder. The files are copied into Light Runner's library; nothing is shared or uploaded. Designs already imported from the same folder are skipped, so it's safe to run again.
      </p>
      <div className="row">
        <button className="primary" onClick={pick} disabled={running}>
          Choose a folder…
        </button>
        <span className="hint grow" title={picked?.root}>
          {picked ? picked.root : 'No folder chosen yet.'}
        </span>
      </div>
      {picked && (
        <>
          <p>
            Found {count('svg')} SVG, {count('dxf')} DXF, {count('gcode')} G-code and {count('image')} picture file{count('image') === 1 ? '' : 's'} in {folders} folder{folders === 1 ? '' : 's'}
            {count('unsupported') ? `, plus ${count('unsupported')} LightBurn file${count('unsupported') === 1 ? '' : 's'} (.lbrn) that can't be read yet` : ''}.
          </p>
          <label className="check">
            <input type="checkbox" checked={pictures} disabled={running} onChange={(e) => setPictures(e.target.checked)} /> Include pictures (PNG, JPG). Often these are product photos, not designs.
          </label>
        </>
      )}
      {(running || result) && (
        <div className="import-progress">
          <div className="progress wide">
            <div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
          <div className="hint small">{running ? `${progress.done} of ${progress.total}: ${progress.current}` : ''}</div>
        </div>
      )}
      {result && (
        <div>
          <p>
            Imported {result.imported}
            {result.skipped ? `, ${result.skipped} already there` : ''}
            {result.unsupported ? `, ${result.unsupported} LightBurn file${result.unsupported === 1 ? '' : 's'} skipped` : ''}
            {result.failed.length ? `, ${result.failed.length} couldn't be read` : ''}
            {cancel.current ? ' (stopped early)' : ''}.
          </p>
          {result.failed.length > 0 && (
            <details>
              <summary>Files that couldn't be read</summary>
              <ul className="failed">
                {result.failed.slice(0, 100).map((f) => (
                  <li key={f.name}>
                    {f.name}: {f.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {error && <p className="warn">{error}</p>}
      <div className="buttons">
        {running ? (
          <button className="danger" onClick={() => (cancel.current = true)}>
            Stop
          </button>
        ) : (
          <button onClick={onClose}>Close</button>
        )}
        <button className="primary" disabled={!picked || running || !wanted.length} onClick={run}>
          Import {wanted.length || ''} design{wanted.length === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}
