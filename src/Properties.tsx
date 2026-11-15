/** The panel for the selected item: size, rotation, mode, image adjustments, laser settings. */
import type { Resolution } from '../shared/lp2.ts';
import type { Material } from '../shared/types.ts';
import { alignToField, insideField, type Align } from './geometry.ts';
import type { ImageMode, Item, VectorMode } from './model.ts';

export const MODE_LABEL: Record<ImageMode | VectorMode, string> = {
  line: 'Line (outline)',
  fill: 'Fill',
  bw: 'Black & white',
  dither: 'Dither',
  grey: 'Greyscale',
  sketch: 'Sketch (pencil)',
};

interface Props {
  item: Item;
  materials: Material[];
  lockAspect: boolean;
  onLockAspect: (v: boolean) => void;
  /** key: lets quick repeated changes to one field count as one undo step */
  onChange: (patch: Partial<Item>, key?: string) => void;
  onMaterial: (id: string) => void;
  onSaveMaterial: () => void;
  onTrace: () => void;
  onExportGcode: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOrder: (dir: -1 | 1) => void;
}

const round = (v: number) => Math.round(v * 100) / 100;
const ALIGN: { how: Align; label: string; title: string }[] = [
  { how: 'left', label: '⇤', title: 'Align to the left edge' },
  { how: 'hcenter', label: '↔', title: 'Centre left to right' },
  { how: 'right', label: '⇥', title: 'Align to the right edge' },
  { how: 'top', label: '⤒', title: 'Align to the top edge' },
  { how: 'vcenter', label: '↕', title: 'Centre top to bottom' },
  { how: 'bottom', label: '⤓', title: 'Align to the bottom edge' },
];

export function Properties({ item, materials, lockAspect, onLockAspect, onChange, onMaterial, onSaveMaterial, onTrace, onExportGcode, onDuplicate, onDelete, onOrder }: Props) {
  const num = (key: keyof Item, value: string) => onChange({ [key]: Number(value) } as Partial<Item>, key);
  const resize = (key: 'w' | 'h', value: number) => {
    if (!(value > 0)) return;
    if (!lockAspect) return onChange({ [key]: value }, key);
    const ratio = item.w / item.h;
    onChange(key === 'w' ? { w: value, h: value / ratio } : { h: value, w: value * ratio }, 'size');
  };

  return (
    <div className="props">
      <input className="name" value={item.name} onChange={(e) => onChange({ name: e.target.value }, 'name')} title="Name" />

      <div className="grid4">
        <label>
          X mm
          <input type="number" step="0.1" value={round(item.x)} onChange={(e) => num('x', e.target.value)} />
        </label>
        <label>
          Y mm
          <input type="number" step="0.1" value={round(item.y)} onChange={(e) => num('y', e.target.value)} />
        </label>
        <label>
          W mm
          <input type="number" step="0.1" min="0.1" value={round(item.w)} onChange={(e) => resize('w', Number(e.target.value))} />
        </label>
        <label>
          H mm
          <input type="number" step="0.1" min="0.1" value={round(item.h)} onChange={(e) => resize('h', Number(e.target.value))} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={lockAspect} onChange={(e) => onLockAspect(e.target.checked)} /> Keep proportions
      </label>

      <div className="row">
        <label className="rotate">
          Rotate °
          <input type="number" step="1" value={round(item.rotation)} onChange={(e) => num('rotation', e.target.value)} />
        </label>
        <button className="small" title="Rotate 90° left" onClick={() => onChange({ rotation: (item.rotation - 90) % 360 })}>
          ⟲
        </button>
        <button className="small" title="Rotate 90° right" onClick={() => onChange({ rotation: (item.rotation + 90) % 360 })}>
          ⟳
        </button>
        <button className={`small ${item.flipX ? 'on' : ''}`} title="Mirror left to right" onClick={() => onChange({ flipX: !item.flipX })}>
          ⇋
        </button>
        <button className={`small ${item.flipY ? 'on' : ''}`} title="Mirror top to bottom" onClick={() => onChange({ flipY: !item.flipY })}>
          ⇵
        </button>
      </div>

      <div className="row align">
        {ALIGN.map((a) => (
          <button key={a.how} className="small" title={a.title} onClick={() => onChange(alignToField(item, a.how))}>
            {a.label}
          </button>
        ))}
      </div>

      <label>
        Mode
        <select value={item.mode} onChange={(e) => onChange({ mode: e.target.value } as Partial<Item>)}>
          {(item.kind === 'vector' ? (['line', 'fill'] as const) : (['bw', 'dither', 'grey', 'sketch'] as const)).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>

      {item.kind === 'image' && (
        <>
          {item.mode === 'bw' && <Slider label="Threshold" value={item.threshold} min={1} max={254} onChange={(v) => onChange({ threshold: v }, 'threshold')} />}
          <Slider label="Brightness" value={item.brightness} min={-100} max={100} onChange={(v) => onChange({ brightness: v }, 'brightness')} />
          <Slider label="Contrast" value={item.contrast} min={-100} max={100} onChange={(v) => onChange({ contrast: v }, 'contrast')} />
          <div className="row">
            <label className="check grow">
              <input type="checkbox" checked={item.invert} onChange={(e) => onChange({ invert: e.target.checked })} /> Invert
            </label>
            <button className="small" onClick={onTrace} title="Make an outline from the dark parts of this picture">
              Trace to outline
            </button>
          </div>
        </>
      )}

      {!(item.kind === 'vector' && item.mode === 'line') && (
        <label>
          Resolution
          <select value={item.resolution} onChange={(e) => onChange({ resolution: e.target.value as Resolution })}>
            <option value="1K">1K (0.1 mm per dot)</option>
            <option value="2K">2K (0.05 mm per dot, finer, slower)</option>
          </select>
        </label>
      )}

      <h4>Laser</h4>
      <label>
        Material
        <div className="row">
          <select className="grow" value={item.material ?? ''} onChange={(e) => onMaterial(e.target.value)}>
            <option value="">Custom</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button className="small" onClick={onSaveMaterial} title="Save these settings as your own material">
            Save…
          </button>
        </div>
      </label>
      <Slider label="Power %" value={item.power} min={1} max={100} onChange={(v) => onChange({ power: v, material: undefined }, 'power')} />
      <Slider label="Depth" value={item.depth} min={1} max={100} onChange={(v) => onChange({ depth: v, material: undefined }, 'depth')} />
      <label>
        Passes
        <input type="number" min="1" max="50" value={item.passes} onChange={(e) => onChange({ passes: Math.max(1, Math.min(50, Math.round(Number(e.target.value)) || 1)), material: undefined }, 'passes')} />
      </label>
      {!insideField(item) && <p className="warn">Part of this is outside the 100 × 100 mm field.</p>}

      <div className="row wrap">
        <button className="small" onClick={() => onOrder(-1)} title="Engrave earlier (move up the list)">
          ↑
        </button>
        <button className="small" onClick={() => onOrder(1)} title="Engrave later (move down the list)">
          ↓
        </button>
        <button className="small" onClick={onDuplicate}>
          Duplicate
        </button>
        {item.kind === 'vector' && item.mode === 'line' && (
          <button className="small" onClick={onExportGcode}>
            Export G-code
          </button>
        )}
        <button className="danger small" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

interface MultiProps {
  items: Item[];
  materials: Material[];
  onChangeAll: (patch: Partial<Item>, key?: string) => void;
  onAlign: (how: Align) => void;
  onMaterial: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** Editing several items at once: alignment as a group, and laser settings for all of them. */
export function MultiProperties({ items, materials, onChangeAll, onAlign, onMaterial, onDuplicate, onDelete }: MultiProps) {
  const first = items[0];
  const same = <K extends keyof Item>(k: K) => items.every((i) => i[k] === first[k]);
  return (
    <div className="props">
      <h3>{items.length} items selected</h3>
      <p className="hint">Changes here apply to all of them. Drag any of them to move the group.</p>
      <div className="row align">
        {ALIGN.map((a) => (
          <button key={a.how} className="small" title={`${a.title} (as a group)`} onClick={() => onAlign(a.how)}>
            {a.label}
          </button>
        ))}
      </div>
      <h4>Laser</h4>
      <label>
        Material
        <select value={same('material') ? (first.material ?? '') : '?'} onChange={(e) => onMaterial(e.target.value)}>
          {!same('material') && <option value="?">Mixed</option>}
          <option value="">Custom</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <Slider label={`Power %${same('power') ? '' : ' (mixed)'}`} value={first.power} min={1} max={100} onChange={(v) => onChangeAll({ power: v, material: undefined }, 'power')} />
      <Slider label={`Depth${same('depth') ? '' : ' (mixed)'}`} value={first.depth} min={1} max={100} onChange={(v) => onChangeAll({ depth: v, material: undefined }, 'depth')} />
      <label>
        Passes{same('passes') ? '' : ' (mixed)'}
        <input type="number" min="1" max="50" value={first.passes} onChange={(e) => onChangeAll({ passes: Math.max(1, Math.min(50, Math.round(Number(e.target.value)) || 1)), material: undefined }, 'passes')} />
      </label>
      <label>
        Resolution{same('resolution') ? '' : ' (mixed)'}
        <select value={first.resolution} onChange={(e) => onChangeAll({ resolution: e.target.value as Resolution })}>
          <option value="1K">1K (0.1 mm per dot)</option>
          <option value="2K">2K (0.05 mm per dot)</option>
        </select>
      </label>
      <div className="row wrap">
        <button className="small" onClick={onDuplicate}>
          Duplicate all
        </button>
        <button className="danger small" onClick={onDelete}>
          Delete all
        </button>
      </div>
    </div>
  );
}

export function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label}
      <div className="slider">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value)) || 0)))} />
      </div>
    </label>
  );
}
