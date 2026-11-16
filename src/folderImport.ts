/** Turning a design file (SVG, DXF, G-code or picture) into items, for imports and the library. */
import type { DesignSource } from '../shared/types.ts';
import { loadImage } from './imaging.ts';
import { readDxf, readGcode, type Outline } from './importers.ts';
import { DEFAULTS, FIELD, fitToField, IMAGE_DEFAULTS, newId, type ImageItem, type Item, type VectorItem } from './model.ts';
import { readSvg } from './vector.ts';

const fit = () => Math.min(FIELD.w, FIELD.h);

function outlineItem(name: string, o: Outline, maxMm: number): VectorItem {
  return { ...DEFAULTS, id: newId(), kind: 'vector', name, visible: true, mode: 'line', paths: o.paths, naturalW: o.width, naturalH: o.height, ...fitToField(o.width, o.height, maxMm) };
}

/** The items a stored design file makes: real size where the file gives one, shrunk to fit the work area. */
export async function itemsFromSource(src: DesignSource): Promise<Item[]> {
  if (src.kind === 'svg') {
    const v = readSvg(src.text ?? '');
    return [outlineItem(src.name, { paths: v.paths, width: v.width, height: v.height }, fit())];
  }
  if (src.kind === 'dxf') return [outlineItem(src.name, readDxf(src.text ?? ''), fit())];
  if (src.kind === 'gcode') return [outlineItem(src.name, readGcode(src.text ?? ''), fit())];
  const img = await loadImage(src.dataUrl ?? '');
  const item: ImageItem = { ...IMAGE_DEFAULTS, ...DEFAULTS, id: newId(), kind: 'image', name: src.name, visible: true, mode: 'dither', src: src.dataUrl ?? '', ...fitToField(img.naturalWidth, img.naturalHeight, 60) };
  return [item];
}
