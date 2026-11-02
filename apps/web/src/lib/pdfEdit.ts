/**
 * PDF editing: text, images, signatures, shapes and ink drawn on top of existing pages, plus
 * page numbers and watermarks. Positions are in "view space": PDF points with the origin at the
 * top-left of the page as it is displayed (after the page's own rotation), which is what the
 * editor shows. `toPdf` maps them back to the page's real coordinates when saving.
 */
import {
  BlendMode,
  degrees,
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
  StandardFonts,
  type RGB,
} from 'pdf-lib';

interface Base {
  id: string;
  /** 0-based page index. */
  page: number;
}
export interface TextItem extends Base {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  bold?: boolean;
}
export interface ImageItem extends Base {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** A PNG or JPEG data URL. */
  src: string;
}
export interface RectItem extends Base {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  style: 'highlight' | 'whiteout' | 'box';
  color: string;
}
export interface InkItem extends Base {
  kind: 'ink';
  points: [number, number][];
  color: string;
  width: number;
}
export type EditItem = TextItem | ImageItem | RectItem | InkItem;

/** Line height and first-baseline offset, shared with the editor so text lands where it shows. */
export const TEXT_LINE_HEIGHT = 1.2;
export const TEXT_BASELINE = 0.856;

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Frame {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Page rotation, clockwise, one of 0/90/180/270. */
  r: number;
}

function frameOf(page: PDFPage): Frame {
  const box = page.getCropBox();
  const r = (((page.getRotation().angle % 360) + 360) % 360) as number;
  return { x0: box.x, y0: box.y, w: box.width, h: box.height, r };
}

/** Size of the page as displayed (width and height swap on 90/270). */
export function viewSize(page: PDFPage): { width: number; height: number } {
  const f = frameOf(page);
  return f.r % 180 ? { width: f.h, height: f.w } : { width: f.w, height: f.h };
}

/** View-space point → PDF user space. */
export function toPdf(f: Frame, vx: number, vy: number): { x: number; y: number } {
  switch (f.r) {
    case 90:
      return { x: f.x0 + vy, y: f.y0 + vx };
    case 180:
      return { x: f.x0 + f.w - vx, y: f.y0 + vy };
    case 270:
      return { x: f.x0 + f.w - vy, y: f.y0 + f.h - vx };
    default:
      return { x: f.x0 + vx, y: f.y0 + f.h - vy };
  }
}

function dataUrlBytes(src: string): { bytes: Uint8Array; png: boolean } {
  const [head, body = ''] = src.split(',');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, png: !/image\/jpe?g/.test(head ?? '') };
}

/** Helvetica only covers Latin text; anything else (Khmer, Chinese…) is drawn as an image. */
function fontCovers(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Render text to a transparent PNG at 4× so non-Latin scripts keep their proper shaping. */
export async function textToPng(item: TextItem): Promise<{ src: string; w: number; h: number }> {
  const scale = 4;
  const lines = item.text.split('\n');
  const font = `${item.bold ? 700 : 400} ${item.size * scale}px 'GS Khmer', Helvetica, Arial, sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const lineH = item.size * TEXT_LINE_HEIGHT;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) / scale + 2;
  const h = lines.length * lineH;
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  ctx.font = font;
  ctx.fillStyle = item.color;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => ctx.fillText(l, 0, (i * lineH + item.size * TEXT_BASELINE) * scale));
  return { src: canvas.toDataURL('image/png'), w, h };
}

async function drawItem(
  doc: PDFDocument,
  page: PDFPage,
  item: EditItem,
  fonts: { regular: PDFFont; bold: PDFFont },
): Promise<void> {
  const f = frameOf(page);
  const rotate = degrees(f.r);
  if (item.kind === 'text') {
    const font = item.bold ? fonts.bold : fonts.regular;
    if (!fontCovers(font, item.text.replace(/\n/g, ''))) {
      const img = await textToPng(item);
      return drawItem(doc, page, { ...item, kind: 'image', ...img }, fonts);
    }
    item.text.split('\n').forEach((line, i) => {
      const at = toPdf(f, item.x, item.y + item.size * (TEXT_BASELINE + i * TEXT_LINE_HEIGHT));
      page.drawText(line, { ...at, size: item.size, font, color: hexToRgb(item.color), rotate });
    });
    return;
  }
  if (item.kind === 'image') {
    const { bytes, png } = dataUrlBytes(item.src);
    const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const at = toPdf(f, item.x, item.y + item.h);
    page.drawImage(img, { ...at, width: item.w, height: item.h, rotate });
    return;
  }
  if (item.kind === 'rect') {
    const at = toPdf(f, item.x, item.y + item.h);
    const base = { ...at, width: item.w, height: item.h, rotate };
    if (item.style === 'whiteout') page.drawRectangle({ ...base, color: rgb(1, 1, 1) });
    else if (item.style === 'highlight')
      page.drawRectangle({
        ...base,
        color: hexToRgb(item.color),
        opacity: 0.4,
        blendMode: BlendMode.Multiply,
      });
    else page.drawRectangle({ ...base, borderColor: hexToRgb(item.color), borderWidth: 1.5 });
    return;
  }
  if (item.points.length < 2) return;
  // drawSvgPath flips y (SVG is y-down), so pass PDF points with y negated, anchored at 0,0.
  const d = item.points
    .map(([vx, vy], i) => {
      const p = toPdf(f, vx, vy);
      return `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`;
    })
    .join(' ');
  page.drawSvgPath(d, {
    x: 0,
    y: 0,
    borderColor: hexToRgb(item.color),
    borderWidth: item.width,
    borderLineCap: 1, // round
  });
}

/** Draw the editor's items onto their pages. */
export async function applyEdits(file: Blob, items: EditItem[]): Promise<Blob> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const pages = doc.getPages();
  for (const item of items) {
    const page = pages[item.page];
    if (page) await drawItem(doc, page, item, fonts);
  }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

export type Corner = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right';
export interface PageNumberOptions {
  position: Corner;
  /** "{n}" is the page number, "{total}" the page count. */
  format: string;
  start: number;
  size: number;
  skipFirst: boolean;
}

/** Stamp page numbers, upright on every page whatever its rotation. */
export async function addPageNumbers(file: Blob, o: PageNumberOptions): Promise<Blob> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const counted = o.skipFirst ? pages.length - 1 : pages.length;
  const margin = 28;
  pages.forEach((page, i) => {
    if (o.skipFirst && i === 0) return;
    const n = o.start + i - (o.skipFirst ? 1 : 0);
    const text = o.format
      .replace('{n}', String(n))
      .replace('{total}', String(counted + o.start - 1));
    const tw = font.widthOfTextAtSize(text, o.size);
    const { width, height } = viewSize(page);
    const vx =
      o.position === 'bottom-left'
        ? margin
        : o.position === 'bottom-center'
          ? (width - tw) / 2
          : width - margin - tw;
    const vy = o.position === 'top-right' ? margin + o.size : height - margin;
    const f = frameOf(page);
    page.drawText(text, {
      ...toPdf(f, vx, vy),
      size: o.size,
      font,
      color: rgb(0.2, 0.2, 0.2),
      rotate: degrees(f.r),
    });
  });
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

export interface WatermarkOptions {
  text: string;
  size: number;
  color: string;
  opacity: number;
  /** Diagonal across the page, or straight across the middle. */
  diagonal: boolean;
}

/** A large semi-transparent text stamp centred on every page. */
export async function addWatermark(file: Blob, o: WatermarkOptions): Promise<Blob> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  if (!fontCovers(font, o.text)) throw new Error('Watermark text must use Latin letters');
  const tw = font.widthOfTextAtSize(o.text, o.size);
  const th = font.heightAtSize(o.size, { descender: false });
  for (const page of doc.getPages()) {
    const f = frameOf(page);
    const { width, height } = viewSize(page);
    const angle = o.diagonal ? (Math.atan2(height, width) * 180) / Math.PI : 0;
    const a = (angle * Math.PI) / 180;
    // Start the baseline so the text's centre sits on the page centre once rotated (view space
    // is y-down: the text runs along (cos a, −sin a) and "up" is (−sin a, −cos a)).
    const vx = width / 2 - (Math.cos(a) * tw) / 2 + (Math.sin(a) * th) / 2;
    const vy = height / 2 + (Math.sin(a) * tw) / 2 + (Math.cos(a) * th) / 2;
    page.drawText(o.text, {
      ...toPdf(f, vx, vy),
      size: o.size,
      font,
      color: hexToRgb(o.color),
      opacity: o.opacity,
      rotate: degrees(f.r + angle),
    });
  }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}
