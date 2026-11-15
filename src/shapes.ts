/** Built-in shapes, as outlines in a 20 x 20 box (or the line's own length). */
import type { Point } from '../shared/lp2.ts';

export type ShapeKind = 'square' | 'circle' | 'line' | 'star' | 'polygon' | 'heart' | 'rounded';

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'square', label: 'Square' },
  { kind: 'rounded', label: 'Rounded square' },
  { kind: 'circle', label: 'Circle' },
  { kind: 'polygon', label: 'Hexagon' },
  { kind: 'star', label: 'Star' },
  { kind: 'heart', label: 'Heart' },
  { kind: 'line', label: 'Line' },
];

const ring = (n: number, r: (i: number) => number, turn = -Math.PI / 2): Point[] => {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = turn + (i / n) * Math.PI * 2;
    return [10 + r(i) * Math.cos(a), 10 + r(i) * Math.sin(a)] as Point;
  });
  return [...pts, pts[0]];
};

export function shapePaths(kind: ShapeKind): { paths: Point[][]; w: number; h: number } {
  switch (kind) {
    case 'square':
      return { paths: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]], w: 20, h: 20 };
    case 'rounded': {
      const r = 4;
      const pts: Point[] = [];
      const corner = (cx: number, cy: number, a0: number) => {
        for (let i = 0; i <= 8; i++) {
          const a = a0 + (i / 8) * (Math.PI / 2);
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
      };
      corner(20 - r, r, -Math.PI / 2);
      corner(20 - r, 20 - r, 0);
      corner(r, 20 - r, Math.PI / 2);
      corner(r, r, Math.PI);
      return { paths: [[...pts, pts[0]]], w: 20, h: 20 };
    }
    case 'circle':
      return { paths: [ring(120, () => 10)], w: 20, h: 20 };
    case 'polygon':
      return { paths: [ring(6, () => 10)], w: 20, h: 20 };
    case 'star':
      return { paths: [ring(10, (i) => (i % 2 ? 4 : 10))], w: 20, h: 20 };
    case 'heart': {
      const pts = Array.from({ length: 121 }, (_, i) => {
        const t = (i / 120) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        return [10 + x * 0.6, 9 - y * 0.6] as Point;
      });
      return { paths: [pts], w: 20, h: 20 };
    }
    case 'line':
      return { paths: [[[0, 0], [30, 0]]], w: 30, h: 0.01 };
  }
}
