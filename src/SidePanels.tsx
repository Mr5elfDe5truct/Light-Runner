/** The side panel's Materials and Designs tabs. */
import { useEffect, useMemo, useState } from 'react';
import type { LibraryEntry, Material } from '../shared/types.ts';

const MODE_NAME = { line: 'Line', fill: 'Fill / B&W', image: 'Picture' } as const;

interface MaterialsProps {
  machine: 'lp2' | 'grbl';
  materials: Material[];
  watts: number;
  onWatts: (w: number) => void;
  selectedCount: number;
  onApply: (id: string) => void;
  onSaveFromSelection: () => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
}

export function MaterialsPanel({ machine, materials, watts, onWatts, selectedCount, onApply, onSaveFromSelection, onDelete, onExport, onImport }: MaterialsProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(
    () => materials.filter((m) => (m.machine ?? 'lp2') === machine && m.name.toLowerCase().includes(query.trim().toLowerCase())),
    [materials, machine, query],
  );
  const current = shown.find((m) => m.id === open) ?? null;
  const resLabel = (dpi: number) => (dpi >= 500 ? '2K' : dpi >= 300 ? '1.3K' : '1K');

  return (
    <div className="panel">
      <p className="hint">
        {machine === 'grbl'
          ? 'Settings for your G-code laser. ★ are yours; the others are starting points scaled to your laser — check them with a Test grid.'
          : 'Settings for the LP2: ★ are yours; the others come from LaserPecker Design Space, if it is installed.'}
      </p>
      {machine === 'grbl' && (
        <label className="row">
          <span className="grow">My laser's output (optical W)</span>
          <input type="number" min="1" max="60" step="0.5" value={watts} onChange={(e) => onWatts(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70 }} />
        </label>
      )}
      <input type="text" placeholder="Search materials" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="materials">
        {shown.map((m) => (
          <li key={m.id} className={m.id === open ? 'on' : ''}>
            <button className="mat-name" onClick={() => setOpen(m.id === open ? null : m.id)}>
              {m.name}
            </button>
            {m.id === open && (
              <div className="mat-detail">
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Res.</th>
                      <th>Power</th>
                      <th>{machine === 'grbl' ? 'mm/min' : 'Depth'}</th>
                      <th>Passes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...m.presets]
                      .sort((a, b) => a.mode.localeCompare(b.mode) || a.dpi - b.dpi)
                      .filter((p, i, all) => machine !== 'grbl' || all.findIndex((q) => q.mode === p.mode) === i)
                      .map((p, i) => (
                        <tr key={i}>
                          <td>{MODE_NAME[p.mode]}</td>
                          <td>{machine === 'grbl' ? '—' : resLabel(p.dpi)}</td>
                          <td>{p.power} %</td>
                          <td>{machine === 'grbl' ? (p.speed ?? '—') : p.depth}</td>
                          <td>{p.passes}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <div className="row wrap">
                  <button className="small primary" disabled={!selectedCount} onClick={() => onApply(m.id)} title={selectedCount ? '' : 'Select something on the design first'}>
                    Apply to {selectedCount > 1 ? `${selectedCount} items` : 'selection'}
                  </button>
                  {m.id.startsWith('my-') && (
                    <button
                      className="small danger"
                      onClick={() => {
                        if (window.confirm(`Delete your material "${m.name}"?`)) onDelete(m.id);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
        {!shown.length && <li className="hint">No materials match.</li>}
      </ul>
      <div className="row wrap">
        <button className="small" disabled={selectedCount !== 1} onClick={onSaveFromSelection} title="Keep the selected item's settings as your own material">
          Save selection's settings…
        </button>
      </div>
      <div className="row wrap">
        <button className="small" onClick={onExport}>
          Export mine
        </button>
        <button className="small" onClick={onImport}>
          Import
        </button>
      </div>
    </div>
  );
}

interface DesignsProps {
  currentId: string | null;
  onOpen: (id: string, name: string) => void;
  onSave: (name: string, id?: string) => Promise<void>;
  refreshKey: number;
}

export function DesignsPanel({ currentId, onOpen, onSave, refreshKey }: DesignsProps) {
  const [list, setList] = useState<LibraryEntry[] | null>(null);
  const [name, setName] = useState('');
  const refresh = () => window.laser.library.list().then(setList).catch(() => setList([]));
  useEffect(() => {
    refresh();
  }, [refreshKey]);
  const current = list?.find((e) => e.id === currentId);
  return (
    <div className="panel">
      <div className="row">
        <input type="text" className="grow" placeholder={current ? `Name (now "${current.name}")` : 'Name this design'} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="small primary" disabled={!name.trim()} onClick={() => onSave(name.trim()).then(() => (setName(''), refresh()))}>
          Save
        </button>
      </div>
      {current && (
        <button className="small" onClick={() => onSave(name.trim() || current.name, current.id).then(refresh)}>
          Update "{current.name}"
        </button>
      )}
      <div className="designs">
        {list?.map((e) => (
          <div key={e.id} className={`design ${e.id === currentId ? 'on' : ''}`}>
            <button className="thumb" onClick={() => onOpen(e.id, e.name)} title="Open">
              <img src={e.thumbnail} alt="" />
            </button>
            <div className="design-info">
              <div className="card-name" title={e.name}>
                {e.name}
              </div>
              <div className="hint small">{new Date(e.updated).toLocaleDateString()}</div>
              <button
                className="small danger"
                onClick={() => {
                  if (window.confirm(`Delete "${e.name}"?`)) window.laser.library.remove(e.id).then(refresh);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {list?.length === 0 && <p className="hint">Nothing saved yet. Name the design above and press Save.</p>}
      </div>
    </div>
  );
}
