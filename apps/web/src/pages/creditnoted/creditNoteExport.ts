import type { Workbook } from 'exceljs';
import { isVatChargedLine, vatFactor, type BillingDoc } from '@gs/shared';
import { saveBlob } from '../../lib/files';
import { creditNoteHeader, pricedLines } from '../print/PrintDocPage';
import { addPrintFonts } from '../print/printFonts';

/*
 * Print, PDF and Excel for a Credit Noted, built from what is on screen (the live preview),
 * so a draft can be printed or exported as it stands.
 */

/** "CreditNote_HIP26932472": the house bill (or the note's number) names the file. */
export function creditNoteFileName(d: BillingDoc): string {
  const ref = (d.header.refNo || d.number || 'Doc').trim();
  return `CreditNote_${ref.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
}

/**
 * Print the sheet through a hidden A4 frame: only the paper, no app around it. For "PDF" the
 * frame's title is the file name, which the browser's "Save as PDF" suggests.
 */
export function printCreditNote(sheet: HTMLElement, title: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;top:-10000px;left:-10000px;width:210mm;height:297mm;border:0;';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow!;
  const doc = win.document;
  // The app's own stylesheets (CSS modules included), so the sheet looks the same.
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')]
    .map((el) => el.outerHTML)
    .join('\n');
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>${styles}
<style>
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .paper { width: 210mm; padding: 15mm; box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  @media print { .paper { page-break-after: avoid; } }
</style></head><body><div class="paper">${sheet.outerHTML}</div></body></html>`);
  doc.close();

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.title = prevTitle;
    iframe.remove();
  };
  // Some browsers name the PDF after the page that called print(), so set both titles.
  const prevTitle = document.title;
  const go = () => {
    document.title = title;
    win.addEventListener('afterprint', () => setTimeout(cleanup, 100));
    win.focus();
    win.print();
    setTimeout(cleanup, 60_000); // in case "afterprint" never fires
  };
  // Wait for the stylesheets and fonts inside the frame before printing. The Khmer faces are
  // added by script, so the frame gets its own copy and loads them first.
  const ready = () => {
    const faces = addPrintFonts(doc).map((f) => f.load().catch(() => undefined));
    void Promise.all(faces)
      .then(() => doc.fonts?.ready)
      .then(() => setTimeout(go, 50));
  };
  if (doc.readyState === 'complete') ready();
  else iframe.addEventListener('load', ready, { once: true });
}

/** Characters that fit across the merged B–D value cells (bold Calibri 10). */
const LEFT_VALUE_CHARS = 64;

/** Split text into lines of at most `max` characters, breaking between words. */
export function breakLines(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > max) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The sheet as a formatted .xlsx laid out like the printout: title, header block, the item
 * table with live formulas and a TOTAL row. Calibri throughout, because Helvetica isn't
 * installed on most computers that will open the file.
 */
export async function exportCreditNoteExcel(d: BillingDoc, portName: string | undefined) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  addCreditNoteSheet(wb, d, portName, 'Credit Note');
  await saveWorkbook(wb, `${creditNoteFileName(d)}.xlsx`);
}

/**
 * Several credit notes in one workbook, one sheet each (named after the note and its declare
 * no. or house bill, e.g. "CN26-003 E 264562"), in the order given.
 */
export async function exportCreditNotePackExcel(
  notes: { doc: BillingDoc; portName: string | undefined }[],
  fileName: string,
) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const { doc, portName } of notes) {
    // Excel sheet names: at most 31 characters, none of : \ / ? * [ ], unique.
    const base = [doc.number, doc.header.declareNo || doc.header.refNo]
      .filter(Boolean)
      .join(' ')
      .replace(/[:\\/?*[\]]/g, '-')
      .slice(0, 31)
      .trim();
    let name = base || 'Credit Note';
    for (let i = 2; used.has(name.toLowerCase()); i++)
      name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
    used.add(name.toLowerCase());
    addCreditNoteSheet(wb, doc, portName, name);
  }
  await saveWorkbook(wb, fileName);
}

async function saveWorkbook(wb: Workbook, fileName: string) {
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName,
  );
}

function addCreditNoteSheet(
  wb: Workbook,
  d: BillingDoc,
  portName: string | undefined,
  sheetName: string,
) {
  const FONT = 'Calibri';
  const ws = wb.addWorksheet(sheetName, {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [
    { width: 9.43 }, // A  NO
    { width: 42 }, //   B  DESCRIPTION
    { width: 9 }, //    C  Q'TY
    { width: 12 }, //   D  UNIT
    { width: 12 }, //   E  PRICE
    { width: 13 }, //   F  SUBTOTAL
    { width: 12 }, //   G  MARK (left half)
    { width: 16 }, //   H  MARK (right half)
  ];

  const thin = { style: 'thin', color: { argb: 'FF000000' } } as const;
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const gray = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDBDBD' } } as const;
  const money = '#,##0.00';
  const font = (extra: Record<string, unknown> = {}) => ({ name: FONT, size: 10, ...extra });
  const styleRow = (row: number, from: number, to: number, opts: Record<string, unknown>) => {
    for (let c = from; c <= to; c++) Object.assign(ws.getCell(row, c), opts);
  };

  let r = 1;
  // Title
  ws.mergeCells(r, 1, r, 8);
  Object.assign(ws.getCell(r, 1), {
    value: 'CREDIT NOTED',
    font: font({ size: 16, bold: true, underline: true }),
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  ws.getRow(r).height = 26;
  r += 2;

  // Header block: labels in A and E, values merged across B–D and F–H.
  const { left, right } = creditNoteHeader(d, portName);
  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i++) {
    const row = r + i;
    // Long left values (the address) get real line breaks, so they read the same in every
    // Excel / LibreOffice instead of depending on how each one wraps.
    const leftLines = left[i] ? breakLines(left[i]![1], LEFT_VALUE_CHARS) : [''];
    const pair = (
      cols: [number, number, number],
      kv: [string, string] | undefined,
      value: string,
      vertical: 'top' | 'middle',
    ) => {
      if (!kv) return;
      const [labelCol, from, to] = cols;
      Object.assign(ws.getCell(row, labelCol), {
        value: kv[0],
        font: font({ bold: true }),
        alignment: { horizontal: 'left', vertical },
      });
      ws.mergeCells(row, from, row, to);
      Object.assign(ws.getCell(row, from), {
        value,
        font: font({ bold: true }),
        alignment: { horizontal: 'left', vertical, wrapText: true },
      });
    };
    pair([1, 2, 4], left[i], leftLines.join('\n'), 'top');
    // The house bill sits beside the two-line address: centred on it, not stuck to the top.
    pair([5, 6, 8], right[i], right[i]?.[1] ?? '', leftLines.length > 1 ? 'middle' : 'top');
    if (leftLines.length > 1) ws.getRow(row).height = 15 * leftLines.length;
  }
  r += rows + 1;

  // Item table: NO, DESCRIPTION, Q'TY, UNIT, PRICE, SUBTOTAL, MARK (G–H merged).
  const head = r;
  ['NO', 'DESCRIPTION', "Q'TY", 'UNIT', 'PRICE', 'SUBTOTAL'].forEach((t, i) => {
    ws.getCell(head, i + 1).value = t;
  });
  ws.mergeCells(head, 7, head, 8);
  ws.getCell(head, 7).value = 'MARK';
  styleRow(head, 1, 8, {
    fill: gray,
    border: box,
    font: font({ bold: true }),
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  r += 1;

  const first = r;
  const lines = pricedLines(d);
  lines.forEach((l, i) => {
    const row = r;
    ws.getCell(row, 1).value = i + 1;
    ws.getCell(row, 2).value = l.description;
    ws.getCell(row, 3).value = Number(l.qty) || 0;
    ws.getCell(row, 4).value = l.unit;
    ws.getCell(row, 5).value = Number(l.unitPrice) || 0;
    ws.getCell(row, 6).value = {
      // The processing fee: the document's VAT on top (10% → ×1.1), as in the system.
      formula: isVatChargedLine(l.description)
        ? `ROUND(ROUND(C${row}*E${row},2)*${vatFactor(d.header.vatRate ?? undefined)},2)`
        : `ROUND(C${row}*E${row},2)`,
      result: Number(l.subtotal) || 0,
    };
    ws.mergeCells(row, 7, row, 8);
    ws.getCell(row, 7).value = l.mark ?? '';
    styleRow(row, 1, 8, { border: box, font: font() });
    const align = ['center', 'left', 'center', 'center', 'right', 'right', 'center'] as const;
    align.forEach((h, c) => {
      ws.getCell(row, c + 1).alignment = {
        horizontal: h,
        vertical: 'middle',
        indent: c === 1 ? 1 : 0,
      };
    });
    ws.getCell(row, 5).numFmt = money;
    ws.getCell(row, 6).numFmt = money;
    r += 1;
  });
  const last = r - 1;

  // TOTAL row
  ws.mergeCells(r, 1, r, 5);
  ws.getCell(r, 1).value = 'TOTAL:';
  ws.getCell(r, 6).value = lines.length
    ? { formula: `SUM(F${first}:F${last})`, result: Number(d.totals.total) || 0 }
    : 0;
  ws.mergeCells(r, 7, r, 8);
  styleRow(r, 1, 8, { fill: gray, border: box, font: font({ bold: true }) });
  ws.getCell(r, 1).alignment = { horizontal: 'right' };
  ws.getCell(r, 6).alignment = { horizontal: 'right' };
  ws.getCell(r, 6).numFmt = money;
}
