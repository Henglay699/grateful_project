/**
 * PDF Tools engine: everything runs in the browser (pdf-lib to build files, pdf.js to render
 * pages), so documents never leave the user's machine.
 */
import { degrees, PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OutFile {
  name: string;
  blob: Blob;
}

const PDF_MIME = 'application/pdf';
const pdfBlob = (bytes: Uint8Array) => new Blob([bytes], { type: PDF_MIME });
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** pdf.js is loaded on first use only, so it isn't in the main bundle. */
let pdfjsReady: Promise<typeof import('pdfjs-dist')> | null = null;
function pdfjs() {
  pdfjsReady ??= (async () => {
    const lib = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return pdfjsReady;
}

/** Open a PDF with pdf.js for drawing pages; the caller destroys it. */
export async function openForRender(file: Blob): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false })
    .promise;
}

async function openForEdit(file: Blob): Promise<PDFDocument> {
  return PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not draw page'))),
      type,
      quality,
    ),
  );
}

/** Draw every page to a canvas at `scale` (1 = 72 dpi) and hand it to `each`. */
async function eachRenderedPage(
  file: Blob,
  scale: number,
  each: (canvas: HTMLCanvasElement, index: number, total: number) => Promise<void>,
): Promise<void> {
  const doc = await openForRender(file);
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      // White behind transparent pages, so JPEGs don't come out black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      await each(canvas, i - 1, doc.numPages);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

export interface ThumbRenderer {
  count: number;
  /** Queue page `index` for a preview; `done` gets an object URL. Returns a cancel function. */
  request: (index: number, done: (url: string) => void) => () => void;
  /** Stops rendering and frees every preview URL. */
  destroy: () => void;
}

/**
 * Small page previews drawn on demand, one at a time, so a long PDF shows its page grid at
 * once and only renders the pages that scroll into view.
 */
export async function openThumbs(file: Blob, width = 160): Promise<ThumbRenderer> {
  const doc = await openForRender(file);
  const cache = new Map<number, string>();
  const queue: { index: number; done: (url: string) => void }[] = [];
  let pumping = false;
  let dead = false;

  const render = async (index: number) => {
    const page = await doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return URL.createObjectURL(await canvasBlob(canvas, 'image/jpeg', 0.7));
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    while (queue.length && !dead) {
      const job = queue.shift()!;
      try {
        let url = cache.get(job.index);
        if (!url) {
          url = await render(job.index);
          if (dead) {
            URL.revokeObjectURL(url);
            break;
          }
          cache.set(job.index, url);
        }
        job.done(url);
      } catch {
        // A page that can't be drawn just keeps its placeholder.
      }
    }
    pumping = false;
  };

  return {
    count: doc.numPages,
    request(index, done) {
      const hit = cache.get(index);
      if (hit) {
        done(hit);
        return () => {};
      }
      const job = { index, done };
      queue.push(job);
      void pump();
      return () => {
        const at = queue.indexOf(job);
        if (at >= 0) queue.splice(at, 1);
      };
    },
    destroy() {
      dead = true;
      queue.length = 0;
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
      void doc.destroy();
    },
  };
}

/**
 * Page ranges like "1-3, 5, 8-" (1-based, open end = last page) → groups of 0-based indexes.
 * Throws on anything outside 1..total.
 */
export function parseRanges(input: string, total: number): number[][] {
  const groups: number[][] = [];
  for (const raw of input.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d*)\s*(?:-\s*(\d*))?$/.exec(part);
    if (!m || (!m[1] && !m[2])) throw new Error(`"${part}" is not a page range`);
    const from = m[1] ? Number(m[1]) : 1;
    const to = part.includes('-') ? (m[2] ? Number(m[2]) : total) : from;
    if (from < 1 || to > total || from > to)
      throw new Error(`"${part}" is outside pages 1–${total}`);
    groups.push(Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
  }
  if (!groups.length) throw new Error('Enter at least one page range');
  return groups;
}

/** 0-based indexes → compact 1-based ranges, e.g. [0, 1, 2, 4] → "1-3, 5". */
export function formatRanges(indexes: Iterable<number>): string {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i]!;
    while (sorted[i + 1] === sorted[i]! + 1) i++;
    parts.push(from === sorted[i] ? `${from + 1}` : `${from + 1}-${sorted[i]! + 1}`);
  }
  return parts.join(', ');
}

export async function pageCount(file: Blob): Promise<number> {
  return (await openForEdit(file)).getPageCount();
}

/** Join PDFs in the given order. */
export async function mergePdfs(files: Blob[]): Promise<Blob> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await openForEdit(f);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return pdfBlob(await out.save());
}

async function pickPages(src: PDFDocument, indexes: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indexes);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/**
 * Split by ranges. `mode: 'each'` makes one file per range; `'single'` puts every selected
 * page into one file (extract pages).
 */
export async function splitPdf(
  file: File,
  ranges: string,
  mode: 'each' | 'single',
): Promise<OutFile[]> {
  const src = await openForEdit(file);
  const groups = parseRanges(ranges, src.getPageCount());
  const stem = baseName(file.name);
  if (mode === 'single')
    return [{ name: `${stem}-extract.pdf`, blob: pdfBlob(await pickPages(src, groups.flat())) }];
  const out: OutFile[] = [];
  for (const g of groups) {
    const label = g.length === 1 ? `p${g[0]! + 1}` : `p${g[0]! + 1}-${g[g.length - 1]! + 1}`;
    out.push({ name: `${stem}-${label}.pdf`, blob: pdfBlob(await pickPages(src, g)) });
  }
  return out;
}

/** Every page as its own PDF. */
export async function burstPdf(file: File): Promise<OutFile[]> {
  const src = await openForEdit(file);
  const stem = baseName(file.name);
  const out: OutFile[] = [];
  for (const i of src.getPageIndices())
    out.push({ name: `${stem}-p${i + 1}.pdf`, blob: pdfBlob(await pickPages(src, [i])) });
  return out;
}

/** Drop the given 0-based pages; at least one page must stay. */
export async function removePages(file: Blob, remove: Iterable<number>): Promise<Blob> {
  const src = await openForEdit(file);
  const drop = new Set(remove);
  const keep = src.getPageIndices().filter((i) => !drop.has(i));
  if (!keep.length) throw new Error('At least one page has to stay in the PDF');
  return pdfBlob(await pickPages(src, keep));
}

export interface PagePlan {
  /** 0-based page in the source file. */
  index: number;
  /** Extra clockwise rotation, a multiple of 90. */
  rotate: number;
}

/** Rebuild a PDF with pages reordered, rotated or removed. */
export async function organizePdf(file: Blob, plan: PagePlan[]): Promise<Blob> {
  const src = await openForEdit(file);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(
    src,
    plan.map((p) => p.index),
  );
  pages.forEach((page, i) => {
    const extra = plan[i]!.rotate;
    if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360));
    out.addPage(page);
  });
  return pdfBlob(await out.save());
}

const A4: [number, number] = [595.28, 841.89];

/** JPEG and PNG embed directly; anything else the browser can show is redrawn as PNG. */
async function imageBytes(file: File): Promise<{ bytes: ArrayBuffer; kind: 'jpg' | 'png' }> {
  if (file.type === 'image/jpeg') return { bytes: await file.arrayBuffer(), kind: 'jpg' };
  if (file.type === 'image/png') return { bytes: await file.arrayBuffer(), kind: 'png' };
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  return { bytes: await (await canvasBlob(canvas, 'image/png')).arrayBuffer(), kind: 'png' };
}

/** One image per page; `fit` sizes each page to its image, `a4` centres it on A4 with a margin. */
export async function imagesToPdf(files: File[], pageSize: 'fit' | 'a4'): Promise<Blob> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const { bytes, kind } = await imageBytes(f);
    const img = kind === 'jpg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    if (pageSize === 'fit') {
      out.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0 });
      continue;
    }
    const landscape = img.width > img.height;
    const [w, h] = landscape ? [A4[1], A4[0]] : A4;
    const margin = 28;
    const s = Math.min((w - margin * 2) / img.width, (h - margin * 2) / img.height, 1);
    const dw = img.width * s;
    const dh = img.height * s;
    out.addPage([w, h]).drawImage(img, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
  }
  return pdfBlob(await out.save());
}

/** Each page as a PNG or JPEG at the given dpi. */
export async function pdfToImages(
  file: File,
  format: 'png' | 'jpeg',
  dpi: number,
  onProgress?: (done: number, total: number) => void,
): Promise<OutFile[]> {
  const stem = baseName(file.name);
  const ext = format === 'png' ? 'png' : 'jpg';
  const out: OutFile[] = [];
  await eachRenderedPage(file, dpi / 72, async (canvas, i, total) => {
    out.push({
      name: `${stem}-p${i + 1}.${ext}`,
      blob: await canvasBlob(canvas, `image/${format}`, 0.92),
    });
    onProgress?.(i + 1, total);
  });
  return out;
}

/** A run of text on a page, positioned in PDF points (y grows upwards). */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bold?: boolean;
  italic?: boolean;
}

export interface TextSpan {
  text: string;
  /** Text height in points. */
  size: number;
  bold?: boolean;
  italic?: boolean;
}

/** Text between two wide gaps on a line; `x` and `end` are its left and right edges. */
export interface TextCell {
  x: number;
  end: number;
  text: string;
  spans: TextSpan[];
}

/** One visual line: `y` is its baseline, `size` its largest text height. */
export interface TextRow {
  y: number;
  size: number;
  cells: TextCell[];
}

/**
 * Rebuild reading-order rows from positioned runs: top to bottom, then left to right.
 * A small gap becomes a space and a wide gap starts a new cell (a table column).
 */
export function textRows(runs: TextRun[]): TextRow[] {
  const rows: { y: number; h: number; runs: TextRun[] }[] = [];
  for (const r of [...runs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    // Blank runs are skipped: some PDFs draw column gaps as one wide space, which would hide the gap.
    if (!r.str.trim()) continue;
    const row = rows.find((l) => Math.abs(l.y - r.y) <= Math.max(l.h, r.height, 1) * 0.5);
    if (row) row.runs.push(r);
    else rows.push({ y: r.y, h: r.height, runs: [r] });
  }
  return rows.map(({ y, h, runs: rs }) => {
    rs.sort((a, b) => a.x - b.x);
    const cells: TextCell[] = [];
    let cell: TextCell | undefined;
    for (const r of rs) {
      const em = Math.max(r.height || h, 1);
      const gap = cell ? r.x - cell.end : 0;
      if (!cell || gap > em * 1.2) {
        cell = { x: r.x, end: r.x, text: '', spans: [] };
        cells.push(cell);
      } else if (gap > em * 0.15 && !/\s$/.test(cell.text) && !/^\s/.test(r.str)) {
        addSpan(cell, ' ', r);
      }
      addSpan(cell, cell.text ? r.str : r.str.trimStart(), r);
      cell.end = Math.max(cell.end, r.x + r.width);
    }
    for (const c of cells) {
      c.text = c.text.trimEnd();
      const last = c.spans[c.spans.length - 1];
      if (last) last.text = last.text.trimEnd();
    }
    return { y, size: Math.max(...rs.map((r) => r.height), 1), cells };
  });
}

function addSpan(cell: TextCell, text: string, r: TextRun) {
  cell.text += text;
  const last = cell.spans[cell.spans.length - 1];
  const size = Math.round(r.height * 2) / 2;
  if (last && last.size === size && !!last.bold === !!r.bold && !!last.italic === !!r.italic)
    last.text += text;
  else cell.spans.push({ text, size, bold: r.bold, italic: r.italic });
}

/** Rows as plain lines: cells joined by tabs, a blank line between paragraphs. */
export function rowsToLines(rows: TextRow[]): string[] {
  const out: string[] = [];
  rows.forEach((row, i) => {
    // A gap of well over a line height starts a new paragraph.
    const prev = rows[i - 1];
    if (prev && prev.y - row.y > Math.max(prev.size, row.size) * 2) out.push('');
    out.push(row.cells.map((c) => c.text).join('\t'));
  });
  return out;
}

/** Plain lines straight from runs; wide gaps become tabs, so table columns paste into Excel. */
export const textLines = (runs: TextRun[]) => rowsToLines(textRows(runs));

/** A page's text layout, in points from the page's top-left corner turned to y-up. */
export interface PageText {
  page: number;
  width: number;
  height: number;
  rows: TextRow[];
}

/**
 * Read the text layout of each chosen page (0-based indexes, default all); scanned pages have
 * no rows. `styles` also looks up bold and italic, which costs a full parse of each page.
 */
export async function readPages(
  file: Blob,
  opts: { pages?: number[]; styles?: boolean; onProgress?: (done: number, total: number) => void },
): Promise<PageText[]> {
  const lib = await pdfjs();
  const doc = await openForRender(file);
  try {
    const wanted = opts.pages ?? Array.from({ length: doc.numPages }, (_, i) => i);
    const out: PageText[] = [];
    for (const [n, i] of wanted.entries()) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const font = opts.styles ? await fontLookup(page) : () => undefined;
      const runs: TextRun[] = [];
      for (const it of content.items) {
        if (!('str' in it)) continue;
        // Viewport space handles rotated pages and crop boxes that don't start at 0,0.
        const m = lib.Util.transform(vp.transform, it.transform);
        const f = font(it.fontName);
        runs.push({
          str: it.str,
          x: m[4],
          y: vp.height - m[5],
          width: it.width,
          height: Math.hypot(m[2], m[3]) || it.height,
          bold: f?.bold,
          italic: f?.italic,
        });
      }
      out.push({ page: i, width: vp.width, height: vp.height, rows: textRows(runs) });
      page.cleanup();
      opts.onProgress?.(n + 1, wanted.length);
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/** Bold / italic of a page's fonts, from pdf.js's flags or failing that the font's name. */
async function fontLookup(page: import('pdfjs-dist').PDFPageProxy) {
  try {
    await page.getOperatorList(); // loads the page's fonts into commonObjs
  } catch {
    return () => undefined;
  }
  return (id: string) => {
    try {
      const f = page.commonObjs.get(id) as
        { name?: string; bold?: boolean; black?: boolean; italic?: boolean } | undefined;
      if (!f) return undefined;
      const name = f.name ?? '';
      return {
        bold: !!(f.bold || f.black) || /bold|black|heavy|semibold|demi/i.test(name),
        italic: !!f.italic || /italic|oblique/i.test(name),
      };
    } catch {
      return undefined;
    }
  };
}

/** Text of each chosen page (0-based indexes, default all); scanned pages come back empty. */
export async function extractText(
  file: Blob,
  pages?: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ page: number; text: string }[]> {
  const read = await readPages(file, { pages, onProgress });
  return read.map((p) => ({ page: p.page, text: rowsToLines(p.rows).join('\n').trim() }));
}

export const COMPRESS_LEVELS = {
  low: { label: 'Light — best quality', dpi: 150, quality: 0.8 },
  medium: { label: 'Recommended', dpi: 110, quality: 0.65 },
  high: { label: 'Strong — smallest file', dpi: 80, quality: 0.5 },
} as const;
export type CompressLevel = keyof typeof COMPRESS_LEVELS;

/**
 * Two passes, keeping whichever is smaller: a lossless re-save (object streams, drops unused
 * objects), and a scan-style rebuild that redraws each page as a JPEG. The rebuild shrinks
 * scanned and image-heavy files a lot but makes text unselectable, so it's only kept when it
 * is meaningfully smaller.
 */
export async function compressPdf(
  file: File,
  level: CompressLevel,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; method: 'lossless' | 'rasterized' | 'unchanged' }> {
  const lossless = pdfBlob(await (await openForEdit(file)).save({ useObjectStreams: true }));

  const { dpi, quality } = COMPRESS_LEVELS[level];
  const out = await PDFDocument.create();
  await eachRenderedPage(file, dpi / 72, async (canvas, i, total) => {
    const jpg = await out.embedJpg(
      await (await canvasBlob(canvas, 'image/jpeg', quality)).arrayBuffer(),
    );
    // Keep the original page size in points.
    const w = (canvas.width * 72) / dpi;
    const h = (canvas.height * 72) / dpi;
    out.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    onProgress?.(i + 1, total);
  });
  const rasterized = pdfBlob(await out.save());

  const best = Math.min(file.size, lossless.size, rasterized.size);
  if (rasterized.size === best && rasterized.size < lossless.size * 0.85)
    return { blob: rasterized, method: 'rasterized' };
  if (lossless.size < file.size) return { blob: lossless, method: 'lossless' };
  return { blob: file, method: 'unchanged' };
}

/** Bundle several outputs into one download. */
export async function zipFiles(files: OutFile[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.blob));
  return zip.generateAsync({ type: 'blob' });
}
