/**
 * PDF → Word / Excel from the text layout pdf.js reads (see `readPages`). Only real text comes
 * across: scanned pages have none, and pictures, lines and boxes are left out.
 */
import type { PageText, TextCell, TextRow, TextSpan } from './pdfEngine';

/** Characters XML 1.0 forbids; some PDFs carry them in their text. */
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const clean = (s: string) => s.replace(BAD_XML, '');
const esc = (s: string) =>
  clean(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ Excel */

/** Cells that start within this many points of each other share a column. */
const COLUMN_SNAP = 10;

/**
 * Line up cells into spreadsheet columns: cell left edges across the page are grouped, and each
 * group is one column. Cells that land in the same column of a row are joined with a space.
 */
export function tableColumns(rows: TextRow[]): string[][] {
  const xs = rows.flatMap((r) => r.cells.map((c) => c.x)).sort((a, b) => a - b);
  const anchors: number[] = [];
  for (const x of xs)
    if (!anchors.length || x - anchors[anchors.length - 1]! > COLUMN_SNAP) anchors.push(x);
  const col = (c: TextCell) => {
    let i = 0;
    while (i + 1 < anchors.length && anchors[i + 1]! <= c.x + 0.01) i++;
    return i;
  };
  return rows.map((r) => {
    const out: string[] = [];
    for (const c of r.cells) {
      const i = col(c);
      out[i] = out[i] ? `${out[i]} ${c.text}` : c.text;
    }
    return Array.from(out, (v) => v ?? '');
  });
}

/**
 * Amounts like "1,234.50", "-75", "(120.00)" or "$9.99" become numbers so they add up in Excel,
 * with a matching number format. Codes with leading zeros, phone numbers and long IDs stay text.
 */
export function cellValue(text: string): { value: string | number; numFmt?: string } {
  const t = text.trim();
  const m = /^(-|\()?\s*(?:US\$|\$|USD\s?)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(\))?$/.exec(
    t,
  );
  if (!m || (m[1] === '(') !== !!m[4]) return { value: t };
  const [, sign, whole, dec] = m;
  const digits = whole!.replace(/,/g, '');
  if ((digits.length > 1 && digits.startsWith('0')) || digits.length + (dec?.length ?? 0) > 15)
    return { value: t };
  const n = Number(`${digits}${dec ? `.${dec}` : ''}`) * (sign ? -1 : 1);
  const grouped = whole!.includes(',');
  const numFmt = dec
    ? `${grouped ? '#,##0' : '0'}.${'0'.repeat(dec.length)}`
    : grouped
      ? '#,##0'
      : undefined;
  return { value: n, numFmt };
}

/** One worksheet per page, or every page stacked on one sheet. */
export async function pagesToXlsx(pages: PageText[], oneSheet: boolean): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const make = (name: string) => wb.addWorksheet(name);
  const single = oneSheet ? make('PDF') : null;
  for (const p of pages) {
    const ws = single ?? make(`Page ${p.page + 1}`);
    const grid = tableColumns(p.rows);
    grid.forEach((cells, r) => {
      const row = ws.addRow(cells.map((c) => (c ? cellValue(c).value : null)));
      const bold = p.rows[r]!.cells.every((c) => c.spans.every((s) => s.bold));
      cells.forEach((c, i) => {
        if (!c) return;
        const cell = row.getCell(i + 1);
        const fmt = cellValue(c).numFmt;
        if (fmt) cell.numFmt = fmt;
        if (bold) cell.font = { bold: true };
        if (typeof cell.value === 'string') cell.value = clean(cell.value);
      });
    });
    if (single && p !== pages[pages.length - 1]) ws.addRow([]);
  }
  for (const ws of wb.worksheets) {
    (ws.columns ?? []).forEach((col) => {
      let w = 8;
      col.eachCell?.({ includeEmpty: false }, (c) => {
        w = Math.max(w, String(c.text ?? '').length + 2);
      });
      col.width = Math.min(w, 60);
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/* ------------------------------------------------------------------ Word */

const twip = (pt: number) => Math.max(0, Math.round(pt * 20));
const MIN_MARGIN = 18; // a quarter inch
const MAX_MARGIN = 72;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const LINE = 1.2; // line height per point of text

/** One Word paragraph per PDF line, placed with indents, tab stops and spacing like the page. */
function pageBody(p: PageText, last: boolean): string {
  const xs = p.rows.flatMap((r) => r.cells.map((c) => c.x));
  const left = clamp(Math.min(...xs, MAX_MARGIN), MIN_MARGIN, MAX_MARGIN);
  const first = p.rows[0];
  // y is measured up from the bottom; turn it into distance from the top.
  const top = clamp(first ? p.height - first.y - first.size : MAX_MARGIN, MIN_MARGIN, MAX_MARGIN);
  // Each page ends its own Word section, which carries the page size; the last one sits in <w:body>.
  const brk = last ? '' : sectPr(p, left, top);
  // Where Word's last line ends, from the page top. Spacing is measured from here rather than
  // from the previous PDF line, so a line that overlaps the one above (a big watermark) doesn't
  // push everything below it down the page.
  let cursor = top;
  const paras = p.rows.map((row, i) => {
    const lineH = row.size * LINE;
    const before = Math.max(0, p.height - row.y - row.size - cursor);
    cursor += before + lineH;
    const [lead, ...rest] = row.cells;
    const tabs = rest.length
      ? `<w:tabs>${rest.map((c) => `<w:tab w:val="left" w:pos="${twip(c.x - left)}"/>`).join('')}</w:tabs>`
      : '';
    const runs = row.cells
      .map((c, ci) => (ci ? '<w:r><w:tab/></w:r>' : '') + c.spans.map(run).join(''))
      .join('');
    return (
      `<w:p><w:pPr>${tabs}<w:spacing w:before="${twip(before)}" w:after="0" ` +
      `w:line="${twip(lineH)}" w:lineRule="atLeast"/><w:ind w:left="${twip((lead?.x ?? left) - left)}"/>` +
      `${i === p.rows.length - 1 ? brk : ''}</w:pPr>${runs}</w:p>`
    );
  });
  // An empty (scanned) page still gets its own page in Word.
  if (!paras.length) paras.push(`<w:p><w:pPr>${brk}</w:pPr></w:p>`);
  return paras.join('') + (last ? sectPr(p, left, top) : '');
}

/** Word sizes are in half points. */
function run(s: TextSpan) {
  const size = Math.round(clamp(s.size, 4, 72) * 2);
  return (
    `<w:r><w:rPr>${s.bold ? '<w:b/>' : ''}${s.italic ? '<w:i/>' : ''}` +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
    `<w:t xml:space="preserve">${esc(s.text)}</w:t></w:r>`
  );
}

function sectPr(p: PageText, left: number, top: number) {
  const landscape = p.width > p.height ? ' w:orient="landscape"' : '';
  return (
    `<w:sectPr><w:pgSz w:w="${twip(p.width)}" w:h="${twip(p.height)}"${landscape}/>` +
    `<w:pgMar w:top="${twip(top)}" w:right="${twip(MIN_MARGIN)}" w:bottom="${twip(MIN_MARGIN)}" ` +
    `w:left="${twip(left)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`
  );
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** The document.xml for these pages: one Word page per PDF page. */
export function documentXml(pages: PageText[]): string {
  const body = pages.map((p, i) => pageBody(p, i === pages.length - 1)).join('');
  return `${XML_HEAD}<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`;
}

/** A .docx built by hand (it is a zip of XML parts), so no Word library is needed. */
export async function pagesToDocx(pages: PageText[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/styles.xml',
    `${XML_HEAD}<w:styles xmlns:w="${W_NS}"><w:docDefaults>` +
      '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>' +
      '<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '</w:styles>',
  );
  zip.file('word/document.xml', documentXml(pages));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
