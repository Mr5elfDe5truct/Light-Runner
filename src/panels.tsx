/** Library, job history, help and the first-run guide. */
import { useEffect, useState } from 'react';
import { formatDuration } from '../shared/estimate.ts';
import type { HistoryEntry, LibraryEntry } from '../shared/types.ts';
import { Modal } from './dialogs.tsx';

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function LibraryDialog({
  currentId,
  onOpen,
  onSave,
  onClose,
  onExportMaterials,
  onImportMaterials,
  onImportFolder,
}: {
  onImportFolder: () => void;
  currentId: string | null;
  onOpen: (id: string, name: string) => void;
  onSave: (name: string, id?: string) => Promise<void>;
  onClose: () => void;
  onExportMaterials: () => void;
  onImportMaterials: () => void;
}) {
  const [list, setList] = useState<LibraryEntry[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [shown, setShown] = useState(60);
  const refresh = () => window.laser.library.list().then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
  const current = list?.find((e) => e.id === currentId);
  return (
    <Modal title="My designs" onClose={onClose}>
      <div className="row">
        <input type="text" autoFocus className="grow" placeholder={current ? `Name (now "${current.name}")` : 'Name this design'} value={name} onChange={(e) => setName(e.target.value)} />
        {current && (
          <button onClick={() => onSave(name.trim() || current.name, current.id).then(refresh)} title="Replace the saved copy with what's on screen now">
            Update "{current.name}"
          </button>
        )}
        <button className="primary" disabled={!name.trim()} onClick={() => onSave(name.trim()).then(() => (setName(''), refresh()))}>
          Save as new
        </button>
      </div>
      {error && <p className="warn">{error}</p>}
      <div className="row">
        <input type="text" className="grow" placeholder={`Search ${list?.length ?? ''} designs`} value={query} onChange={(e) => (setQuery(e.target.value), setShown(60))} />
        <select value={folder} onChange={(e) => (setFolder(e.target.value), setShown(60))}>
          <option value="">All folders</option>
          {[...new Set((list ?? []).map((e) => e.folder ?? ''))]
            .sort((a, b) => a.localeCompare(b))
            .map((f) => (
              <option key={f} value={f}>
                {f || 'Made in Light Runner'}
              </option>
            ))}
        </select>
        <button onClick={onImportFolder}>Import a folder…</button>
      </div>
      <div className="library">
        {list === null && <p className="hint">Loading…</p>}
        {list?.length === 0 && <p className="hint">Nothing saved yet. Name your design above and press Save, or import a folder of designs.</p>}
        {(list ?? [])
          .filter((e) => (!folder || (e.folder ?? '') === folder) && (!query.trim() || `${e.name} ${e.folder ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())))
          .slice(0, shown)
          .map((e) => (
          <div key={e.id} className={`card ${e.id === currentId ? 'on' : ''}`}>
            <button className="thumb" onClick={() => onOpen(e.id, e.name)} title="Open this design">
              <img src={e.thumbnail} alt="" />
            </button>
            <div className="card-name" title={e.name}>
              {e.name}
            </div>
            <div className="hint small">
              {e.folder ? e.folder : `${when(e.updated)} · ${e.items} item${e.items === 1 ? '' : 's'}`}
            </div>
            <div className="row">
              <button
                className="small danger"
                onClick={() => {
                  if (window.confirm(`Delete "${e.name}" from My designs?`)) window.laser.library.remove(e.id).then(refresh);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {(list?.length ?? 0) > shown && (
        <button className="small" onClick={() => setShown(shown + 120)}>
          Show more
        </button>
      )}
      <div className="buttons">
        <button onClick={onExportMaterials} title="Save your ★ materials to a file to share or back up">
          Export my materials
        </button>
        <button onClick={onImportMaterials} title="Add materials from a file someone shared">
          Import materials
        </button>
        <span className="grow" />
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function HistoryDialog({ onLoad, onClose }: { onLoad: (id: string, rerun: boolean) => void; onClose: () => void }) {
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    window.laser.history.list().then(setList).catch(() => setList([]));
  }, []);
  return (
    <Modal title="Job history" onClose={onClose}>
      <p className="hint">The last 50 jobs, newest first. Load one to see or change it, or run it again exactly as it was.</p>
      <div className="table-scroll">
        <table className="history">
          <tbody>
            {list?.map((h) => (
              <tr key={h.id}>
                <td>{when(h.at)}</td>
                <td title={h.names.join(', ')}>{h.names.length > 2 ? `${h.names.slice(0, 2).join(', ')} +${h.names.length - 2}` : h.names.join(', ')}</td>
                <td>{formatDuration(h.seconds)}</td>
                <td className={h.result === 'finished' ? '' : 'warn'}>{h.result}</td>
                <td className="nowrap">
                  <button className="small" onClick={() => onLoad(h.id, false)}>
                    Load
                  </button>{' '}
                  <button className="small" onClick={() => onLoad(h.id, true)}>
                    Run again
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list?.length === 0 && <p className="hint">No jobs yet.</p>}
      </div>
      <div className="buttons">
        {!!list?.length && (
          <button
            className="danger"
            onClick={() => {
              if (window.confirm('Clear the whole job history?')) window.laser.history.clear().then(() => setList([]));
            }}
          >
            Clear history
          </button>
        )}
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

const HELP: { title: string; body: string[] }[] = [
  {
    title: 'Getting started',
    body: [
      'Plug the LP2 in with its USB cable and switch it on. Close LaserPecker Design Space: only one program can use the laser at a time.',
      'Pick the port marked "LP2?" and press Connect. The bar at the bottom turns green when it is ready.',
      'Set the focus distance on the LP2 as its manual describes; the work field is 100 × 100 mm at that height.',
    ],
  },
  {
    title: 'Your first engraving',
    body: [
      'Import a picture or SVG (or drop it on the window), or add text, a shape or a QR code.',
      'Choose a material, or use Test grid on a scrap of it first to find the power and depth that look best, then Save… those as your own material.',
      'Press Preview: the LP2 traces the frame with its light. Move the object until it sits inside, then press Engrave.',
    ],
  },
  {
    title: 'Settings in plain words',
    body: [
      'Power: how strong the laser is. Depth: how slowly it moves; a higher depth burns deeper and darker, and takes longer.',
      'Passes: how many times to go over it. Resolution: 1K draws dots 0.1 mm apart; 2K is twice as fine and slower.',
      'Line follows outlines; Fill fills shapes; Black & white, Dither, Greyscale and Sketch are ways of turning pictures into dots.',
    ],
  },
  {
    title: 'Placing on a real object',
    body: [
      'Use Camera: a webcam (or a photo taken straight down), plus the LP2 tracing the field, gives you the real object under your design.',
      'Use Centre to see just the middle point, and the arrow keys to nudge things by 1 mm (Shift: 5 mm, Alt: 0.1 mm).',
    ],
  },
  {
    title: 'Something went wrong',
    body: [
      'No ports, or no "LP2?": check the cable and that the LP2 is on; press ↻. A CH340 driver may be needed (Windows usually installs it by itself).',
      '"Couldn\'t open COM…": another program has the port. Close LaserPecker Design Space (or any other laser software) and try again.',
      'The cable came out mid-job: the LP2 carries on from its own memory. Plug it back in; Light Runner reconnects by itself and keeps following the job.',
      'It stopped responding: press Stop, then Disconnect and Connect again. As a last resort switch the LP2 off and on.',
      'The result is too light or too dark: run a Test grid on the same material and pick the best square.',
    ],
  },
  {
    title: 'Keyboard',
    body: [
      'Ctrl+Z / Ctrl+Y undo and redo · Ctrl+C / Ctrl+V / Ctrl+D copy, paste, duplicate · Ctrl+A select all · Delete removes the selection.',
      'Ctrl+I import · Ctrl+O open · Ctrl+S save · Esc deselects or closes a dialog · Tab moves between controls.',
    ],
  },
  {
    title: 'Safety',
    body: [
      'Never look at the laser spot without the right eye protection, and never leave it running unattended.',
      'Some materials give off harmful fumes (PVC and vinyl give off chlorine gas: never engrave them). Work with good ventilation.',
    ],
  },
];

export function HelpDialog({ onClose, onWelcome }: { onClose: () => void; onWelcome: () => void }) {
  return (
    <Modal title="Help" onClose={onClose}>
      <div className="help">
        {HELP.map((s) => (
          <section key={s.title}>
            <h3>{s.title}</h3>
            {s.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
      </div>
      <div className="buttons">
        <button onClick={onWelcome}>Show the welcome guide</button>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

const STEPS = [
  { title: 'Welcome to Light Runner', text: 'Design and engrave on your LaserPecker LP2, without LaserPecker Design Space. This short guide shows the four things you need.' },
  { title: '1 · Connect', text: 'Plug in the LP2, switch it on and close LaserPecker Design Space. Pick the port marked "LP2?" at the top and press Connect.' },
  { title: '2 · Focus', text: 'Set the LP2 to its focus height as its manual describes. Everything you design sits inside the 100 × 100 mm field shown in the middle.' },
  { title: '3 · Test your material', text: 'Press Test grid, engrave it on a scrap of your material, and pick the best-looking square. Select it and press Save… to keep those settings as your own material.' },
  { title: '4 · Engrave', text: 'Import a picture or SVG, or add text or a shape. Press Preview to see where it will go, then Engrave. Help (top right) has more, including what to do if something goes wrong.' },
];

export function WelcomeDialog({ onClose }: { onClose: (dontShow: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [dontShow, setDontShow] = useState(true);
  const s = STEPS[step];
  return (
    <Modal title={s.title} onClose={() => onClose(dontShow)}>
      <p className="welcome">{s.text}</p>
      <div className="dots">
        {STEPS.map((_, i) => (
          <span key={i} className={i === step ? 'on' : ''} />
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} /> Don't show this again
      </label>
      <div className="buttons">
        {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
        {step < STEPS.length - 1 ? (
          <button className="primary" autoFocus onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button className="primary" autoFocus onClick={() => onClose(dontShow)}>
            Start
          </button>
        )}
      </div>
    </Modal>
  );
}
