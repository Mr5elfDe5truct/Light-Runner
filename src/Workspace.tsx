/** The 100 x 100 mm work field. Click to select, drag to move. */
import { useRef } from 'react';
import { FIELD_MM, placedPaths, type Item } from './model.ts';

const PAD = 8;

interface Props {
  items: Item[];
  previews: Record<string, string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
}

export function Workspace({ items, previews, selected, onSelect, onMove }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const toMm = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const grid = [];
  for (let v = 0; v <= FIELD_MM; v += 10) {
    grid.push(<line key={`v${v}`} x1={v} y1={0} x2={v} y2={FIELD_MM} className={v % 50 ? 'grid' : 'grid major'} />);
    grid.push(<line key={`h${v}`} x1={0} y1={v} x2={FIELD_MM} y2={v} className={v % 50 ? 'grid' : 'grid major'} />);
    grid.push(
      <text key={`tx${v}`} x={v} y={-2} className="ruler">
        {v}
      </text>,
      <text key={`ty${v}`} x={-2} y={v + 1} className="ruler" textAnchor="end">
        {v}
      </text>,
    );
  }

  return (
    <svg
      ref={svgRef}
      className="workspace"
      viewBox={`${-PAD} ${-PAD} ${FIELD_MM + PAD * 2} ${FIELD_MM + PAD * 2}`}
      onPointerDown={() => onSelect(null)}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const p = toMm(e);
        onMove(drag.current.id, Math.round((p.x - drag.current.dx) * 10) / 10, Math.round((p.y - drag.current.dy) * 10) / 10);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      <rect x={0} y={0} width={FIELD_MM} height={FIELD_MM} className="field" />
      {grid}
      {items
        .filter((i) => i.visible)
        .map((item) => (
          <g
            key={item.id}
            className="item"
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(item.id);
              const p = toMm(e);
              drag.current = { id: item.id, dx: p.x - item.x, dy: p.y - item.y };
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
          >
            <rect x={item.x} y={item.y} width={item.w} height={item.h} className="hit" />
            {item.kind === 'image' ? (
              previews[item.id] ? <image href={previews[item.id]} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="none" /> : null
            ) : (
              placedPaths(item).map((p, i) => (
                <polyline
                  key={i}
                  points={p.map(([x, y]) => `${x},${y}`).join(' ')}
                  className={item.mode === 'fill' ? 'vector fill' : 'vector'}
                />
              ))
            )}
            {selected === item.id && <rect x={item.x} y={item.y} width={item.w} height={item.h} className="selection" />}
          </g>
        ))}
    </svg>
  );
}
