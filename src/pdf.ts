/** PDF pages as pictures (pdf.js), at their real printed size. */

const DPI = 300;

export interface PdfPage {
  src: string; // PNG data URL
  widthMm: number;
  heightMm: number;
}

async function pdfjs() {
  const lib = await import('pdfjs-dist');
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

export async function pdfPageCount(data: ArrayBuffer): Promise<number> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(data.slice(0)) });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

/** Renders one page (1-based) on a white background. */
export async function renderPdfPage(data: ArrayBuffer, pageNumber: number): Promise<PdfPage> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(data.slice(0)) });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 }); // in points (1/72 inch)
    const scale = DPI / 72;
    const viewport = page.getViewport({ scale: Math.min(scale, 6000 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return { src: canvas.toDataURL('image/png'), widthMm: (base.width * 25.4) / 72, heightMm: (base.height * 25.4) / 72 };
  } finally {
    await task.destroy();
  }
}
