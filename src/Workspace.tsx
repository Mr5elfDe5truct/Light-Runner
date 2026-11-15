/**
 * The 100 x 100 mm work field. Click to select, drag to move, wheel to zoom, drag empty space to pan.
 */
import { useRef, useState } from 'react';
import { placedPaths } from './geometry.ts';
import { FIELD_MM, type Item } from './model.ts';

const PAD = 8;
const FULL = FIELD_MM + PAD * 2;

interface Props {
  items: Item[];
  previews: Record<string, string>;
  selected: string | null;
  snap: boolean;
  onSelect: (id: string | null) => void;
  onMoveStart: () => void;
  onMove: (id: string, x: number, y: number) => void;
}

const transformOf = (i: Item) => {
  const cx = i.x + i.w / 2;
  const cy = i.y + i.h / 2;
  return `translate(${cx} ${cy}) rotate(${i.rotation}) scale(${i.flipX ? -1 : 1} ${i.flipY ? -1 : 1}) translate(${-cx} ${-cy})`;
};

export function Workspace({ items, previews, selected, snap, onSelect, onMoveStart, onMove }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ zoom: 1, cx: FIELD_MM / 2, cy: FIELD_MM / 2 });
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

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
  const step = view.zoom >= 4 ? 1 : view.zoom >= 2 ? 5 : 10;
  for (let v = 0; v <= FIELD_MM; v += step) {
    const major = v % 50 === 0;
    const minor = v % 10 !== 0;
    grid.push(<line key={`v${v}`} x1={v} y1={0} x2={v} y2={FIELD_MM} className={major ? 'grid major' : minor ? 'grid minor' : 'grid'} />);
    grid.push(<line key={`h${v}`} x1={0} y1={v} x2={FIELD_MM} y2={v} className={major ? 'grid major' : minor ? 'grid minor' : 'grid'} />);
    if (!minor || view.zoom >= 4)
      grid.push(
        <text key={`tx${v}`} x={v} y={-1.5} className="ruler" style={{ fontSize: 2.2 / Math.sqrt(view.zoom) }}>
          {v}
        </text>,
        <text key={`ty${v}`} x={-1.5} y={v + 0.8} className="ruler" textAnchor="end" style={{ fontSize: 2.2 / Math.sqrt(view.zoom) }}>
          {v}
        </text>,
      );
  }

  return (
    <div className="workspace-wrap">
      <svg
        ref={svgRef}
        className="workspace"
        viewBox={viewBox}
        onWheel={(e) => zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY)}
        onPointerDown={(e) => {
          pan.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const p = toMm(e.clientX, e.clientY);
            let x = p.x - drag.current.dx;
            let y = p.y - drag.current.dy;
            if (snap) {
              x = Math.round(x);
              y = Math.round(y);
            } else {
              x = Math.round(x * 10) / 10;
              y = Math.round(y * 10) / 10;
            }
            if (!drag.current.moved) {
              drag.current.moved = true;
              onMoveStart();
            }
            onMove(drag.current.id, x, y);
          } else if (pan.current) {
            const svg = svgRef.current!;
            const perPx = size / Math.min(svg.clientWidth, svg.clientHeight);
            const dx = (e.clientX - pan.current.x) * perPx;
            const dy = (e.clientY - pan.current.y) * perPx;
            if (Math.abs(dx) + Math.abs(dy) > perPx * 3) pan.current.moved = true;
            if (pan.current.moved) setView((v) => ({ ...v, cx: pan.current!.cx - dx, cy: pan.current!.cy - dy }));
          }
        }}
        onPointerUp={() => {
          if (pan.current && !pan.current.moved && !drag.current) onSelect(null);
          drag.current = null;
          pan.current = null;
        }}
      >
        <rect x={0} y={0} width={FIELD_MM} height={FIELD_MM} className="field" />
        {grid}
        {items
          .filter((i) => i.visible)
          .map((item) => {
            const t = transformOf(item);
            return (
              <g
                key={item.id}
                className="item"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(item.id);
                  const p = toMm(e.clientX, e.clientY);
                  drag.current = { id: item.id, dx: p.x - item.x, dy: p.y - item.y, moved: false };
                  svgRef.current?.setPointerCapture(e.pointerId);
                }}
              >
                <rect x={item.x} y={item.y} width={item.w} height={Math.max(item.h, 0.6)} transform={t} className="hit" />
                {item.kind === 'image' ? (
                  previews[item.id] ? <image href={previews[item.id]} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="none" transform={t} /> : null
                ) : (
                  placedPaths(item).map((p, i) => (
                    <polyline key={i} points={p.map(([x, y]) => `${x},${y}`).join(' ')} className={item.mode === 'fill' ? 'vector fill' : 'vector'} />
                  ))
                )}
                {selected === item.id && <rect x={item.x} y={item.y} width={item.w} height={Math.max(item.h, 0.6)} transform={t} className="selection" />}
              </g>
            );
          })}
      </svg>
      <div className="zoom">
        <button onClick={() => zoomAt(1 / 1.25)} title="Zoom out">
          −
        </button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => zoomAt(1.25)} title="Zoom in">
          +
        </button>
        <button onClick={() => setView({ zoom: 1, cx: FIELD_MM / 2, cy: FIELD_MM / 2 })} title="Show the whole field">
          Fit
        </button>
      </div>
    </div>
  );
}
