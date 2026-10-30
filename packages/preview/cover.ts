import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfCover(bytes: number[] | Uint8Array) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
    wasmUrl: new URL('pdfjs/wasm/', document.baseURI).href,
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(640 / base.width, 900 / base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    await task.destroy();
  }
}
