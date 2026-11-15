/** QR codes and barcodes as filled rectangles (outlines in mm, ready for a Fill job). */
import qrcode from 'qrcode-generator';
import type { Point } from '../shared/lp2.ts';

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

const rect = (x: number, y: number, w: number, h: number): Point[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];

/**
 * A QR code, one module = 1 unit. Dark modules next to each other in a row are joined into one
 * rectangle, which keeps the outline count low. `quiet` adds the blank border readers like.
 */
export function qrPaths(text: string, level: QrLevel = 'M', quiet = 0): { paths: Point[][]; size: number; modules: number } {
  if (!text) throw new Error('Type something to put in the QR code.');
  const qr = qrcode(0, level);
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const paths: Point[][] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; ) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      paths.push(rect(start + quiet, r + quiet, c - start, 1));
    }
  }
  return { paths, size: n + quiet * 2, modules: n };
}

export const BARCODE_FORMATS = [
  { id: 'CODE128', label: 'Code 128 (any text)' },
  { id: 'EAN13', label: 'EAN-13 (12–13 digits)' },
  { id: 'UPC', label: 'UPC-A (11–12 digits)' },
  { id: 'CODE39', label: 'Code 39 (A–Z, 0–9)' },
  { id: 'ITF14', label: 'ITF-14 (13–14 digits)' },
] as const;

/** A barcode's bars, drawn by JsBarcode into a detached SVG and read back as rectangles. */
export async function barcodePaths(text: string, format: string): Promise<{ paths: Point[][]; width: number; height: number }> {
  const { default: JsBarcode } = await import('jsbarcode');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  let error: string | null = null;
  JsBarcode(svg, text, { format, width: 1, height: 40, margin: 0, displayValue: false, valid: (ok: boolean) => (error = ok ? null : 'That text can\'t be written in this kind of barcode.') });
  if (error) throw new Error(error);
  const paths: Point[][] = [];
  // Bars are <rect>s, possibly inside groups moved with translate(x, y).
  for (const r of svg.querySelectorAll('rect')) {
    if ((r.getAttribute('style') ?? '').includes('fill:#ffffff') || r.getAttribute('fill') === '#ffffff') continue;
    let x = Number(r.getAttribute('x') ?? 0);
    let y = Number(r.getAttribute('y') ?? 0);
    for (let g = r.parentElement; g && g !== (svg as unknown as Element); g = g.parentElement) {
      const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(g.getAttribute('transform') ?? '');
      if (m) {
        x += Number(m[1]);
        y += Number(m[2]);
      }
    }
    const w = Number(r.getAttribute('width'));
    const h = Number(r.getAttribute('height'));
    if (w > 0 && h > 0) paths.push(rect(x, y, w, h));
  }
  if (!paths.length) throw new Error('No bars were produced.');
  const all = paths.flat();
  const x0 = Math.min(...all.map((p) => p[0]));
  const y0 = Math.min(...all.map((p) => p[1]));
  const width = Math.max(...all.map((p) => p[0])) - x0;
  const height = Math.max(...all.map((p) => p[1])) - y0;
  return { paths: paths.map((p) => p.map(([x, y]) => [x - x0, y - y0] as Point)), width, height };
}
