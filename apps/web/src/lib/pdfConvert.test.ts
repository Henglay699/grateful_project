// @vitest-environment node
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { cellValue, documentXml, pagesToDocx, pagesToXlsx, tableColumns } from './pdfConvert';
import { textRows, type PageText, type TextRun } from './pdfEngine';

const run = (str: string, x: number, y: number, extra: Partial<TextRun> = {}): TextRun => ({
  str,
  x,
  y,
  width: str.length * 5,
  height: 10,
  ...extra,
});

/** An invoice-like page: a title, a header row and two item rows with right-aligned amounts. */
const invoice = (): PageText => ({
  page: 0,
  width: 595,
  height: 842,
  rows: textRows([
    run('INVOICE', 40, 800, { bold: true }),
    run('Description', 40, 760, { bold: true }),
    run('Amount', 400, 760, { bold: true }),
    run('Ocean freight', 40, 745),
    run('1,200.00', 400, 745),
    run('Handling', 40, 730),
    run('75.50', 405, 730),
  ]),
});

describe('tableColumns', () => {
  it('lines cells up into columns across rows', () => {
    expect(tableColumns(invoice().rows)).toEqual([
      ['INVOICE'],
      ['Description', 'Amount'],
      ['Ocean freight', '1,200.00'],
      ['Handling', '75.50'],
    ]);
  });

  it('keeps an empty cell where a row skips a column', () => {
    const rows = textRows([
      run('A', 0, 700),
      run('B', 100, 700),
      run('C', 200, 700),
      run('X', 0, 680),
      run('Z', 200, 680),
    ]);
    expect(tableColumns(rows)).toEqual([
      ['A', 'B', 'C'],
      ['X', '', 'Z'],
    ]);
  });
});

describe('cellValue', () => {
  it('turns amounts into numbers with a matching format', () => {
    expect(cellValue('1,234.50')).toEqual({ value: 1234.5, numFmt: '#,##0.00' });
    expect(cellValue('(120.00)')).toEqual({ value: -120, numFmt: '0.00' });
    expect(cellValue('-75')).toEqual({ value: -75 });
    expect(cellValue('$9.99')).toEqual({ value: 9.99, numFmt: '0.00' });
    expect(cellValue('USD 1,000')).toEqual({ value: 1000, numFmt: '#,##0' });
  });

  it('leaves codes, phone numbers and dates as text', () => {
    for (const t of ['007', '098 484 414', '26 AUG., 2026', '1,23', '12345678901234567', '(5'])
      expect(cellValue(t)).toEqual({ value: t });
  });
});

describe('pagesToXlsx', () => {
  const load = async (blob: Blob) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    return wb;
  };

  it('writes numbers that add up, one sheet per page', async () => {
    const wb = await load(await pagesToXlsx([invoice(), { ...invoice(), page: 1 }], false));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Page 1', 'Page 2']);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('B3').value).toBe(1200);
    expect(ws.getCell('B3').numFmt).toBe('#,##0.00');
    expect(ws.getCell('B4').value).toBe(75.5);
    expect(ws.getCell('A2').font?.bold).toBe(true);
    expect(ws.getCell('A3').font?.bold).toBeFalsy();
  });

  it('stacks pages on one sheet with a blank row between', async () => {
    const wb = await load(await pagesToXlsx([invoice(), { ...invoice(), page: 1 }], true));
    expect(wb.worksheets).toHaveLength(1);
    expect(wb.worksheets[0]!.getCell('A6').value).toBe('INVOICE');
  });
});

describe('pagesToDocx', () => {
  it('keeps text, bold, tab stops and one section per page', () => {
    const xml = documentXml([invoice(), { ...invoice(), page: 1, width: 842, height: 595 }]);
    expect(xml).toContain(
      '<w:b/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">INVOICE</w:t>',
    );
    // "Amount" sits 360pt right of the 40pt margin.
    expect(xml).toContain('<w:tab w:val="left" w:pos="7200"/>');
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(xml).toContain('w:w="16840" w:h="11900" w:orient="landscape"');
  });

  it('keeps each piece of text at its own size on a shared line', () => {
    const page: PageText = {
      ...invoice(),
      rows: textRows([
        run('SHIPPER', 40, 800, { height: 7 }),
        run('CARGO RECEIPT', 300, 800, { height: 14 }),
      ]),
    };
    const xml = documentXml([page]);
    expect(xml).toContain(
      '<w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">SHIPPER',
    );
    expect(xml).toContain(
      '<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t xml:space="preserve">CARGO RECEIPT',
    );
  });

  it('escapes markup and drops characters XML cannot hold', () => {
    const page: PageText = { ...invoice(), rows: textRows([run('A & B <c>\u0001', 40, 800)]) };
    expect(documentXml([page])).toContain('>A &amp; B &lt;c&gt;</w:t>');
  });

  it('gives a scanned page its own empty page', () => {
    const xml = documentXml([invoice(), { ...invoice(), page: 1, rows: [] }]);
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
  });

  it('packs a valid .docx', async () => {
    const zip = await JSZip.loadAsync(await (await pagesToDocx([invoice()])).arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
        'word/styles.xml',
      ]),
    );
  });
});
