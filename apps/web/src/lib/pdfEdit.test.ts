// @vitest-environment node
import { degrees, PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { addPageNumbers, applyEdits, toPdf, viewSize } from './pdfEdit';

const frame = { x0: 0, y0: 0, w: 400, h: 600 };

describe('toPdf', () => {
  it('maps the displayed top-left corner for each page rotation', () => {
    // The displayed top-left is a different PDF corner for each rotation.
    expect(toPdf({ ...frame, r: 0 }, 0, 0)).toEqual({ x: 0, y: 600 });
    expect(toPdf({ ...frame, r: 90 }, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(toPdf({ ...frame, r: 180 }, 0, 0)).toEqual({ x: 400, y: 0 });
    expect(toPdf({ ...frame, r: 270 }, 0, 0)).toEqual({ x: 400, y: 600 });
  });

  it('respects a crop box that does not start at 0,0', () => {
    expect(toPdf({ x0: 10, y0: 20, w: 400, h: 600, r: 0 }, 5, 5)).toEqual({ x: 15, y: 615 });
  });
});

describe('editing', () => {
  it('reports the displayed size of rotated pages', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    page.setRotation(degrees(90));
    expect(viewSize(page)).toEqual({ width: 600, height: 400 });
  });

  it('draws items and page numbers without touching the page count', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 600]);
    doc.addPage([400, 600]);
    const file = new Blob([await doc.save()]);
    const edited = await applyEdits(file, [
      {
        id: 't',
        page: 1,
        kind: 'text',
        x: 20,
        y: 20,
        text: 'Hello\nworld',
        size: 12,
        color: '#000',
      },
      {
        id: 'r',
        page: 0,
        kind: 'rect',
        x: 10,
        y: 10,
        w: 50,
        h: 20,
        style: 'whiteout',
        color: '#fff',
      },
      {
        id: 'i',
        page: 0,
        kind: 'ink',
        points: [
          [0, 0],
          [10, 10],
        ],
        color: '#f00',
        width: 2,
      },
    ]);
    const numbered = await addPageNumbers(edited, {
      position: 'bottom-center',
      format: '{n} / {total}',
      start: 1,
      size: 10,
      skipFirst: false,
    });
    expect((await PDFDocument.load(await numbered.arrayBuffer())).getPageCount()).toBe(2);
  });
});
