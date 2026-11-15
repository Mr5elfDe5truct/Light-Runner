/** Builds text items from their recipe, and redraws them with new words (batches, serials). */
import { hersheyArc, hersheyText } from './hershey.ts';
import { DEFAULTS, fitToField, IMAGE_DEFAULTS, newId, type ImageItem, type Item, type TextSource, type VectorItem } from './model.ts';
import { textImage } from './vector.ts';

const labelOf = (text: string) => `Text: ${text.replace(/\s+/g, ' ').slice(0, 24)}`;

/** A new text item, centred in the field. `words` is the text to draw (the template filled in). */
export function makeTextItem(src: TextSource, words: string): Item {
  if (src.style === 'single') {
    const h = src.arc ? hersheyArc(words, src.heightMm, src.arc.radiusMm, src.arc.bottom) : hersheyText(words, src.heightMm, src.align);
    if (!h.paths.length) throw new Error('None of those characters are in the single-line font.');
    const item: VectorItem = {
      ...DEFAULTS,
      id: newId(),
      kind: 'vector',
      name: labelOf(src.template),
      visible: true,
      mode: 'line',
      paths: h.paths,
      naturalW: h.width,
      naturalH: h.height,
      w: h.width,
      h: h.height,
      x: (100 - h.width) / 2,
      y: (100 - h.height) / 2,
      text: src,
    };
    return item;
  }
  const { src: url, aspect } = textImage(words, src.font, src.bold, src.italic);
  const h = Math.max(1, src.heightMm * 1.6) * words.split('\n').length;
  const item: ImageItem = {
    ...IMAGE_DEFAULTS,
    ...DEFAULTS,
    id: newId(),
    kind: 'image',
    name: labelOf(src.template),
    visible: true,
    mode: 'bw',
    src: url,
    ...fitToField(h * aspect, h, 100),
    text: src,
  };
  return item;
}

/**
 * The item redrawn with new words, keeping where it is and how much it was scaled. Placement and
 * laser settings stay; the size follows the new text.
 */
export function rewordItem(item: Item, words: string): Item {
  if (!item.text) return item;
  const fresh = makeTextItem(item.text, words);
  if (fresh.kind === 'vector' && item.kind === 'vector') {
    const s = item.w / item.naturalW; // how much the person resized it
    return { ...item, paths: fresh.paths, naturalW: fresh.naturalW, naturalH: fresh.naturalH, w: fresh.naturalW * s, h: fresh.naturalH * s };
  }
  if (fresh.kind === 'image' && item.kind === 'image') {
    const aspect = fresh.w / fresh.h;
    return { ...item, src: fresh.src, w: item.h * aspect };
  }
  return item;
}
