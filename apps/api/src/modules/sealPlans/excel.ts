import ExcelJS from 'exceljs';
import type { SealPlanRow } from '@gs/shared';

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1]!;
const cap = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();

/** Columns A–U, as on the SEAL PLAN sheet (without its MONTH column: months are heading rows). */
const COLUMNS: { head: string; width: number }[] = [
  { head: 'NO.', width: 5 },
  { head: 'GS INV NO.', width: 11 },
  { head: 'CLIENT', width: 22 },
  { head: 'CARRIER', width: 11 },
  { head: 'SO NO.', width: 20 },
  { head: 'PORT', width: 20 },
  { head: 'DESTINATION', width: 18 },
  { head: 'CONTAINER NO.', width: 14 },
  { head: 'SIZE', width: 7 },
  { head: 'CARRIER SEAL', width: 15 },
  { head: 'CUSTOMS SEAL', width: 12 },
  { head: 'VESSEL', width: 20 },
  { head: 'TARE WEIGHT', width: 12 },
  { head: 'ETD', width: 11 },
  { head: 'TRUCK BY', width: 10 },
  { head: 'DRIVER PHONE', width: 13 },
  { head: 'TRUCK NO.', width: 10 },
  { head: 'DELIVER TO', width: 18 },
  { head: 'DATE', width: 11 },
  { head: 'DEPOT', width: 26 },
  { head: 'OTHER', width: 16 },
];
const LAST = COLUMNS.length; // U
const thin = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
/** "YYYY-MM-DD" → a date cell (UTC midnight, so Excel shows that calendar day). */
const date = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);

/** The Seal Plans list (already filtered and sorted by month) as the SEAL PLAN workbook. */
export function sealPlanWorkbook(rows: SealPlanRow[], year: number, month?: number) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SEAL PLAN', {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));

  const first = rows[0]?.month;
  const last = rows[rows.length - 1]?.month;
  const period = month
    ? `${cap(MONTHS[month - 1]!)} ${year}`
    : first && last && first !== last
      ? `${cap(monthName(first))} – ${cap(monthName(last))} ${year}`
      : first
        ? `${cap(monthName(first))} ${year}`
        : String(year);
  ws.mergeCells(1, 1, 1, LAST);
  ws.getCell(1, 1).value = 'SEAL PLAN — CONTAINER SHIPMENT SCHEDULE';
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, LAST);
  ws.getCell(2, 1).value = period;
  ws.getCell(2, 1).font = { italic: true };
  for (const r of [1, 2]) ws.getCell(r, 1).alignment = { horizontal: 'center' };

  const head = ws.getRow(3);
  head.height = 30;
  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.head;
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    cell.border = border;
  });

  let current: string | null = null;
  let no = 0;
  for (const r of rows) {
    if (r.month !== current) {
      current = r.month;
      no = 0;
      const h = ws.addRow([`${monthName(r.month)} ${r.month.slice(0, 4)}`]);
      ws.mergeCells(h.number, 1, h.number, LAST);
      h.font = { bold: true };
      h.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      h.getCell(1).border = border;
    }
    const row = ws.addRow([
      ++no,
      r.invNo ?? 'TBA',
      r.clientName,
      r.carrier ?? 'TBA',
      r.bookingNo,
      r.portName,
      r.destination ?? r.destinationCountry,
      r.containerNo,
      r.size,
      r.linerSeal,
      r.customsSeal,
      r.vesselName,
      r.tareWeightKg === null ? null : Number(r.tareWeightKg),
      date(r.etd),
      r.truckBy,
      r.driverPhone,
      r.truckNo,
      r.deliverTo,
      date(r.loadingDate),
      r.depot,
      r.other,
    ]);
    row.getCell(13).numFmt = '#,##0" KGS"';
    row.getCell(14).numFmt = 'dd-mmm-yy';
    row.getCell(19).numFmt = 'dd-mmm-yy';
    for (let col = 1; col <= LAST; col++) {
      const cell = row.getCell(col);
      cell.border = border;
      cell.alignment = { horizontal: col === 13 ? 'right' : 'center', vertical: 'middle' };
    }
  }
  return wb;
}
