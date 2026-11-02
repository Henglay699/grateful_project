import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import {
  CLEARANCE_STATUS_LABEL,
  CLEARANCE_STATUSES,
  CONTAINER_SIZES,
  shipmentInputSchema,
  type PlanImportResult,
  type ShipmentInput,
} from '@gs/shared';
import { db, type Tx } from '../../db/client';
import { consignees, forwarders } from '../../db/schema';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { queryRows } from '../../lib/listing';
import { parseDateCell } from './excel';
import { insertShipment, shipmentUniqueMessage, type Actor } from './service';

/*
 * Shipping Plan → Import from Excel. The template has two parts:
 *   Imports: one row per item, laid out like the client's own import schedule (ETA PORT … INVOICE
 *     NUMBER). Rows run on into the shipment above until a new HBL (or, without an HBL, a new
 *     INV) starts the next one, so merged cells copied from the schedule read naturally.
 *   Exports: one sheet per kind of data, joined by the "Ref" the user gives each shipment:
 *     Exports (one row each) · Export Containers · Export Invoices (one row per line) ·
 *     Export Declarations.
 * Columns are found by their heading, so their order doesn't matter. EXAMPLE rows are the
 * template's samples and are skipped. Everything is checked first; the file is saved in one
 * transaction only when nothing is wrong, so it's all or nothing.
 */

type Field = { key: string; header: string; width: number; note: string; list?: string };

const IM: Field[] = [
  {
    key: 'client',
    header: 'Client *',
    width: 9,
    note: 'Client code, e.g. JR. Empty: the same client as the row above.',
    list: 'clients',
  },
  { key: 'eta', header: 'ETA PORT', width: 11, note: 'Date the goods arrive at the port.' },
  { key: 'arriveFty', header: 'ETA FTY', width: 11, note: 'Date the goods arrive at the factory.' },
  {
    key: 'fwBroker',
    header: 'F.W\nBROKER',
    width: 13,
    note: 'Forwarder, then the customs broker on a second line (e.g. FWF ⏎ GRATEFUL). A new forwarder is added to the list.',
  },
  { key: 'shipper', header: 'SHIPPER', width: 22, note: 'Shipper / supplier name.' },
  {
    key: 'inv',
    header: 'INV',
    width: 13,
    note: 'Cargo invoice no. Empty: the same invoice as the row above.',
  },
  { key: 'invDate', header: 'DATE', width: 11, note: 'Cargo invoice date.' },
  {
    key: 'pkgs',
    header: 'QTY PKGS',
    width: 9,
    note: 'Packages on the invoice (counted once per invoice).',
  },
  {
    key: 'orgDest',
    header: 'ORG / DEST',
    width: 10,
    note: 'Origin country - clearance port, e.g. CH-SHV (CH = China, SHV = Sihanoukville).',
  },
  { key: 'month', header: 'MONTH', width: 9, note: 'For your own reference; not imported.' },
  {
    key: 'material',
    header: 'MATERIAL',
    width: 20,
    note: 'CDC group, e.g. II. RAW MATERIAL or III. ACCESSORY.',
  },
  { key: 'item', header: 'ITEM', width: 24, note: 'Item name, as on the CDC master list.' },
  {
    key: 'cdcNo',
    header: 'CDC NO',
    width: 9,
    note: 'Item no. on the client’s CDC master list, e.g. II-125. The quantity is taken off its balance.',
  },
  { key: 'qty', header: 'QUANTITY', width: 11, note: 'Item quantity, in the CDC unit.' },
  { key: 'unit', header: 'CDC UNIT', width: 8, note: 'MTR, KGS, PCS, SET…' },
  { key: 'nw', header: 'NW.KGS', width: 10, note: '' },
  { key: 'gw', header: 'GW.KGS', width: 10, note: '' },
  { key: 'price', header: 'UNIT PRICE', width: 9, note: 'USD per CDC unit.' },
  {
    key: 'amount',
    header: 'AMOUNT',
    width: 11,
    note: 'Quantity × unit price; for your own reference.',
  },
  {
    key: 'hbl',
    header: 'HBL',
    width: 15,
    note: 'House bill of lading. A new HBL starts a new shipment; empty: the same shipment as the row above.',
  },
  {
    key: 'mark',
    header: 'MARK',
    width: 34,
    note: 'Free text, kept as the remark. Container no. / size, Seal No. and Vessel: name / voyage are read from it.',
  },
  {
    key: 'declareNo',
    header: 'DECLARE',
    width: 11,
    note: 'Customs declaration no., e.g. I 138735. Empty: the same declaration as the row above.',
  },
  { key: 'declareDate', header: 'DECLARE\nDATE', width: 11, note: 'Date.' },
  { key: 'thcFee', header: 'THC\nFEE', width: 10, note: 'USD.' },
  { key: 'thcDate', header: 'INVOICE\nDATE', width: 11, note: 'THC invoice date.' },
  {
    key: 'thcNo',
    header: 'INVOICE\nNUMBER',
    width: 15,
    note: 'THC invoice no(s)., one per line.',
  },
  {
    key: 'freight',
    header: 'Freight',
    width: 9,
    note: 'Sea, Air, Truck or Rail. Empty: Sea.',
    list: 'freight',
  },
  {
    key: 'load',
    header: 'Load',
    width: 9,
    note: 'CY/CY, LCL or Loose. Empty: CY/CY by sea, else Loose.',
    list: 'loads',
  },
  {
    key: 'port',
    header: 'Clearance Port',
    width: 16,
    note: 'Only when ORG / DEST doesn’t name the port, e.g. SHV11.',
    list: 'ports',
  },
];

const X: Field[] = [
  {
    key: 'ref',
    header: 'Ref *',
    width: 8,
    note: 'Your number for this export (1, 2, 3…). The other export sheets use it to say which shipment a row belongs to.',
  },
  { key: 'client', header: 'Client *', width: 10, note: 'Client code, e.g. JR.', list: 'clients' },
  {
    key: 'freight',
    header: 'Freight *',
    width: 10,
    note: 'Sea, Air, Truck or Rail.',
    list: 'freight',
  },
  {
    key: 'load',
    header: 'Load',
    width: 10,
    note: 'CY/CY (full containers), LCL or Loose. Air is always Loose. Empty: CY/CY by sea, else Loose.',
    list: 'loads',
  },
  {
    key: 'clearance',
    header: 'Clearance Status',
    width: 16,
    note: 'Empty: Pending Review.',
    list: 'clearance',
  },
  { key: 'shipper', header: 'Shipper', width: 24, note: 'Shipper name.' },
  {
    key: 'consignee',
    header: 'Consignee',
    width: 24,
    note: 'Consignee name. A new name is added for this client.',
  },
  {
    key: 'forwarder',
    header: 'Forwarder',
    width: 20,
    note: 'Forwarder name. A new name is added to the forwarder list.',
  },
  { key: 'broker', header: 'Broker', width: 14, note: 'Customs broker.' },
  {
    key: 'port',
    header: 'Clearance Port',
    width: 18,
    note: 'Port code or name, e.g. PNH04 or Phnom Penh Port.',
    list: 'ports',
  },
  {
    key: 'destination',
    header: 'Destination Country',
    width: 14,
    note: 'Where the goods go (name or 2-letter code).',
    list: 'countries',
  },
  { key: 'quantity', header: 'Quantity', width: 10, note: 'Number of packages.' },
  { key: 'unit', header: 'Unit', width: 8, note: 'CTNS, ROLLS, PKGS…' },
  { key: 'material', header: 'Material', width: 12, note: 'e.g. Garments, Woven.' },
  { key: 'booking', header: 'Booking / SO No.', width: 14, note: '' },
  { key: 'hbl', header: 'HBL No.', width: 16, note: 'House bill of lading.' },
  { key: 'vessel', header: 'Vessel', width: 16, note: '' },
  { key: 'voyage', header: 'Voyage No.', width: 10, note: '' },
  { key: 'crd', header: 'CRD', width: 12, note: 'Date.' },
  { key: 'etd', header: 'ETD', width: 12, note: 'Date. An export is dated by its ETD.' },
  { key: 'atd', header: 'ATD', width: 12, note: 'Date.' },
  { key: 'thcNo', header: 'Invoice / THC No.', width: 16, note: '' },
  { key: 'thcDate', header: 'Invoice / THC Date', width: 14, note: 'Date.' },
  { key: 'thcAmount', header: 'Invoice / THC Amount', width: 14, note: 'USD.' },
  { key: 'coForm', header: 'CO Form', width: 10, note: '' },
  { key: 'coNumber', header: 'CO Number', width: 14, note: '' },
  {
    key: 'coStatus',
    header: 'CO Status',
    width: 12,
    note: 'Pending, Draft, Submitted or Approved.',
    list: 'coStatuses',
  },
  { key: 'remark', header: 'Remark', width: 30, note: '' },
];
const C: Field[] = [
  { key: 'ref', header: 'Ref *', width: 8, note: 'The export’s Ref.' },
  {
    key: 'containerNo',
    header: 'Container No. *',
    width: 16,
    note: 'e.g. CXDU2223299. CY/CY shipments only.',
  },
  { key: 'size', header: 'Size', width: 8, note: '20GP, 40GP, 40HQ or 45HQ.', list: 'sizes' },
  { key: 'linerSeal', header: 'Liner Seal', width: 14, note: '' },
  { key: 'customsSeal', header: 'Customs Seal', width: 14, note: '' },
];
const I: Field[] = [
  { key: 'ref', header: 'Ref *', width: 8, note: 'The export’s Ref.' },
  {
    key: 'invoiceNo',
    header: 'Invoice No. *',
    width: 14,
    note: 'One row per line; leave empty to continue the invoice above.',
  },
  { key: 'invoiceDate', header: 'Invoice Date', width: 12, note: 'Date.' },
  { key: 'poNo', header: 'PO#', width: 12, note: '' },
  { key: 'styleNo', header: 'Style', width: 12, note: '' },
  { key: 'htsCode', header: 'HTS Code', width: 12, note: 'One HTS code per invoice.' },
  { key: 'pcs', header: 'PCS', width: 8, note: '' },
  { key: 'ctns', header: 'CTNS', width: 8, note: '' },
  { key: 'cbm', header: 'CBM', width: 8, note: '' },
  { key: 'netWeightKg', header: 'N.W KGS', width: 10, note: '' },
  { key: 'grossWeightKg', header: 'G.W KGS', width: 10, note: '' },
  { key: 'fobUnitPrice', header: 'FOB Price', width: 10, note: 'USD per piece.' },
  { key: 'description', header: 'Description', width: 30, note: '' },
];
const D: Field[] = [
  { key: 'ref', header: 'Ref *', width: 8, note: 'The export’s Ref.' },
  { key: 'declareNo', header: 'Declare No. *', width: 14, note: 'e.g. E 264562.' },
  {
    key: 'declareDate',
    header: 'Declare Date *',
    width: 13,
    note: 'Date. Invoices are dated the next working day.',
  },
  {
    key: 'port',
    header: 'Port',
    width: 18,
    note: 'Port code or name; empty: the shipment’s clearance port.',
    list: 'ports',
  },
  { key: 'notes', header: 'Notes', width: 24, note: '' },
];

const IMPORTS = 'Imports';
const EXPORTS = 'Exports';
const EXP_CONTAINERS = 'Export Containers';
const EXP_INVOICES = 'Export Invoices';
const EXP_DECLARATIONS = 'Export Declarations';

const SHEETS: { name: string; fields: Field[]; examples: Record<string, unknown>[] }[] = [
  {
    name: IMPORTS,
    fields: IM,
    examples: [
      {
        client: 'EXAMPLE',
        eta: '2026-09-23',
        arriveFty: '2026-09-28',
        fwBroker: 'FWF\nGRATEFUL',
        shipper: 'SHANGHAI YOUNGYUE',
        inv: 'CNQ26044',
        invDate: '2026-08-31',
        pkgs: 635,
        orgDest: 'CH-SHV',
        month: '09-2026',
        material: 'II. RAW MATERIAL',
        item: 'KNITTED FABRIC',
        cdcNo: 'II-125',
        qty: 32636.7,
        unit: 'MTR',
        nw: 17932.6,
        gw: 18111.7,
        price: 1,
        amount: 32636.7,
        hbl: 'SHSIN6090031',
        mark: 'Unload at XIN YI YANG\nCTNR No. ZCSU7954124 / 40’HQ\nSeal No. A4250250303\nVessel: NUUK MAERSK / 634S',
        declareNo: 'I 138735',
        declareDate: '2026-09-25',
        thcFee: 599.5,
        thcDate: '2026-09-22',
        thcNo: 'FWFTI268937\nFWFTI268938',
      },
      {
        client: 'EXAMPLE',
        material: 'III. ACCESSORY',
        item: 'INTERLINING',
        cdcNo: 'III-130',
        qty: 4968.8,
        unit: 'MTR',
        nw: 678.8,
        gw: 697.8,
        price: 0.2,
        amount: 993.76,
      },
    ],
  },
  {
    name: EXPORTS,
    fields: X,
    examples: [
      {
        ref: 'EXAMPLE',
        client: 'JR',
        freight: 'Sea',
        load: 'CY/CY',
        clearance: 'Customs Cleared',
        shipper: 'JR APPAREL CO., LTD.',
        consignee: 'CHAPTERONE SPORTSWEAR',
        forwarder: 'COSCO',
        port: 'PNH04',
        destination: 'United States',
        quantity: 1150,
        unit: 'CTNS',
        material: 'Garments',
        hbl: 'COSU6464276980',
        etd: '2026-09-03',
        coStatus: 'Approved',
      },
    ],
  },
  {
    name: EXP_CONTAINERS,
    fields: C,
    examples: [{ ref: 'EXAMPLE', containerNo: 'CXDU2223299', size: '45HQ' }],
  },
  {
    name: EXP_INVOICES,
    fields: I,
    examples: [
      {
        ref: 'EXAMPLE',
        invoiceNo: 'JRA26051',
        invoiceDate: '2026-08-28',
        poNo: '123456',
        styleNo: '654321',
        htsCode: '6104.69',
        pcs: 12000,
        ctns: 1150,
        cbm: 60,
        netWeightKg: 15200,
        grossWeightKg: 16864.8,
        fobUnitPrice: 2.5,
        description: 'LADIES PANT KNITTED',
      },
    ],
  },
  {
    name: EXP_DECLARATIONS,
    fields: D,
    examples: [{ ref: 'EXAMPLE', declareNo: 'E 264562', declareDate: '2026-09-02', port: 'PNH04' }],
  },
];

const FREIGHT: Record<string, 'SEA' | 'AIR' | 'ROAD' | 'RAIL'> = {
  sea: 'SEA',
  air: 'AIR',
  truck: 'ROAD',
  road: 'ROAD',
  land: 'ROAD',
  rail: 'RAIL',
  train: 'RAIL',
};
const LOAD: Record<string, 'FCL' | 'LCL' | 'NONE'> = {
  'cy/cy': 'FCL',
  cycy: 'FCL',
  fcl: 'FCL',
  lcl: 'LCL',
  'cfs/cfs': 'LCL',
  'lcl/lcl': 'LCL',
  loose: 'NONE',
  none: 'NONE',
};
const CO_STATUSES = ['Pending', 'Draft', 'Submitted', 'Approved'];
/** Country short forms used in the import schedules ("CH-SHV" is China → Sihanoukville). */
const COUNTRY_ALIAS: Record<string, string> = { ch: 'CN', chn: 'CN', prc: 'CN', vn: 'VN' };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[^a-z0-9#/]/g, '');

interface Refs {
  clients: { id: string; code: string; name: string }[];
  ports: { id: string; code: string; name: string; shortName: string; no: string | null }[];
  countries: { iso2: string; name: string }[];
  forwarders: { id: string; code: string; name: string }[];
  consignees: { id: string; name: string }[];
  cdcItems: { id: string; clientId: string; declareRef: string; name: string }[];
}
async function loadRefs(tx: Tx | typeof db): Promise<Refs> {
  const [clients, ports, countries, fwd, cn, cdcItems] = await Promise.all([
    queryRows<Refs['clients'][number]>(
      tx,
      sql`SELECT id, code, name FROM clients WHERE deleted_at IS NULL ORDER BY code`,
    ),
    queryRows<Refs['ports'][number]>(
      tx,
      sql`SELECT id, code, name, short_name AS "shortName", customs_port_no AS no FROM ports WHERE is_active ORDER BY code`,
    ),
    queryRows<Refs['countries'][number]>(tx, sql`SELECT iso2, name FROM countries ORDER BY name`),
    queryRows<Refs['forwarders'][number]>(
      tx,
      sql`SELECT id, code, name FROM forwarders ORDER BY name`,
    ),
    queryRows<Refs['consignees'][number]>(tx, sql`SELECT id, name FROM consignees ORDER BY name`),
    queryRows<Refs['cdcItems'][number]>(
      tx,
      sql`SELECT id, client_id AS "clientId", declare_ref AS "declareRef", name FROM cut_stock_items WHERE deleted_at IS NULL`,
    ),
  ]);
  return { clients, ports, countries, forwarders: fwd, consignees: cn, cdcItems };
}

/* ------------------------------- The template ------------------------------- */

/** The blank template, with dropdowns filled from the current clients, ports and countries. */
export async function buildPlanTemplate(): Promise<Buffer> {
  const refs = await loadRefs(db);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GS Command Center';
  const font = { name: 'Calibri', size: 10 };
  const head = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7490' } } as const;
  const exampleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } } as const;

  // Instructions first, so it is what opens.
  const help = wb.addWorksheet('Instructions', { views: [{ showGridLines: false }] });
  help.columns = [{ width: 4 }, { width: 110 }];
  const lines: [string, boolean?][] = [
    ['Shipping Plan import template — Grateful Solutions', true],
    [''],
    ['Imports'],
    [
      '1. The Imports sheet is laid out like the import schedule: one row per item. You can paste the schedule’s rows in from column B, with the client code in column A.',
    ],
    [
      '2. A row belongs to the shipment above it until a new HBL starts the next one (a shipment without an HBL yet is one INV). Empty INV, DECLARE and Client cells take the value from the row above, so merged cells work.',
    ],
    [
      '3. CDC NO is the item’s no. on the client’s CDC master list (e.g. II-125). On a declared row (DECLARE filled) its QUANTITY is taken off that item’s balance.',
    ],
    [
      '4. MARK is kept as the shipment’s remark; the container no. and size, Seal No. and Vessel: name / voyage in it are filled in for you.',
    ],
    [''],
    ['Exports'],
    [
      '5. Give every export a Ref (1, 2, 3… or your own file numbers) on the Exports sheet, one row per shipment, and put its containers, invoice lines (PO#, style…) and declarations on the other Export sheets with the same Ref.',
    ],
    [''],
    ['Both'],
    [
      '6. Columns marked * must be filled. Dates: 2026-09-03, 03/09/2026 or 03-Sep-26 (day first). Leave unknown cells empty.',
    ],
    [
      '7. The grey EXAMPLE rows show how to fill a sheet; they are not imported (you can delete them).',
    ],
    [
      '8. In the system: Shipping Plans → Import Excel → choose this file. It is checked first: problems are listed by sheet and row, and nothing is saved until the file is right. Then all shipments are created together.',
    ],
    [
      '9. A forwarder or consignee that isn’t in the system yet is added automatically. Clients, ports and CDC items must exist already.',
    ],
    ['10. A declare no. or invoice no. that is already in the system is refused.'],
    [''],
    ['Columns'],
  ];
  const headings = ['Imports', 'Exports', 'Both', 'Columns'];
  for (const [t, bold] of lines) {
    const row = help.addRow(['', t]);
    row.getCell(2).font = {
      ...font,
      size: bold ? 14 : 10,
      bold: !!bold || headings.includes(t),
    };
  }
  for (const sh of SHEETS) {
    help.addRow(['', '']);
    help.addRow(['', sh.name]).getCell(2).font = {
      ...font,
      bold: true,
      color: { argb: 'FF0E7490' },
    };
    for (const f of sh.fields) {
      const label = f.header.replace(/\n/g, ' ');
      const r = help.addRow(['', `${label}${f.note ? ` — ${f.note}` : ''}`]);
      r.getCell(2).font = font;
    }
  }

  // Lists for the dropdowns (hidden).
  const lists = wb.addWorksheet('Lists', { state: 'hidden' });
  const listValues: Record<string, string[]> = {
    clients: refs.clients.map((c) => c.code),
    freight: ['Sea', 'Air', 'Truck', 'Rail'],
    loads: ['CY/CY', 'LCL', 'Loose'],
    clearance: CLEARANCE_STATUSES.map((s) => CLEARANCE_STATUS_LABEL[s]),
    ports: refs.ports.map((p) => p.code),
    countries: refs.countries.map((c) => c.name),
    coStatuses: CO_STATUSES,
    sizes: [...CONTAINER_SIZES],
  };
  const ranges: Record<string, string> = {};
  Object.entries(listValues).forEach(([k, values], i) => {
    const col = lists.getColumn(i + 1);
    col.values = [k, ...values];
    const letter = col.letter;
    ranges[k] = `Lists!$${letter}$2:$${letter}$${Math.max(2, values.length + 1)}`;
  });

  for (const sh of SHEETS) {
    const ws = wb.addWorksheet(sh.name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
    ws.columns = sh.fields.map((f) => ({ header: f.header, key: f.key, width: f.width }));
    const hr = ws.getRow(1);
    hr.height = 30;
    hr.eachCell((cell, c) => {
      cell.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = head;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      const note = sh.fields[c - 1]!.note;
      if (note) cell.note = note;
    });
    for (const example of sh.examples) {
      const ex = ws.addRow(example);
      ex.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { ...font, italic: true, color: { argb: 'FF64748B' } };
        cell.fill = exampleFill;
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    }
    // Dropdowns and date formats on the first 500 rows.
    sh.fields.forEach((f, i) => {
      const letter = ws.getColumn(i + 1).letter;
      const isDate = /date|^(crd|etd|atd|eta|ata|arrivefty)$/i.test(f.key);
      for (let r = 2; r <= 501; r++) {
        const cell = ws.getCell(`${letter}${r}`);
        if (f.list && ranges[f.list] && r > sh.examples.length + 1)
          cell.dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [ranges[f.list]!],
            showErrorMessage: f.list !== 'countries' && f.list !== 'ports',
            errorTitle: f.header,
            error: 'Choose a value from the list.',
          };
        if (isDate) cell.numFmt = 'dd-mmm-yy';
      }
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ------------------------------- Reading a file ------------------------------- */

type Row = { row: number; v: Record<string, unknown> };

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === 'object') {
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result;
    if ('richText' in v)
      return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v && 'hyperlink' in v) return (v as ExcelJS.CellHyperlinkValue).text;
  }
  return v;
}
const text = (v: unknown) =>
  v === null || v === undefined
    ? ''
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).trim();

/** A sheet's rows as { field: value }, by heading (any column order); EXAMPLE rows skipped. */
function readSheet(ws: ExcelJS.Worksheet | undefined, fields: Field[], exampleKey = 'ref'): Row[] {
  if (!ws) return [];
  const byHeader = new Map(fields.map((f) => [norm(f.header), f.key]));
  const cols = new Map<number, string>();
  ws.getRow(1).eachCell((cell, c) => {
    const key = byHeader.get(norm(text(cellValue(cell))));
    if (key) cols.set(c, key);
  });
  const out: Row[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const v: Record<string, unknown> = {};
    for (const [c, key] of cols) {
      const val = cellValue(row.getCell(c));
      if (text(val) !== '') v[key] = val;
    }
    if (!Object.keys(v).length) continue;
    if (text(v[exampleKey]).toUpperCase() === 'EXAMPLE') continue;
    out.push({ row: r, v });
  }
  return out;
}

/** What the import schedule's MARK cell says about containers, seals and the vessel. */
export function parseMark(mark: string) {
  const containers: { containerNo: string; size: string | null; linerSeal: string }[] = [];
  let vesselName = '';
  let voyageNo = '';
  const up = mark.toUpperCase();
  const seal = /SEAL\s*(?:NO)?\.?\s*:?\s*([A-Z0-9-]{4,})/.exec(up)?.[1] ?? '';
  for (const m of up.matchAll(
    /\b([A-Z]{4})\s?(\d{7})\b(?:\s*\/\s*(20|40|45)\s*['’`]?\s*(GP|HQ|HC|DC)?)?/g,
  )) {
    const no = `${m[1]}${m[2]}`;
    if (containers.some((c) => c.containerNo === no)) continue;
    const kind = m[4] === 'HC' ? 'HQ' : m[4] === 'DC' || (!m[4] && m[3] === '20') ? 'GP' : m[4];
    const size = m[3] && kind ? `${m[3]}${kind}` : null;
    containers.push({
      containerNo: no,
      size: size && (CONTAINER_SIZES as readonly string[]).includes(size) ? size : null,
      linerSeal: seal,
    });
  }
  const vessel = /VESSEL\s*:?\s*([^\n/]+?)\s*(?:\/\s*([^\n]+?))?\s*$/im.exec(mark);
  if (vessel) {
    vesselName = vessel[1]!.trim();
    voyageNo = (vessel[2] ?? '').trim();
  }
  return { containers, vesselName, voyageNo };
}

/** Check (and with save, create) the shipments in an uploaded template. */
export async function importPlan(
  buffer: Buffer,
  opts: { save: boolean; actor: Actor; req: Request; allowedClientIds?: string[] | undefined },
): Promise<PlanImportResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return empty([
      {
        sheet: 'File',
        row: null,
        message: 'This is not an Excel (.xlsx) file the system can read.',
      },
    ]);
  }
  const sheet = (name: string) => wb.worksheets.find((w) => norm(w.name) === norm(name));
  if (!sheet(IMPORTS) && !sheet(EXPORTS))
    return empty([
      {
        sheet: 'File',
        row: null,
        message: 'No "Imports" or "Exports" sheet. Use the template from "Download template".',
      },
    ]);

  const refs = await loadRefs(db);
  const errors: PlanImportResult['errors'] = [];
  const err = (sheetName: string, row: number | null, message: string) =>
    errors.push({ sheet: sheetName, row, message });
  const lc = (s: string) => s.trim().toLowerCase();

  const imps = readSheet(sheet(IMPORTS), IM, 'client');
  const ships = readSheet(sheet(EXPORTS), X);
  const conts = readSheet(sheet(EXP_CONTAINERS), C);
  const lines = readSheet(sheet(EXP_INVOICES), I);
  const decls = readSheet(sheet(EXP_DECLARATIONS), D);
  if (!imps.length && !ships.length)
    err('File', null, 'The Imports and Exports sheets have no rows to import.');

  const findPort = (v: unknown) => {
    const s = lc(text(v));
    return refs.ports.find((p) =>
      [p.code, p.name, p.shortName, p.no ?? ''].some((x) => lc(x) === s),
    );
  };
  const findCountry = (v: unknown) => {
    const s = lc(text(v));
    const iso = COUNTRY_ALIAS[s] ?? s;
    return refs.countries.find((c) => lc(c.iso2) === lc(iso) || lc(c.name) === s);
  };
  const findClient = (v: unknown) =>
    refs.clients.find((c) => lc(c.code) === lc(text(v)) || lc(c.name) === lc(text(v)));
  const date = (sheetName: string, row: number, label: string, v: unknown) => {
    if (v === undefined) return undefined;
    const d = parseDateCell(v);
    if (!d)
      err(sheetName, row, `${label}: "${text(v)}" is not a date (use 2026-09-03 or 03/09/2026).`);
    return d ?? undefined;
  };
  const num = (sheetName: string, row: number, label: string, v: unknown) => {
    if (v === undefined) return undefined;
    const n = Number(text(v).replace(/[,$\s]/g, ''));
    if (!Number.isFinite(n)) err(sheetName, row, `${label}: "${text(v)}" is not a number.`);
    return Number.isFinite(n) ? String(n) : undefined;
  };
  const freightOf = (sheetName: string, row: number, v: unknown) => {
    const mode = FREIGHT[lc(text(v))] ?? null;
    if (!mode) err(sheetName, row, 'Freight must be Sea, Air, Truck or Rail.');
    return mode;
  };
  const loadOf = (
    sheetName: string,
    row: number,
    v: unknown,
    mode: 'SEA' | 'AIR' | 'ROAD' | 'RAIL' | null,
  ) => {
    let load = v === undefined ? undefined : LOAD[lc(text(v)).replace(/\s/g, '')];
    if (v !== undefined && !load) err(sheetName, row, 'Load must be CY/CY, LCL or Loose.');
    if (mode === 'AIR') load = 'NONE';
    return load ?? (mode === 'SEA' ? 'FCL' : 'NONE');
  };
  const checkClient = (sheetName: string, row: number, v: unknown) => {
    const client = findClient(v);
    if (!client)
      err(
        sheetName,
        row,
        v === undefined ? 'Client is empty.' : `Client "${text(v)}" is not in the system.`,
      );
    else if (opts.allowedClientIds && !opts.allowedClientIds.includes(client.id))
      err(sheetName, row, `You don't have access to client ${client.code}.`);
    return client;
  };

  const newForwarders = new Map<string, string>(); // lower → name
  const newConsignees = new Map<string, { name: string; clientId: string; clientCode: string }>();
  /** An existing forwarder's id by name or code, else remembered as one to add. */
  const forwarderOf = (name: string) => {
    if (!name) return undefined;
    const f = refs.forwarders.find((x) => lc(x.name) === lc(name) || lc(x.code) === lc(name));
    if (!f) newForwarders.set(lc(name), name);
    return f?.id;
  };
  const built: {
    ref: string;
    sheet: string;
    row: number;
    input: ShipmentInput;
    clientCode: string;
    fwd?: string;
    cn?: string;
  }[] = [];

  /* ---- Imports: rows grouped into shipments by HBL (or INV without one) ---- */
  type Group = { rows: Row[]; client: unknown; hbl: string; inv: string };
  const groups: Group[] = [];
  for (const r of imps) {
    const cur = groups[groups.length - 1];
    const hbl = text(r.v.hbl).toUpperCase();
    const inv = text(r.v.inv).toUpperCase();
    const client = r.v.client;
    const fresh =
      !cur ||
      (client !== undefined && lc(text(client)) !== lc(text(cur.client))) ||
      (hbl && cur.hbl && hbl !== cur.hbl) ||
      (!cur.hbl && inv && cur.inv && inv !== cur.inv);
    if (fresh) groups.push({ rows: [r], client: client ?? cur?.client, hbl, inv });
    else {
      cur.rows.push(r);
      cur.hbl ||= hbl;
      cur.inv ||= inv;
    }
  }
  for (const g of groups) {
    const S = IMPORTS;
    const row = g.rows[0]!.row;
    /** The first filled value of a column in this shipment. */
    const first = (key: string) => g.rows.find((r) => r.v[key] !== undefined)?.v[key];
    const firstRow = (key: string) => g.rows.find((r) => r.v[key] !== undefined)?.row ?? row;
    const client = checkClient(S, row, g.client);
    const transportMode =
      first('freight') === undefined ? 'SEA' : freightOf(S, firstRow('freight'), first('freight'));
    const loadType = loadOf(S, firstRow('load'), first('load'), transportMode);

    const [fwdName = '', broker = ''] = text(first('fwBroker'))
      .split(/\s*(?:\n|\/)\s*/)
      .filter(Boolean);
    const forwarderId = forwarderOf(fwdName);

    // ORG / DEST: "CH-SHV" → China, the SHV… port.
    const orgDest = text(first('orgDest'));
    const [org = '', dest = ''] = orgDest.split(/\s*[-–>]+\s*/);
    const origin = org ? findCountry(org) : undefined;
    if (org && !origin)
      err(S, firstRow('orgDest'), `ORG / DEST "${orgDest}": ${org} is not a known country.`);
    let port = first('port') === undefined ? undefined : findPort(first('port'));
    if (first('port') !== undefined && !port)
      err(S, firstRow('port'), `Clearance Port "${text(first('port'))}" is not in the system.`);
    if (!port && first('port') === undefined && dest) {
      const matches = refs.ports.filter(
        (p) => lc(p.code).startsWith(lc(dest)) || lc(p.shortName) === lc(dest),
      );
      port = findPort(dest) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!port)
        err(
          S,
          firstRow('orgDest'),
          `ORG / DEST "${orgDest}": ${dest} is not one port; fill in Clearance Port.`,
        );
    }

    // Cargo invoices (one line per row; a CDC NO draws down the master list) and declarations.
    const invoices: {
      invoiceNo: string;
      invoiceDate?: string;
      packages: string;
      lines: Record<string, unknown>[];
    }[] = [];
    const declarations: {
      declareNo: string;
      declareDate: string;
      portId: string;
      notes: string;
    }[] = [];
    let quantity = 0;
    let lastDecl: (typeof declarations)[number] | undefined;
    const materials = new Set<string>();
    for (const { row: r, v } of g.rows) {
      const no = text(v.inv).toUpperCase();
      let inv = no ? invoices.find((x) => x.invoiceNo === no) : invoices[invoices.length - 1];
      if (!inv) {
        if (!no) {
          err(S, r, 'INV is empty and there is no invoice above it for this shipment.');
          continue;
        }
        const packages = num(S, r, 'QTY PKGS', v.pkgs);
        inv = {
          invoiceNo: no,
          invoiceDate: date(S, r, 'DATE', v.invDate),
          packages: packages ?? '',
          lines: [],
        };
        invoices.push(inv);
        quantity += Number(packages ?? 0);
      }
      const qty = num(S, r, 'QUANTITY', v.qty);
      const price = num(S, r, 'UNIT PRICE', v.price);
      const nw = num(S, r, 'NW.KGS', v.nw);
      inv.lines.push({
        material: text(v.material),
        description: text(v.item),
        cdcNo: text(v.cdcNo).toUpperCase(),
        pcs: qty,
        unit: text(v.unit).toUpperCase(),
        netWeightKg: nw,
        grossWeightKg: num(S, r, 'GW.KGS', v.gw),
        fobUnitPrice: price,
      });
      const mat = text(v.material).replace(/^[IVX]+\.\s*/i, '');
      if (mat) materials.add(mat);

      const dno = text(v.declareNo).toUpperCase().replace(/\s+/g, ' ');
      if (dno) {
        lastDecl = declarations.find((d) => d.declareNo === dno);
        if (!lastDecl) {
          lastDecl = {
            declareNo: dno,
            declareDate: '',
            portId: port?.id ?? '',
            notes: '',
          };
          declarations.push(lastDecl);
        }
      }
      if (lastDecl && !lastDecl.declareDate && v.declareDate !== undefined)
        lastDecl.declareDate = date(S, r, 'DECLARE DATE', v.declareDate) ?? '';

      // The item on the client's CDC master list, by CDC NO.
      const cdc = text(v.cdcNo);
      if (!cdc) continue;
      const key = (s: string) =>
        s
          .toUpperCase()
          .replace(/[\s–—_]+/g, '')
          .replace(/-/g, '');
      const item = client
        ? refs.cdcItems.find((x) => x.clientId === client.id && key(x.declareRef) === key(cdc))
        : undefined;
      if (client && !item) {
        err(S, r, `CDC NO ${cdc} is not on ${client.code}'s CDC master list.`);
        continue;
      }
      if (item && qty === undefined) err(S, r, `CDC NO ${cdc}: QUANTITY is empty.`);
    }
    for (const d of declarations)
      if (!d.declareDate) err(S, row, `DECLARE DATE is empty for ${d.declareNo}.`);

    // MARK: kept as the remark; containers, seal and vessel read from it.
    const marks = [...new Set(g.rows.map((r) => text(r.v.mark)).filter(Boolean))];
    const parsedMarks = marks.map(parseMark);
    const containers = parsedMarks
      .flatMap((p) => p.containers)
      .filter((c, i, all) => all.findIndex((x) => x.containerNo === c.containerNo) === i)
      // Imports keep no seals (the MARK's seal stays in the remark).
      .map((c) => ({ ...c, linerSeal: '', customsSeal: '' }));
    const vessel = parsedMarks.find((p) => p.vesselName);

    const thcNos = text(first('thcNo'))
      .split(/[\s,;/]+/)
      .filter(Boolean);
    const firstInv = invoices[0]?.invoiceNo ?? '';
    const ref = g.hbl || firstInv || `row ${row}`;
    built.push({
      ref,
      sheet: S,
      row,
      clientCode: client?.code ?? text(g.client),
      ...(fwdName && !forwarderId ? { fwd: lc(fwdName) } : {}),
      input: {
        clientId: client?.id ?? '',
        direction: 'IMPORT',
        transportMode: transportMode ?? 'SEA',
        loadType,
        shipperName: text(first('shipper')),
        forwarderId: forwarderId ?? '',
        broker,
        clearancePortId: port?.id ?? '',
        originCountryIso2: origin?.iso2 ?? '',
        quantity: invoices.length ? String(quantity) : '',
        quantityUnit: quantity ? 'PKGS' : '',
        material: [...materials].join(', ').slice(0, 60),
        hblNo: g.hbl,
        vesselName: vessel?.vesselName ?? '',
        voyageNo: vessel?.voyageNo ?? '',
        eta: date(S, firstRow('eta'), 'ETA PORT', first('eta')) ?? '',
        arriveFty: date(S, firstRow('arriveFty'), 'ETA FTY', first('arriveFty')) ?? '',
        thcHblNo: thcNos.join(', '),
        thcHblDate: date(S, firstRow('thcDate'), 'INVOICE DATE', first('thcDate')) ?? '',
        thcHblAmount: num(S, firstRow('thcFee'), 'THC FEE', first('thcFee')) ?? '',
        remark: marks.join('\n').slice(0, 1000),
        containers: containers as never,
        invoices: invoices as never,
        declarations: declarations as never,
      },
    });
  }

  /* ---- Exports: one row per shipment, joined to the other sheets by Ref ---- */
  const seenRefs = new Set<string>();
  for (const { row, v } of ships) {
    const ref = text(v.ref);
    if (!ref) {
      err(EXPORTS, row, 'Ref is empty: give every export a Ref.');
      continue;
    }
    if (seenRefs.has(ref.toLowerCase())) {
      err(EXPORTS, row, `Ref ${ref} is used twice on the Exports sheet.`);
      continue;
    }
    seenRefs.add(ref.toLowerCase());
    const client = checkClient(EXPORTS, row, v.client);
    const transportMode = freightOf(EXPORTS, row, v.freight);
    const loadType = loadOf(EXPORTS, row, v.load, transportMode);
    const clearanceStatus =
      v.clearance === undefined
        ? undefined
        : CLEARANCE_STATUSES.find(
            (s) =>
              lc(CLEARANCE_STATUS_LABEL[s]) === lc(text(v.clearance)) ||
              lc(s) === lc(text(v.clearance)).replace(/\s/g, '_'),
          );
    if (v.clearance !== undefined && !clearanceStatus)
      err(EXPORTS, row, `Clearance Status "${text(v.clearance)}" is not one of the list.`);
    const port = v.port === undefined ? undefined : findPort(v.port);
    if (v.port !== undefined && !port)
      err(EXPORTS, row, `Clearance Port "${text(v.port)}" is not in the system.`);
    const dest = v.destination === undefined ? undefined : findCountry(v.destination);
    if (v.destination !== undefined && !dest)
      err(EXPORTS, row, `Destination Country "${text(v.destination)}" is not a known country.`);
    const coStatus =
      v.coStatus === undefined
        ? undefined
        : CO_STATUSES.find((s) => lc(s) === lc(text(v.coStatus)));
    if (v.coStatus !== undefined && !coStatus)
      err(EXPORTS, row, 'CO Status must be Pending, Draft, Submitted or Approved.');

    // Forwarder / consignee: existing ones by name (or forwarder code); new ones are added.
    const fwdName = text(v.forwarder);
    const forwarderId = forwarderOf(fwdName);
    let consigneeId: string | undefined;
    const cnName = text(v.consignee);
    if (cnName) {
      const c = refs.consignees.find((x) => lc(x.name) === lc(cnName));
      if (c) consigneeId = c.id;
      else if (client && !newConsignees.has(lc(cnName)))
        newConsignees.set(lc(cnName), {
          name: cnName,
          clientId: client.id,
          clientCode: client.code,
        });
    }

    const mine = <T extends Row>(list: T[]) => list.filter((x) => lc(text(x.v.ref)) === lc(ref));
    // Containers
    const containers = mine(conts).map(({ row: r, v: c }) => {
      const size = text(c.size)
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '');
      const ok = (CONTAINER_SIZES as readonly string[]).includes(size);
      if (c.size !== undefined && !ok)
        err(EXP_CONTAINERS, r, `Size "${text(c.size)}" must be 20GP, 40GP, 40HQ or 45HQ.`);
      return {
        containerNo: text(c.containerNo),
        size: ok ? size : null,
        linerSeal: text(c.linerSeal),
        customsSeal: text(c.customsSeal),
      };
    });
    // Cargo invoices: an empty Invoice No. continues the invoice above.
    const invoices: {
      invoiceNo: string;
      invoiceDate?: string;
      lines: Record<string, unknown>[];
    }[] = [];
    for (const { row: r, v: l } of mine(lines)) {
      const no = text(l.invoiceNo).toUpperCase();
      let inv = no ? invoices.find((x) => x.invoiceNo === no) : invoices[invoices.length - 1];
      if (!inv) {
        if (!no) {
          err(
            EXP_INVOICES,
            r,
            'Invoice No. is empty and there is no invoice above it for this Ref.',
          );
          continue;
        }
        inv = {
          invoiceNo: no,
          invoiceDate: date(EXP_INVOICES, r, 'Invoice Date', l.invoiceDate),
          lines: [],
        };
        invoices.push(inv);
      }
      inv.lines.push({
        poNo: text(l.poNo),
        styleNo: text(l.styleNo),
        htsCode: text(l.htsCode),
        pcs: num(EXP_INVOICES, r, 'PCS', l.pcs),
        ctns: num(EXP_INVOICES, r, 'CTNS', l.ctns),
        cbm: num(EXP_INVOICES, r, 'CBM', l.cbm),
        netWeightKg: num(EXP_INVOICES, r, 'N.W KGS', l.netWeightKg),
        grossWeightKg: num(EXP_INVOICES, r, 'G.W KGS', l.grossWeightKg),
        fobUnitPrice: num(EXP_INVOICES, r, 'FOB Price', l.fobUnitPrice),
        description: text(l.description),
      });
    }
    // Declarations
    const declarations = mine(decls).map(({ row: r, v: d }) => {
      const p = d.port === undefined ? port : findPort(d.port);
      if (d.port !== undefined && !p)
        err(EXP_DECLARATIONS, r, `Port "${text(d.port)}" is not in the system.`);
      return {
        declareNo: text(d.declareNo),
        declareDate: date(EXP_DECLARATIONS, r, 'Declare Date', d.declareDate) ?? '',
        portId: p?.id ?? '',
        notes: text(d.notes),
      };
    });

    const input: ShipmentInput = {
      clientId: client?.id ?? '',
      direction: 'EXPORT',
      transportMode: transportMode ?? 'SEA',
      loadType,
      ...(clearanceStatus ? { clearanceStatus } : {}),
      shipperName: text(v.shipper),
      consigneeId: consigneeId ?? '',
      forwarderId: forwarderId ?? '',
      broker: text(v.broker),
      clearancePortId: port?.id ?? '',
      destinationCountryIso2: dest?.iso2 ?? '',
      quantity: num(EXPORTS, row, 'Quantity', v.quantity) ?? '',
      quantityUnit: text(v.unit).toUpperCase(),
      material: text(v.material),
      bookingNo: text(v.booking),
      hblNo: text(v.hbl).toUpperCase(),
      vesselName: text(v.vessel),
      voyageNo: text(v.voyage),
      crd: date(EXPORTS, row, 'CRD', v.crd) ?? '',
      etd: date(EXPORTS, row, 'ETD', v.etd) ?? '',
      atd: date(EXPORTS, row, 'ATD', v.atd) ?? '',
      thcHblNo: text(v.thcNo),
      thcHblDate: date(EXPORTS, row, 'Invoice / THC Date', v.thcDate) ?? '',
      thcHblAmount: num(EXPORTS, row, 'Invoice / THC Amount', v.thcAmount) ?? '',
      coForm: text(v.coForm),
      coNumber: text(v.coNumber),
      coStatus: coStatus ?? '',
      remark: text(v.remark),
      containers: containers as never,
      invoices: invoices as never,
      declarations: declarations as never,
    };
    built.push({
      ref,
      sheet: EXPORTS,
      row,
      input,
      clientCode: client?.code ?? text(v.client),
      ...(fwdName && !forwarderId ? { fwd: lc(fwdName) } : {}),
      ...(cnName && !consigneeId ? { cn: lc(cnName) } : {}),
    });
  }

  // Rows on the other export sheets for a Ref that isn't on the Exports sheet.
  for (const [name, list] of [
    [EXP_CONTAINERS, conts],
    [EXP_INVOICES, lines],
    [EXP_DECLARATIONS, decls],
  ] as const)
    for (const { row, v } of list)
      if (!seenRefs.has(lc(text(v.ref))))
        err(
          name,
          row,
          text(v.ref) ? `Ref ${text(v.ref)} is not on the Exports sheet.` : 'Ref is empty.',
        );

  // Each shipment against the same rules as the Create Shipment form.
  const parsed = built.map((b) => {
    const p = shipmentInputSchema.safeParse(b.input);
    if (!p.success)
      for (const issue of p.error.issues) {
        // The placeholders for a new forwarder/consignee are filled at save time, and a missing
        // client was already reported in plain words above.
        if (['consigneeId', 'forwarderId', 'clientId'].includes(String(issue.path[0]))) continue;
        err(b.sheet, b.row, `${b.ref}: ${issue.path.join(' › ') || 'shipment'}: ${issue.message}`);
      }
    return { ...b, parsed: p.success ? p.data : null };
  });

  // Declare / invoice numbers: not twice in the file, not already in the system.
  const dup = (label: string, values: { no: string; ref: string }[], existing: Set<string>) => {
    const seen = new Map<string, string>();
    for (const { no, ref } of values) {
      const k = no.toUpperCase();
      if (!k) continue;
      if (seen.has(k))
        err('File', null, `${label} ${no} is used twice (${seen.get(k)} and ${ref}).`);
      else seen.set(k, ref);
      if (existing.has(k)) err('File', null, `${label} ${no} (${ref}) is already in the system.`);
    }
  };
  const allDecl = built.flatMap((b) =>
    (b.input.declarations ?? []).flatMap((d) =>
      d.declareNo ? [{ no: d.declareNo, ref: b.ref }] : [],
    ),
  );
  const allInv = built.flatMap((b) =>
    (b.input.invoices ?? []).map((i) => ({ no: i.invoiceNo, ref: b.ref })),
  );
  const existingDecl = new Set(
    (
      await queryRows<{ n: string }>(
        db,
        sql`SELECT upper(declare_no) AS n FROM customs_declarations`,
      )
    ).map((r) => r.n),
  );
  const existingInv = new Set(
    (
      await queryRows<{ n: string }>(
        db,
        sql`SELECT upper(i.invoice_no) AS n FROM cargo_invoices i JOIN shipments s ON s.id = i.shipment_id WHERE s.deleted_at IS NULL`,
      )
    ).map((r) => r.n),
  );
  dup('Declare No.', allDecl, existingDecl);
  dup('Invoice No.', allInv, existingInv);

  const summary = (b: (typeof parsed)[number]): PlanImportResult['shipments'][number] => ({
    ref: b.ref,
    clientCode: b.clientCode,
    direction: b.input.direction,
    transport: `${b.input.transportMode} ${b.input.loadType}`,
    hblNo: b.input.hblNo || null,
    date:
      (b.input.direction === 'EXPORT' ? b.input.etd : b.input.eta) ||
      b.input.etd ||
      b.input.eta ||
      null,
    containers: b.input.containers?.length ?? 0,
    invoices: b.input.invoices?.length ?? 0,
    declarations: b.input.declarations?.length ?? 0,
  });
  const result: PlanImportResult = {
    saved: false,
    shipments: parsed.map(summary),
    errors,
    newForwarders: [...newForwarders.values()],
    newConsignees: [...newConsignees.values()].map(({ name, clientCode }) => ({
      name,
      clientCode,
    })),
  };
  if (!opts.save || errors.length || !parsed.length) return result;

  // Save: all in one transaction.
  try {
    await db.transaction(async (tx) => {
      const fwdIds = new Map<string, string>();
      for (const [key, name] of newForwarders) {
        const base =
          name
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '')
            .slice(0, 12) || 'FWD';
        let code = base;
        for (
          let i = 2;
          (await queryRows(tx, sql`SELECT 1 FROM forwarders WHERE code = ${code}`)).length;
          i++
        )
          code = `${base.slice(0, 10)}${i}`;
        const [f] = await tx.insert(forwarders).values({ code, name }).returning();
        await audit(
          tx,
          {
            action: 'CREATE',
            entity: 'forwarder',
            entityId: f!.id,
            after: f,
            reason: 'Shipping Plan Excel import',
          },
          opts.req,
        );
        fwdIds.set(key, f!.id);
      }
      const cnIds = new Map<string, string>();
      for (const [key, c] of newConsignees) {
        const [row] = await tx
          .insert(consignees)
          .values({ name: c.name, clientId: c.clientId })
          .returning();
        await audit(
          tx,
          {
            action: 'CREATE',
            entity: 'consignee',
            entityId: row!.id,
            after: row,
            reason: 'Shipping Plan Excel import',
          },
          opts.req,
        );
        cnIds.set(key, row!.id);
      }
      for (const [i, b] of parsed.entries()) {
        const input = shipmentInputSchema.parse({
          ...b.input,
          forwarderId: b.fwd ? fwdIds.get(b.fwd) : b.input.forwarderId,
          consigneeId: b.cn ? cnIds.get(b.cn) : b.input.consigneeId,
        });
        const made = await insertShipment(tx, input, opts.actor, opts.req);
        Object.assign(result.shipments[i]!, { reference: made.reference, id: made.id });
      }
    });
  } catch (e) {
    const message = shipmentUniqueMessage(e);
    if (message) return { ...result, errors: [{ sheet: 'File', row: null, message }] };
    if (e instanceof AppError) {
      // Over-importing a CDC item: say which items and by how much.
      const violations = (e.details as { violations?: OverImport[] } | undefined)?.violations;
      const lines = violations?.map(
        (x) =>
          `CDC NO ${x.declareRef} ${x.itemName}: ${x.requested} declared but only ${x.balance} left on the master list.`,
      );
      return {
        ...result,
        errors: (lines?.length ? lines : [e.message]).map((m) => ({
          sheet: 'File',
          row: null,
          message: m,
        })),
      };
    }
    throw e;
  }
  return { ...result, saved: true };
}
type OverImport = { itemName: string; declareRef: string; balance: string; requested: string };

const empty = (errors: PlanImportResult['errors']): PlanImportResult => ({
  saved: false,
  shipments: [],
  errors,
  newForwarders: [],
  newConsignees: [],
});
