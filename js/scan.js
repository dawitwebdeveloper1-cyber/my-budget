// Receipt scanning, done entirely on the phone.
// NOTE: this is the one third-party tool in the app (Tesseract.js, see vendor/tesseract/README.md).
// It's allowed because it isn't for animation and nothing leaves the device. It is loaded only
// when the scanner is opened, so the rest of the app stays fast.

import { readReceipt } from './receipt.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url);
let libPromise = null;

// Load the library script on first use only.
function loadLibrary() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  libPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('tesseract.min.js', BASE).href;
    s.onload = () => (globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('Scanner did not load')));
    s.onerror = () => { libPromise = null; reject(new Error('Scanner did not load')); };
    document.head.append(s);
  });
  return libPromise;
}

// Modern phones get the faster SIMD engine; older ones a plain build.
function simdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

// Shrinks big photos (faster and just as readable) and turns them into a canvas we can draw on.
export async function photoToCanvas(file, maxSide = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

// Reads a receipt photo. onProgress(0..1, label). Returns { total, store, lines, confidence }.
export async function scanReceipt(canvas, onProgress = () => {}) {
  onProgress(0.02, 'Getting the reader ready');
  const T = await loadLibrary();
  const core = simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
  const worker = await T.createWorker('eng', 1, {
    workerPath: new URL('worker.min.js', BASE).href,
    corePath: new URL(`core/${core}`, BASE).href,
    langPath: new URL('lang', BASE).href.replace(/\/$/, ''),
    workerBlobURL: false,   // the app's security rules don't allow code from blob: addresses
    cacheMethod: 'none',    // the app's offline cache keeps these files instead
    gzip: true,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(0.3 + 0.7 * (m.progress ?? 0), 'Reading the receipt');
      else onProgress(Math.min(0.3, 0.05 + 0.25 * (m.progress ?? 0)), 'Getting the reader ready');
    },
  });
  try {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    const { data } = await worker.recognize(blob, {}, { text: true, blocks: true });
    const lines = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
      lines.push({ text: l.text, bbox: l.bbox, confidence: l.confidence });
    }
    lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
    return { ...readReceipt(lines), confidence: data.confidence ?? 0 };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

// Draws a soft box around the line the total came from, so you can check it.
export function highlight(canvas, bbox) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const g = out.getContext('2d');
  g.drawImage(canvas, 0, 0);
  if (bbox) {
    const pad = Math.round(canvas.width * 0.012);
    g.fillStyle = 'rgba(255, 214, 0, 0.28)';
    g.strokeStyle = 'rgba(230, 150, 0, 0.95)';
    g.lineWidth = Math.max(3, Math.round(canvas.width * 0.006));
    const x = Math.max(0, bbox.x0 - pad);
    const y = Math.max(0, bbox.y0 - pad);
    const w = Math.min(canvas.width - x, bbox.x1 - bbox.x0 + pad * 2);
    const h = Math.min(canvas.height - y, bbox.y1 - bbox.y0 + pad * 2);
    g.fillRect(x, y, w, h);
    g.strokeRect(x, y, w, h);
  }
  return out;
}
