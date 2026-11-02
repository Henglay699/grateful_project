import { z } from 'zod';
import {
  CLEARANCE_STATUSES,
  CONTAINER_SIZES,
  DIRECTIONS,
  INCOTERMS,
  LOAD_TYPES,
  SHIPMENT_STATUSES,
  TRANSPORT_MODES,
  type ClearanceStatus,
  type ContainerSize,
  type Incoterm,
  type Direction,
  type LoadType,
  type ShipmentStatus,
  type TransportMode,
} from '../enums';
import { paginationQuerySchema } from './common';
import { decimal, multi, optDate, optText, optUuid } from './fields';

/** ISO 6346 shape: 4 letters + 7 digits. Spaces/dashes are stripped. */
export const containerNo = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .refine(
    (v) => /^[A-Z]{4}\d{7}$/.test(v),
    'Container no. must be 4 letters + 7 digits, e.g. MRKU8974303',
  );

export const containerInputSchema = z.object({
  containerNo,
  size: z
    .enum(CONTAINER_SIZES)
    .nullish()
    .transform((v) => v ?? null),
  linerSeal: optText(40),
  customsSeal: optText(40),
  /** Truck shipments: plate no. of the truck carrying the container. */
  truckNo: optText(40),
});

export const cargoLineInputSchema = z.object({
  poNo: optText(60),
  styleNo: optText(60),
  htsCode: optText(20),
  /** Imports: CDC group (e.g. RAW MATERIAL), item no. on the CDC master list and its unit. */
  material: optText(60),
  cdcNo: optText(20),
  unit: optText(20),
  pcs: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  ctns: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  cbm: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  netWeightKg: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  grossWeightKg: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  fobUnitPrice: decimal(4, { min: 0 }).transform((v) => v ?? '0'),
  description: optText(300),
  /** Imports: required (with cutstock:override) when this item would push the balance below zero. */
  overrideReason: optText(300),
});

/** The distinct, non-empty HTS codes used on an invoice's lines. */
export const invoiceHtsCodes = (lines: { htsCode?: string | null }[]) => [
  ...new Set(lines.map((l) => l.htsCode?.trim().toUpperCase()).filter((c): c is string => !!c)),
];

/** One invoice = one HTS code: lines may not differ, and blank lines take the invoice's code. */
export const cargoInvoiceInputSchema = z
  .object({
    invoiceNo: z.string().trim().toUpperCase().min(1, 'Enter the invoice no.').max(40),
    invoiceDate: optDate,
    description: optText(300),
    /** Imports: packages on the invoice (QTY PKGS). */
    packages: decimal(3, { min: 0 }),
    lines: z.array(cargoLineInputSchema).min(1, 'Add at least one line'),
  })
  .superRefine((inv, ctx) => {
    const codes = invoiceHtsCodes(inv.lines);
    if (codes.length > 1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['htsCode'],
        message: `One invoice uses one HTS code; this one has ${codes.join(', ')}`,
      });
  })
  .transform((inv) => {
    const [code = null] = invoiceHtsCodes(inv.lines);
    return { ...inv, lines: inv.lines.map((l) => ({ ...l, htsCode: code })) };
  });

export const declarationInputSchema = z.object({
  /** Present when editing an existing declaration (keeps its ledger link). */
  id: optUuid,
  /** Empty = pending, which only an air shipment may save (customs numbers it later). */
  declareNo: z
    .string()
    .trim()
    .toUpperCase()
    .max(30)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || v.length >= 2, 'Enter the declaration no.'),
  declareDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the declaration date'),
  portId: optUuid,
  notes: optText(300),
});

/**
 * A declaration row left completely blank: the form always offers one to fill in later.
 * A saved one cleared out counts too, so it is removed (ledger-linked ones are refused on save).
 */
function blankDeclarationRow(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const x = d as Record<string, unknown>;
  const text = (v: unknown) => String(v ?? '').trim();
  return !text(x.declareNo) && !text(x.declareDate) && !text(x.notes);
}
/** A container row with nothing typed in (the form always offers one; its size is preset). */
function blankContainerRow(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  const text = (v: unknown) => String(v ?? '').trim();
  return !text(x.containerNo) && !text(x.linerSeal) && !text(x.customsSeal) && !text(x.truckNo);
}
/** An invoice row nothing was typed into (the form always offers one; its date may be preset). */
function blankInvoiceRow(i: unknown): boolean {
  if (!i || typeof i !== 'object') return false;
  const x = i as Record<string, unknown>;
  const text = (v: unknown) => String(v ?? '').trim();
  const blankLine = (l: unknown) =>
    !!l && typeof l === 'object' && Object.values(l).every((v) => !text(v));
  return (
    !text(x.invoiceNo) &&
    !text(x.description) &&
    !text(x.packages) &&
    (!Array.isArray(x.lines) || x.lines.every(blankLine))
  );
}
const invoiceArray = z.array(cargoInvoiceInputSchema).default([]);
/** Cargo invoices are optional: an untouched row is dropped before validation. */
const invoiceRows = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((i) => !blankInvoiceRow(i)) : v),
  invoiceArray,
) as unknown as typeof invoiceArray;

const containerArray = z.array(containerInputSchema).default([]);
/** Blank rows are dropped before validation, so the ready-made empty row never blocks saving. */
const containerRows = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((c) => !blankContainerRow(c)) : v),
  containerArray,
) as unknown as typeof containerArray;

const declarationArray = z.array(declarationInputSchema).default([]);
/** Blank rows are dropped before validation, so an untouched one never blocks saving. */
const declarationRows = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((d) => !blankDeclarationRow(d)) : v),
  declarationArray,
  // zod 3 types a preprocess input as `unknown`; keep the array's own input type for forms.
) as unknown as typeof declarationArray;

/**
 * A shipment's status, worked out from its data:
 * Completed — an import has its ETA Factory date, an export its ATD;
 * In Progress — not completed, but a customs declaration is recorded;
 * Pending — otherwise.
 */
export function shipmentStatusOf(s: {
  direction: Direction;
  atd?: string | null | undefined;
  arriveFty?: string | null | undefined;
  declarations?: { declareNo?: string | null | undefined }[] | undefined;
}): ShipmentStatus {
  if (s.direction === 'IMPORT' ? s.arriveFty : s.atd) return 'COMPLETED';
  if (s.declarations?.some((d) => d.declareNo?.trim())) return 'IN_PROGRESS';
  return 'PENDING';
}

/**
 * A shipment's clearance status, worked out from its declarations:
 * Customs Cleared — a declaration has both its number and date;
 * In Progress — a declaration number is in, its date not yet;
 * Pending Review — otherwise.
 */
export function clearanceStatusOf(s: {
  declarations?:
    | { declareNo?: string | null | undefined; declareDate?: string | null | undefined }[]
    | undefined;
}): ClearanceStatus {
  const numbered = s.declarations?.filter((d) => d.declareNo?.trim()) ?? [];
  if (numbered.some((d) => d.declareDate?.trim())) return 'CLEARED';
  if (numbered.length) return 'IN_PROGRESS';
  return 'PENDING';
}

export const shipmentInputSchema = z
  .object({
    clientId: z.string().uuid('Choose a client'),
    direction: z.enum(DIRECTIONS),
    transportMode: z.enum(TRANSPORT_MODES),
    loadType: z.enum(LOAD_TYPES),
    incoterm: z
      .enum(INCOTERMS)
      .or(z.literal(''))
      .nullish()
      .transform((v) => v || null),
    clearanceStatus: z.enum(CLEARANCE_STATUSES).default('PENDING'),
    shipperName: optText(200),
    consigneeId: optUuid,
    forwarderId: optUuid,
    broker: optText(120),
    clearancePortId: optUuid,
    originCountryIso2: optText(2),
    destinationCountryIso2: optText(2),
    etdPort: optText(120),
    quantity: decimal(3, { min: 0 }),
    quantityUnit: optText(20),
    material: optText(60),
    bookingNo: optText(60),
    hblNo: optText(60),
    vesselName: optText(80),
    voyageNo: optText(30),
    crd: optDate,
    etd: optDate,
    atd: optDate,
    eta: optDate,
    ata: optDate,
    arriveFty: optDate,
    receivedDocumentDate: optDate,
    doDate: optDate,
    flightNo: optText(40),
    checkInDate: optDate,
    cutOffDate: optDate,
    thcHblNo: optText(60),
    thcHblDate: optDate,
    thcHblAmount: decimal(2, { min: 0 }),
    coForm: optText(30),
    coNumber: optText(60),
    coStatus: optText(30),
    remark: optText(1000),
    containers: containerRows,
    invoices: invoiceRows,
    declarations: declarationRows,
  })
  .superRefine((s, ctx) => {
    if (s.transportMode === 'AIR' && s.loadType !== 'NONE')
      ctx.addIssue({
        code: 'custom',
        path: ['loadType'],
        message: 'Air freight has no CY/CY or LCL load type',
      });
    if (s.loadType !== 'FCL' && s.containers.length)
      ctx.addIssue({
        code: 'custom',
        path: ['containers'],
        message: 'Containers are only recorded for CY/CY (FCL) shipments',
      });
    if (s.etd && s.eta && s.etd > s.eta)
      ctx.addIssue({ code: 'custom', path: ['eta'], message: 'ETA cannot be before ETD' });
    if (s.eta && s.arriveFty && s.arriveFty < s.eta)
      ctx.addIssue({
        code: 'custom',
        path: ['arriveFty'],
        message: 'Arrive FTY cannot be before ETA',
      });
    const dup = <T>(items: T[], key: (t: T) => string, path: string, label: string) => {
      const seen = new Set<string>();
      items.forEach((it, i) => {
        const k = key(it);
        if (seen.has(k))
          ctx.addIssue({ code: 'custom', path: [path, i], message: `${label} ${k} appears twice` });
        seen.add(k);
      });
    };
    dup(s.containers, (c) => c.containerNo, 'containers', 'Container');
    dup(s.invoices, (i) => i.invoiceNo, 'invoices', 'Invoice');
    s.declarations.forEach((d, i) => {
      if (!d.declareNo && s.transportMode !== 'AIR')
        ctx.addIssue({
          code: 'custom',
          path: ['declarations', i, 'declareNo'],
          message: 'Enter the declaration no.',
        });
    });
    dup(
      s.declarations.filter((d) => d.declareNo),
      (d) => d.declareNo!,
      'declarations',
      'Declaration',
    );
  })
  // The statuses are never entered: they follow from the dates and declarations.
  .transform((s) => ({ ...s, status: shipmentStatusOf(s), clearanceStatus: clearanceStatusOf(s) }));
export type ShipmentInput = z.input<typeof shipmentInputSchema>;
export type ShipmentInputParsed = z.output<typeof shipmentInputSchema>;

export const SHIPMENT_SORT_FIELDS = [
  'eta',
  'reference',
  'status',
  'client',
  'createdAt',
  'arriveFty',
] as const;

export const shipmentListQuerySchema = paginationQuerySchema.extend({
  clientId: multi(z.string().uuid()),
  direction: z.enum(DIRECTIONS).optional(),
  status: multi(z.enum(SHIPMENT_STATUSES)),
  /** Workflow stage keys (any direction's), or OPEN for every stage but Closed. */
  stage: multi(z.string().regex(/^[A-Z_]{2,40}$/)),
  transportMode: z.enum(TRANSPORT_MODES).optional(),
  loadType: z.enum(LOAD_TYPES).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Declaration month (YYYY-MM): the shipment's first declare date falls in it. */
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
    .optional(),
});
export type ShipmentListQuery = z.input<typeof shipmentListQuerySchema>;

/** One row of the Shipping Plans table (all "Expand All" columns included). */
export interface ShipmentListItem {
  id: string;
  reference: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  direction: Direction;
  transportMode: TransportMode;
  loadType: LoadType;
  status: ShipmentStatus;
  clearanceStatus: ClearanceStatus;
  /** Job workflow stage key (see workflow.ts). */
  workflowStage: string;
  invoiceNos: string[];
  invoiceDate: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  eta: string | null;
  ata: string | null;
  etd: string | null;
  atd: string | null;
  crd: string | null;
  arriveFty: string | null;
  forwarderName: string | null;
  clearancePortName: string | null;
  /** The port's short name (Settings → Ports, e.g. SHV, KTI): what the list shows. */
  clearancePortShortName: string | null;
  etdPort: string | null;
  hblNo: string | null;
  bookingNo: string | null;
  containers: {
    containerNo: string;
    size: ContainerSize | null;
    linerSeal: string | null;
    customsSeal: string | null;
  }[];
  consigneeName: string | null;
  countryName: string | null;
  vesselName: string | null;
  voyageNo: string | null;
  coForm: string | null;
  coNumber: string | null;
  coStatus: string | null;
  thcHblNo: string | null;
  thcHblDate: string | null;
  thcHblAmount: string | null;
  /** declareNo null = pending (an air shipment's, before customs numbers it). */
  declarations: { declareNo: string | null; declareDate: string }[];
  totals: {
    pcs: string;
    ctns: string;
    cbm: string;
    netWeightKg: string;
    grossWeightKg: string;
    fob: string;
  };
  firstLine: {
    poNo: string | null;
    styleNo: string | null;
    htsCode: string | null;
    fobUnitPrice: string | null;
    description: string | null;
  } | null;
  remark: string | null;
}

export interface ShipmentDetail {
  id: string;
  reference: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  direction: Direction;
  transportMode: TransportMode;
  loadType: LoadType;
  status: ShipmentStatus;
  clearanceStatus: ClearanceStatus;
  workflowStage: string;
  shipperName: string | null;
  consigneeId: string | null;
  forwarderId: string | null;
  broker: string | null;
  clearancePortId: string | null;
  originCountryIso2: string | null;
  destinationCountryIso2: string | null;
  etdPort: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  material: string | null;
  incoterm: Incoterm | null;
  bookingNo: string | null;
  hblNo: string | null;
  vesselName: string | null;
  voyageNo: string | null;
  crd: string | null;
  etd: string | null;
  atd: string | null;
  eta: string | null;
  ata: string | null;
  arriveFty: string | null;
  receivedDocumentDate: string | null;
  doDate: string | null;
  flightNo: string | null;
  checkInDate: string | null;
  cutOffDate: string | null;
  thcHblNo: string | null;
  thcHblDate: string | null;
  thcHblAmount: string | null;
  coForm: string | null;
  coNumber: string | null;
  coStatus: string | null;
  remark: string | null;
  containers: {
    id: string;
    containerNo: string;
    size: ContainerSize | null;
    linerSeal: string | null;
    customsSeal: string | null;
    truckNo: string | null;
  }[];
  invoices: {
    id: string;
    invoiceNo: string;
    invoiceDate: string | null;
    description: string | null;
    packages: string | null;
    lines: {
      id: string;
      poNo: string | null;
      styleNo: string | null;
      htsCode: string | null;
      material: string | null;
      cdcNo: string | null;
      unit: string | null;
      pcs: string;
      ctns: string;
      cbm: string;
      netWeightKg: string;
      grossWeightKg: string;
      fobUnitPrice: string;
      fobAmount: string;
      description: string | null;
      /** Imports: the master-list item this line draws down, and any approved overdraw. */
      cutStockItemId: string | null;
      overrideReason: string | null;
    }[];
  }[];
  declarations: {
    id: string;
    /** Null = pending (an air shipment's, before customs numbers it). */
    declareNo: string | null;
    declareDate: string;
    portId: string | null;
    notes: string | null;
    hasLedgerEntry: boolean;
  }[];
  createdAt: string;
  updatedAt: string;
}

/** Result of parsing an Export Template workbook into cargo invoices. */
export interface CargoExcelParseResult {
  invoices: {
    invoiceNo: string;
    invoiceDate: string | null;
    description: string | null;
    lines: {
      poNo: string | null;
      styleNo: string | null;
      htsCode: string | null;
      pcs: string;
      ctns: string;
      cbm: string;
      netWeightKg: string;
      grossWeightKg: string;
      fobUnitPrice: string;
      description: string | null;
    }[];
  }[];
  warnings: { row: number | null; message: string }[];
  rowsRead: number;
}

/** Result of parsing an import cargo workbook (import schedule layout) into invoices. */
export interface ImportCargoExcelParseResult {
  invoices: {
    invoiceNo: string;
    invoiceDate: string | null;
    lines: {
      /** CDC no., material and unit come from the client's CDC master list (found by ITEM). */
      cdcNo: string | null;
      description: string | null;
      material: string | null;
      unit: string | null;
      pcs: string;
      netWeightKg: string;
      grossWeightKg: string;
      fobUnitPrice: string;
    }[];
  }[];
  warnings: { row: number | null; message: string }[];
  /** Rows that do not match the CDC master list (or the template). With any, `invoices` is empty. */
  errors: { row: number | null; message: string }[];
  rowsRead: number;
}

/** Details of a CDC line that would over-import (422 BUSINESS_RULE, rule CUT_STOCK_OVER_IMPORT). */
export interface OverImportViolation {
  cutStockItemId: string;
  itemName: string;
  declareRef: string;
  balance: string;
  requested: string;
}

/**
 * Shipping Plan → Import from Excel: what an uploaded template would create (a check run) or
 * did create. Problems are listed per sheet and row; nothing is saved while there are any.
 */
export interface PlanImportResult {
  /** True when the file was saved (not a check run). */
  saved: boolean;
  shipments: {
    ref: string;
    clientCode: string;
    direction: Direction;
    transport: string;
    hblNo: string | null;
    date: string | null;
    containers: number;
    invoices: number;
    declarations: number;
    /** The new shipment reference, once saved (SHP-26-0001). */
    reference?: string;
    id?: string;
  }[];
  errors: { sheet: string; row: number | null; message: string }[];
  /** Forwarders and consignees not in the system yet; created with the shipments. */
  newForwarders: string[];
  newConsignees: { name: string; clientCode: string }[];
}
