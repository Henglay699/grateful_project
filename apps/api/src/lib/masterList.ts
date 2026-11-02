import ExcelJS from 'exceljs';
import type { CutStockCategory } from '@gs/shared';

export interface MasterListRow {
  lineNo: number;
  declareRef: string;
  category: CutStockCategory;
  name: string;
  newOrUsed: string | null;
  unit: string;
  qty: number;
  unitPrice: number;
  remarks: string | null;
  importedQty: number;
  importedValue: number;
  importedNw: number;
  /** BALANCE column as the spreadsheet computed it — used to verify the import. */
  sheetBalance: number;
  /** 1-based worksheet row, for error messages. */
  sheetRow: number;
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object' && 'result' in v) return (v as ExcelJS.CellFormulaValue).result;
  if (v && typeof v === 'object' && 'richText' in v)
    return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
  return v;
}
const num = (v: unknown) =>
  typeof v === 'number' ? v : Number(String(v ?? '0').replace(/[^0-9.-]/g, '')) || 0;
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).trim());

function categoryFromHeading(h: string): CutStockCategory | null {
  const u = h.toUpperCase();
  if (u.includes('MACHIN')) return 'MACHINERY_EQUIPMENT';
  if (u.includes('RAW')) return 'RAW_MATERIAL';
  if (u.includes('ACCESS')) return 'ACCESSORY';
  return null;
}

/**
 * Reads "JR CDC MASTER LIST.xlsx": category heading rows (e.g. "I. MACHINERIES & EQUIPMENTS")
 * followed by item rows A..O = No, Name, New/Used, Unit, Qty, Unit price, Total, Remarks,
 * Imported qty, Imported price, Imported N.W, Balance, <50%, Condition, Declare.
 */
export async function readMasterList(source: string | Buffer): Promise<MasterListRow[]> {
  const wb = new ExcelJS.Workbook();
  if (typeof source === 'string') await wb.xlsx.readFile(source);
  else await wb.xlsx.load(source as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Master list has no worksheet');
  const rows: MasterListRow[] = [];
  let category: CutStockCategory | null = null;
  ws.eachRow((row, rowNumber) => {
    const c = (i: number) => cellValue(row.getCell(i).value);
    const a = c(1);
    const b = str(c(2));
    if (typeof a === 'string' && !b) {
      category = categoryFromHeading(a) ?? category;
      return;
    }
    const lineNo = num(a);
    const declareRef = str(c(15));
    if (!lineNo || !b || !declareRef || !category) return;
    rows.push({
      lineNo,
      declareRef,
      category,
      name: b.replace(/\s+/g, ' '),
      newOrUsed: str(c(3)),
      unit: str(c(4)) ?? 'PCS',
      qty: num(c(5)),
      unitPrice: num(c(6)),
      remarks: str(c(8)),
      importedQty: num(c(9)),
      importedValue: num(c(10)),
      importedNw: num(c(11)),
      sheetBalance: num(c(12)),
      sheetRow: rowNumber,
    });
  });
  return rows;
}
