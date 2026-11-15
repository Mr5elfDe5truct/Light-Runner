/** Lays out a material test: a grid of squares, power across and depth down. Pure. */
import { FIELD_MM } from './model.ts';

export interface GridSpec {
  powerMin: number;
  powerMax: number;
  cols: number;
  depthMin: number;
  depthMax: number;
  rows: number;
  cell: number; // mm
  gap: number; // mm
  mode: 'fill' | 'line';
  passes: number;
  labels: boolean;
}

export const GRID_DEFAULTS: GridSpec = { powerMin: 20, powerMax: 100, cols: 5, depthMin: 10, depthMax: 90, rows: 5, cell: 6, gap: 2, mode: 'fill', passes: 1, labels: true };

export interface GridCell {
  x: number;
  y: number;
  size: number;
  power: number;
  depth: number;
}
export interface GridLabel {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

const LABEL_W = 9;
const LABEL_H = 4;

export const steps = (min: number, max: number, n: number) =>
  Array.from({ length: n }, (_, i) => Math.round(n === 1 ? min : min + ((max - min) * i) / (n - 1)));

export function gridLayout(s: GridSpec): { cells: GridCell[]; labels: GridLabel[]; width: number; height: number; problem?: string } {
  const lw = s.labels ? LABEL_W : 0;
  const lh = s.labels ? LABEL_H + 1 : 0;
  const width = lw + s.cols * s.cell + (s.cols - 1) * s.gap;
  const height = lh + s.rows * s.cell + (s.rows - 1) * s.gap;
  const x0 = (FIELD_MM - width) / 2;
  const y0 = (FIELD_MM - height) / 2;
  const powers = steps(s.powerMin, s.powerMax, s.cols);
  const depths = steps(s.depthMin, s.depthMax, s.rows);
  const cells: GridCell[] = [];
  const labels: GridLabel[] = [];
  depths.forEach((depth, r) => {
    const y = y0 + lh + r * (s.cell + s.gap);
    powers.forEach((power, c) => cells.push({ x: x0 + lw + c * (s.cell + s.gap), y, size: s.cell, power, depth }));
    if (s.labels) labels.push({ x: x0, y: y + (s.cell - LABEL_H) / 2, w: LABEL_W - 1, h: LABEL_H, text: `D${depth}` });
  });
  if (s.labels) powers.forEach((power, c) => labels.push({ x: x0 + lw + c * (s.cell + s.gap) + (s.cell - Math.min(s.cell, LABEL_W)) / 2, y: y0, w: Math.min(s.cell, LABEL_W), h: LABEL_H, text: `P${power}` }));
  let problem: string | undefined;
  if (width > FIELD_MM || height > FIELD_MM) problem = `The grid is ${width.toFixed(0)} × ${height.toFixed(0)} mm; it must fit in ${FIELD_MM} × ${FIELD_MM} mm. Use smaller squares, a smaller gap or fewer steps.`;
  const bad = [s.powerMin, s.powerMax].some((v) => v < 1 || v > 100) || [s.depthMin, s.depthMax].some((v) => v < 1 || v > 100);
  if (bad) problem = 'Power and depth must be between 1 and 100.';
  if (s.cols < 1 || s.rows < 1 || s.cols > 12 || s.rows > 12) problem = 'Use 1 to 12 steps each way.';
  return { cells, labels, width, height, problem };
}
