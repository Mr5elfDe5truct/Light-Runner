/**
 * The 100 x 100 mm work field.
 * Click to select (Shift or Ctrl adds), drag to move everything selected, Shift-drag on empty space
 * to box-select, drag empty space to pan, wheel to zoom.
 */
import { useRef, useState } from 'react';
import { itemBounds, placedPaths } from './geometry.ts';
import { FIELD, type Item } from './model.ts';



interface Props {
  items: Item[];
  previews: Record<string, string>;
  selected: Set<string>;
  snap: boolean;
  onSelect: (ids: string[], additive: boolean) => void;
  onMoveStart: () => void;
  onMove: (positions: Map<string, { x: number; y: number }>) => void;
  background?: { url: string; opacity: number } | null;
}

const transformOf = (i: Item) => {
  const cx = i.x + i.w / 2;
  const cy = i.y + i.h / 2;
  return `translate(${cx} ${cy}) rotate(${i.rotation}) scale(${i.flipX ? -1 : 1} ${i.flipY ? -1 : 1}) translate(${-cx} ${-cy})`;
};

type Gesture =
  | { kind: 'move'; start: { x: number; y: number }; origins: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: 'pan'; x: number; y: number; cx: number; cy: number; moved: boolean }
  | { kind: 'box'; start: { x: number; y: number }; now: { x: number; y: number }; additive: boolean };

export function Workspace({ items, previews, selected, snap, onSelect, onMoveStart, onMove, background }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const FW = FIELD.w;
  const FH = FIELD.h;
  const PAD = Math.max(FW, FH) * 0.08;
  const FULL = Math.max(FW, FH) + PAD * 2;
  const [view, setView] = useState({ zoom: 1, cx: FW / 2, cy: FH / 2 });
  // Re-centre when the machine (and so the field) changes.
  const fieldKey = `${FW}x${FH}`;
  const lastField = useRef(fieldKey);
  if (lastField.current !== fieldKey) {
    lastField.current = fieldKey;
    setView({ zoom: 1, cx: FW / 2, cy: FH / 2 });
  }
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const g = useRef<Gesture | null>(null);
  const set = (next: Gesture | null) => {
    g.current = next;
    setGesture(next);
  };

  const size = FULL / view.zoom;
  const viewBox = `${view.cx - size / 2} ${view.cy - size / 2} ${size} ${size}`;

  const toMm = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    setView((v) => {
      const zoom = Math.min(20, Math.max(0.5, v.zoom * factor));
      if (clientX === undefined || clientY === undefined) return { ...v, zoom };
      const p = toMm(clientX, clientY);
      const k = v.zoom / zoom;
      return { zoom, cx: p.x + (v.cx - p.x) * k, cy: p.y + (v.cy - p.y) * k };
    });
  };

  const grid = [];
  const big = Math.max(FW, FH) > 150; // a G-code laser's bed: coarser grid
  const scale = Math.max(FW, FH) / 100;
  const minorStep = big ? 10 : 1;
  const step = view.zoom >= 4 ? minorStep : view.zoom >= 2 ? (big ? 25 : 5) : big ? 50 : 10;
  const labelEvery = big ? 50 : 10;
  const font = (2.2 * scale) / Math.sqrt(view.zoom);
  for (let v = 0; v <= Math.max(FW, FH); v += step) {
    const major = v % (big ? 100 : 50) === 0;
    const minor = v % labelEvery !== 0;
    const cls = major ? 'grid major' : minor ? 'grid minor' : 'grid';
    if (v <= FW) grid.push(<line key={`v${v}`} x1={v} y1={0} x2={v} y2={FH} className={cls} />);
    if (v <= FH) grid.push(<line key={`h${v}`} x1={0} y1={v} x2={FW} y2={v} className={cls} />);
    if (!minor || view.zoom >= 4) {
      if (v <= FW)
        grid.push(
          <text key={`tx${v}`} x={v} y={-1.5 * scale} className="ruler" style={{ fontSize: font }}>
            {v}
          </text>,
        );
      if (v <= FH)
        grid.push(
          <text key={`ty${v}`} x={-1.5 * scale} y={v + 0.8 * scale} className="ruler" textAnchor="end" style={{ fontSize: font }}>
            {v}
          </text>,
        );
    }
  }

  const box = gesture?.kind === 'box' ? gesture : null;

  return (
    <div className="workspace-wrap">
      <svg
        ref={svgRef}
        className="workspace"
        viewBox={viewBox}
        onWheel={(e) => zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY)}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          if (e.shiftKey) {
            const p = toMm(e.clientX, e.clientY);
            set({ kind: 'box', start: p, now: p, additive: true });
          } else set({ kind: 'pan', x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false });
        }}
        onPointerMove={(e) => {
          const cur = g.current;
          if (!cur) return;
          if (cur.kind === 'move') {
            const p = toMm(e.clientX, e.clientY);
            let dx = p.x - cur.start.x;
            let dy = p.y - cur.start.y;
            dx = snap ? Math.round(dx) : Math.round(dx * 10) / 10;
            dy = snap ? Math.round(dy) : Math.round(dy * 10) / 10;
            if (!cur.moved) {
              if (!dx && !dy) return;
              cur.moved = true;
              onMoveStart();
            }
            const next = new Map<string, { x: number; y: number }>();
            for (const [id, o] of cur.origins) next.set(id, { x: Math.round((o.x + dx) * 100) / 100, y: Math.round((o.y + dy) * 100) / 100 });
            onMove(next);
          } else if (cur.kind === 'pan') {
            const svg = svgRef.current!;
            const perPx = size / Math.min(svg.clientWidth, svg.clientHeight);
            const dx = (e.clientX - cur.x) * perPx;
            const dy = (e.clientY - cur.y) * perPx;
            if (Math.abs(dx) + Math.abs(dy) > perPx * 3) cur.moved = true;
            if (cur.moved) setView((v) => ({ ...v, cx: cur.cx - dx, cy: cur.cy - dy }));
          } else {
            set({ ...cur, now: toMm(e.clientX, e.clientY) });
          }
        }}
        onPointerUp={() => {
          const cur = g.current;
          if (cur?.kind === 'pan' && !cur.moved) onSelect([], false);
          if (cur?.kind === 'box') {
            const x0 = Math.min(cur.start.x, cur.now.x);
            const y0 = Math.min(cur.start.y, cur.now.y);
            const x1 = Math.max(cur.start.x, cur.now.x);
            const y1 = Math.max(cur.start.y, cur.now.y);
            const hit = items.filter((i) => {
              if (!i.visible) return false;
              const b = itemBounds(i);
              return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
            });
            onSelect(
              hit.map((i) => i.id),
              cur.additive,
            );
          }
          set(null);
        }}
      >
        <rect x={0} y={0} width={FW} height={FH} className="field" />
        {background && <image href={background.url} x={0} y={0} width={FW} height={FH} opacity={background.opacity} preserveAspectRatio="none" />}
        {grid}
        {items
          .filter((i) => i.visible)
          .map((item) => {
            const t = transformOf(item);
            const isSel = selected.has(item.id);
            return (
              <g
                key={item.id}
                className="item"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  svgRef.current?.setPointerCapture(e.pointerId);
                  if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    onSelect([item.id], true);
                    return;
                  }
                  // Dragging something already selected moves the whole selection.
                  const ids = isSel ? [...selected] : [item.id];
                  if (!isSel) onSelect([item.id], false);
                  const origins = new Map(items.filter((i) => ids.includes(i.id)).map((i) => [i.id, { x: i.x, y: i.y }]));
                  set({ kind: 'move', start: toMm(e.clientX, e.clientY), origins, moved: false });
                }}
              >
                <rect x={item.x} y={item.y} width={item.w} height={Math.max(item.h, 0.6)} transform={t} className="hit" />
                {item.kind === 'image' ? (
                  previews[item.id] ? <image href={previews[item.id]} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="none" transform={t} /> : null
                ) : (
                  placedPaths(item).map((p, i) => <polyline key={i} points={p.map(([x, y]) => `${x},${y}`).join(' ')} className={item.mode === 'fill' ? 'vector fill' : 'vector'} />)
                )}
                {isSel && <rect x={item.x} y={item.y} width={item.w} height={Math.max(item.h, 0.6)} transform={t} className="selection" />}
              </g>
            );
          })}
        {box && (
          <rect
            className="marquee"
            x={Math.min(box.start.x, box.now.x)}
            y={Math.min(box.start.y, box.now.y)}
            width={Math.abs(box.now.x - box.start.x)}
            height={Math.abs(box.now.y - box.start.y)}
          />
        )}
      </svg>
      <div className="zoom">
        <button onClick={() => zoomAt(1 / 1.25)} title="Zoom out">
          −
        </button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => zoomAt(1.25)} title="Zoom in">
          +
        </button>
        <button onClick={() => setView({ zoom: 1, cx: FW / 2, cy: FH / 2 })} title="Show the whole field">
          Fit
        </button>
      </div>
    </div>
  );
}
