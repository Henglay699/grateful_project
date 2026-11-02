import { z } from 'zod';
import {
  BILLING_DOC_STATUSES,
  CHEA_STATUSES,
  CONTAINER_SIZES,
  CREDIT_NOTE_REF_TYPES,
  CREDIT_NOTE_REVIEW_STATUSES,
  DIRECTIONS,
  LOAD_TYPES,
  TRANSPORT_MODES,
  type BillingDocStatus,
  type CheaPaymentStatus,
  type CreditNoteReviewStatus,
  type Direction,
  type TransportMode,
} from '../enums';
import { paginationQuerySchema } from './common';
import { decimal, optDate, optText, optUuid } from './fields';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
const money = (allowEmpty = true) => decimal(2, { min: 0, allowEmpty }).transform((v) => v ?? '0');

/* ------------------------------ Monthly ledger ------------------------------ */

/**
 * A ledger row (Chea payment / Monthly Ledger). VAT, net profit and — unless given —
 * commission, invoice date and exchange rate are computed by the server.
 */
export const ledgerInputSchema = z.object({
  declarationId: z.string().uuid('Choose a customs declaration'),
  invNo: optText(30),
  disNo: optText(30),
  dnNo: optText(30),
  /** Leave empty: next business day after the declaration date. */
  invDate: optDate,
  /** Leave empty: the USD→KHR rate in force on the invoice date. */
  exchangeRate: decimal(4, { min: 1 }),
  clearFee: money(),
  thc: money(),
  otherPay: money(),
  /** Leave empty: the client's commission setting (JR $0, others $50). */
  commission: decimal(2, { min: 0 }),
  invRevenue: money(),
  disTotal: money(),
  dnTotal: money(),
  cheaStatus: z.enum(CHEA_STATUSES).default('UNPAID'),
  mark: optText(200),
});
export type LedgerEntryInput = z.input<typeof ledgerInputSchema>;
export const ledgerUpdateSchema = ledgerInputSchema.omit({ declarationId: true }).partial();

export const ledgerListQuerySchema = paginationQuerySchema.extend({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
    .optional(),
  /** Whole calendar year (Jan–Dec); used when no month is given. */
  year: z
    .string()
    .regex(/^\d{4}$/, 'Use YYYY')
    .optional(),
  clientId: z.string().uuid().optional(),
  cheaStatus: z.enum(CHEA_STATUSES).optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
});

export interface LedgerRow {
  id: string;
  declarationId: string;
  declareNo: string;
  declareDate: string;
  shipmentId: string;
  shipmentReference: string;
  direction: 'IMPORT' | 'EXPORT';
  clientId: string;
  clientCode: string;
  clientName: string;
  portCode: string | null;
  portNo: string | null;
  portName: string | null;
  invNo: string | null;
  disNo: string | null;
  dnNo: string | null;
  invDate: string;
  exchangeRate: string;
  /** The VAT percent in force on the invoice date, kept with the row (e.g. "10.00"). */
  vatRate: string;
  clearFee: string;
  thc: string;
  otherPay: string;
  commission: string;
  invRevenue: string;
  disTotal: string;
  vat: string;
  dnTotal: string;
  netProfit: string;
  cheaStatus: CheaPaymentStatus;
  mark: string | null;
  documents: {
    type: BillingDocType;
    id: string;
    number: string | null;
    status: BillingDocStatus;
  }[];
}

export interface LedgerSummary {
  rows: number;
  clearFee: string;
  thc: string;
  otherPay: string;
  commission: string;
  invRevenue: string;
  disTotal: string;
  vat: string;
  dnTotal: string;
  netProfit: string;
  unpaid: number;
}

/* ------------------------ Clear fee payments (to Chea) ------------------------ */

/**
 * One payment to the customs broker against a month's clear fees. A month is often paid in
 * two or three parts, each with its own date and remark ("Paid for next month").
 */
export const clearFeePaymentInputSchema = z.object({
  /** The ledger month the payment is for. */
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
  paidOn: isoDate,
  amount: decimal(2, { min: 0.01, allowEmpty: false }),
  remark: optText(200),
});
export type ClearFeePaymentInput = z.input<typeof clearFeePaymentInputSchema>;
export const clearFeePaymentUpdateSchema = clearFeePaymentInputSchema
  .omit({ month: true })
  .partial();
export const clearFeePaymentsQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
});

export interface ClearFeePayment {
  id: string;
  paidOn: string;
  amount: string;
  remark: string | null;
  createdByName: string | null;
}

/**
 * A month's clear fee against what has been paid, plus credit overpaid in earlier months;
 * balance < 0 means overpaid (carried into the next month).
 */
export interface ClearFeePaymentMonth {
  month: string;
  clearFee: string;
  paid: string;
  carriedIn: string;
  balance: string;
  payments: ClearFeePayment[];
}

/** INV (GS26-394), DIS (DIS437) or DN (JR2610001): a shipment's three numbers. */
export type InvoiceNumberKind = 'INV' | 'DIS' | 'DN';
/** A shipment given its numbers (on approval, or a released number passed on to it). */
export interface NumberedShipment {
  recordId: string;
  declareNo: string;
  numbers: { kind: InvoiceNumberKind; number: string; reused: boolean }[];
}
/** The result of deleting a shipment's invoice set. */
export interface ReleasedInvoiceSet {
  declareNo: string;
  /** `kept`: held for the next shipment (false when it was the latest of its run). */
  released: { kind: InvoiceNumberKind; number: string; kept: boolean }[];
  /** Approved shipments that were waiting and took numbers straight away. */
  reassigned: NumberedShipment[];
}

/** A shipment ready for a tax invoice, DIS or debit note (numbered, none made yet). */
export interface EligibleRecord {
  recordId: string;
  declareNo: string;
  declareDate: string;
  invDate: string;
  clientId: string;
  clientCode: string;
  /** The number the document will take (record summaries: the invoice no., null until approved). */
  number: string | null;
  direction: 'IMPORT' | 'EXPORT';
  hbl: string | null;
}

/**
 * A declaration on a shipping plan a record summary can start from, with or without a
 * Monthly Ledger row yet (the summary links to the row once it exists).
 */
export interface RecordSummaryShipment {
  /** Null until the shipment is in the Monthly Ledger. */
  recordId: string | null;
  declarationId: string;
  declareNo: string;
  declareDate: string;
  clientId: string;
  clientCode: string;
  /** The invoice no., null until approved. */
  number: string | null;
  direction: 'IMPORT' | 'EXPORT';
  hbl: string | null;
}

export interface DeclarationOption {
  id: string;
  declareNo: string;
  declareDate: string;
  shipmentReference: string;
  clientId: string;
  clientCode: string;
  direction: 'IMPORT' | 'EXPORT';
}

/** A declaration in the "New Credit Noted" picker, with the shipment details the form copies. */
export interface CreditNoteDeclaration extends DeclarationOption {
  clientName: string;
  transportMode: 'SEA' | 'AIR' | 'ROAD' | 'RAIL';
  loadType: 'FCL' | 'LCL' | 'NONE';
  portName: string | null;
  hblNo: string | null;
  /** First container number, how many there are, and the first one's size (e.g. "40HC"). */
  containerNo: string | null;
  containerCount: number;
  containerSize: string | null;
  grossWeightKg: string;
  cbm: string;
  /** Live (non-void) credit note already made for this declare no. */
  creditNoteNo: string | null;
}

/* ------------------------------ Billing documents ------------------------------ */

export const BILLING_DOC_TYPES = [
  'tax-invoices',
  'disbursements',
  'debit-notes',
  'credit-notes',
  'record-summaries',
] as const;
export type BillingDocType = (typeof BILLING_DOC_TYPES)[number];

export const BILLING_DOC_LABEL: Record<BillingDocType, string> = {
  'tax-invoices': 'Tax Invoice',
  disbursements: 'Disbursement',
  'debit-notes': 'Debit Note',
  'credit-notes': 'Credit Noted',
  'record-summaries': 'Record Summary',
};

export const billingLineInputSchema = z.object({
  description: z.string().trim().min(1, 'Enter a description').max(300),
  qty: decimal(3, { min: 0, allowEmpty: false }),
  unit: optText(20),
  unitPrice: decimal(4, { min: 0, allowEmpty: false }),
  mark: optText(100),
});
export type BillingLineInput = z.input<typeof billingLineInputSchema>;

const docBase = {
  accountingRecordId: optUuid,
  clientId: z.string().uuid('Choose a client'),
  lines: z.array(billingLineInputSchema).min(1, 'Add at least one line'),
};
/** A container size from the list, or none (a blank choice clears it). */
const containerSize = z
  .enum(CONTAINER_SIZES)
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

const shipmentFields = {
  pol: optText(80),
  pod: optText(80),
  containerNo: optText(120),
  containerSize,
  volumeCbm: decimal(3, { min: 0 }),
  grossWeightKg: decimal(3, { min: 0 }),
  shipper: optText(200),
  consignee: optText(200),
  hbl: optText(60),
  /** Quantity (the printed PKGS) and its unit, e.g. 629 + CTNS. */
  pkgs: optText(60),
  pkgsUnit: optText(30),
};
const customer = {
  customerNameEn: z.string().trim().min(2, 'Enter the customer name').max(200),
  customerNameKm: optText(200),
  customerAddress: optText(400),
  customerVattin: optText(40),
};

export const taxInvoiceInputSchema = z.object({
  ...docBase,
  ...customer,
  ...shipmentFields,
  invoiceNo: optText(30),
  invoiceDate: isoDate,
  exchangeRate: decimal(4, { min: 1, allowEmpty: false }),
});

export const disbursementInputSchema = z.object({
  ...docBase,
  ...customer,
  ...shipmentFields,
  disNo: optText(30),
  disDate: isoDate,
  exchangeRate: decimal(4, { min: 1, allowEmpty: false }),
  reference: optText(120),
});

export const debitNoteInputSchema = z.object({
  ...docBase,
  ...shipmentFields,
  dnNo: optText(30),
  dnDate: isoDate,
  billTo: z.string().trim().min(2, 'Enter who is billed').max(200),
  address: optText(400),
  reference: optText(120),
});

export const creditNoteInputSchema = z.object({
  ...docBase,
  cnNo: optText(30),
  cnDate: isoDate,
  billTo: z.string().trim().min(2, 'Enter who is billed').max(200),
  address: optText(400),
  shipper: optText(200),
  portId: optUuid,
  containerNo: optText(120),
  refType: z
    .enum(CREDIT_NOTE_REF_TYPES)
    .nullish()
    .transform((v) => v ?? null),
  refNo: optText(60),
  quantityText: optText(60),
  grossWeightKg: decimal(3, { min: 0 }),
  cbm: decimal(3, { min: 0 }),
  declareNo: optText(30),
});

export const recordSummaryInputSchema = z.object({
  ...docBase,
  direction: z.enum(DIRECTIONS),
  transportMode: z.enum(TRANSPORT_MODES),
  loadType: z.enum(LOAD_TYPES),
  invNo: optText(30),
  disNo: optText(30),
  dnNo: optText(30),
  forwarderId: optUuid,
  portId: optUuid,
  declareNo: optText(30),
  summaryDate: isoDate,
  quantityText: optText(60),
  blNo: optText(60),
  containerNo: optText(120),
  containerSize,
  grossWeightKg: decimal(3, { min: 0 }),
  cbm: optText(30),
});

export const BILLING_DOC_SCHEMAS = {
  'tax-invoices': taxInvoiceInputSchema,
  disbursements: disbursementInputSchema,
  'debit-notes': debitNoteInputSchema,
  'credit-notes': creditNoteInputSchema,
  'record-summaries': recordSummaryInputSchema,
} as const;
export type BillingDocInput<T extends BillingDocType> = z.input<(typeof BILLING_DOC_SCHEMAS)[T]>;

export const billingDocListQuerySchema = paginationQuerySchema.extend({
  clientId: z.string().uuid().optional(),
  status: z.enum(BILLING_DOC_STATUSES).optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  /** Record Summary's filters (like Credit Noted's): a year, a month of any year, a shipment. */
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  monthOfYear: z.coerce.number().int().min(1).max(12).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  /** Record summaries only: accounting's check, so Draft and Revised (both DRAFT) filter apart. */
  review: z.enum(CREDIT_NOTE_REVIEW_STATUSES).optional(),
});

/** Accounting → Credit Noted: submitted credit notes waiting for (or past) accounting's check. */
export const creditNoteReviewQuerySchema = paginationQuerySchema.extend({
  clientId: z.string().uuid().optional(),
  direction: z.enum(DIRECTIONS).optional(),
  q: z.string().trim().max(100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  review: z.enum(CREDIT_NOTE_REVIEW_STATUSES).optional(),
});
/** Sidebar → Credit Noted: every credit note, by document status. */
export const creditNoteListQuerySchema = creditNoteReviewQuerySchema.omit({ review: true }).extend({
  status: z.enum(BILLING_DOC_STATUSES).optional(),
});
/**
 * Accounting's check. "Revised" sends the note back to the broker to fix, so it needs a
 * message saying what to change; "Checked" can carry an optional note.
 */
export const creditNoteReviewInputSchema = z
  .object({
    // Request Revise is the maker's (by resubmitting), never accounting's decision.
    reviewStatus: z.enum(CREDIT_NOTE_REVIEW_STATUSES).exclude(['REVISION_REQUESTED']),
    message: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.reviewStatus !== 'REVISED' || (v.message ?? '').length >= 3, {
    message: 'Tell the broker what to change',
    path: ['message'],
  });

/** A message from accounting in the broker's Credit Noted inbox. */
export interface CreditNoteMessage {
  id: string;
  creditNoteId: string;
  number: string;
  declareNo: string | null;
  clientName: string;
  /** CHECKED, or REVISED (returned to the broker to fix). */
  kind: CreditNoteReviewStatus;
  body: string;
  senderName: string | null;
  createdAt: string;
  /** When I accepted (read) it; null = new. */
  readAt: string | null;
  // The credit note's details, for the inbox table.
  clientCode: string;
  date: string;
  status: BillingDocStatus;
  direction: Direction | null;
  transportMode: TransportMode | null;
  quantityText: string | null;
  port: string | null;
  total: string;
}
/** A message from accounting in Operations' Record Summary inbox. */
export interface RecordSummaryMessage {
  id: string;
  recordSummaryId: string;
  invNo: string | null;
  declareNo: string | null;
  clientName: string;
  /** CHECKED (shown as "Approved"), or REVISED (returned to Operations to fix). */
  kind: CreditNoteReviewStatus;
  body: string;
  senderName: string | null;
  createdAt: string;
  /** When I accepted (read) it; null = new. */
  readAt: string | null;
  // The summary's details, for the inbox table.
  date: string;
  status: BillingDocStatus;
  direction: Direction;
  transportMode: TransportMode;
  quantityText: string | null;
  port: string | null;
  total: string;
}

export interface CreditNoteReviewRow {
  id: string;
  number: string;
  date: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  direction: Direction | null;
  transportMode: TransportMode | null;
  declareNo: string | null;
  quantityText: string | null;
  port: string | null;
  total: string;
  status: BillingDocStatus;
  reviewStatus: CreditNoteReviewStatus;
}
/** A row of Accounting → Expense to Clients (submitted record summaries to check). */
export interface RecordSummaryReviewRow {
  id: string;
  date: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  direction: Direction;
  transportMode: TransportMode;
  declareNo: string | null;
  invNo: string | null;
  quantityText: string | null;
  port: string | null;
  total: string;
  status: BillingDocStatus;
  reviewStatus: CreditNoteReviewStatus;
}

export interface CreditNoteReviewCounts {
  total: number;
  checked: number;
  unchecked: number;
  /** Opened by accounting, not decided yet. */
  reviewed: number;
  revised: number;
  /** Revised by its maker after submitting and resubmitted, waiting for approval. */
  revisionRequested: number;
}

/** Header + lines as stored. Field names follow the document type's input schema. */
export interface BillingDoc {
  id: string;
  type: BillingDocType;
  number: string | null;
  date: string;
  status: BillingDocStatus;
  clientId: string;
  clientCode: string;
  clientName: string;
  accountingRecordId: string | null;
  declareNo: string | null;
  header: Record<string, string | null>;
  lines: {
    id: string;
    lineNo: number;
    description: string;
    qty: string;
    unit: string | null;
    unitPrice: string;
    subtotal: string;
    vat?: string;
    amount?: string;
    mark: string | null;
  }[];
  totals: {
    subtotal: string;
    vat: string;
    total: string;
    subtotalKhr?: string;
    vatKhr?: string;
    totalKhr?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BillingDocListItem {
  id: string;
  number: string | null;
  date: string;
  status: BillingDocStatus;
  clientCode: string;
  clientName: string;
  billTo: string | null;
  declareNo: string | null;
  total: string;
  /** Record summaries only. */
  direction?: 'IMPORT' | 'EXPORT';
  transportMode?: string;
  quantityText?: string | null;
  port?: string | null;
  /** Record summaries: accounting's check (Expense to Clients). */
  reviewStatus?: CreditNoteReviewStatus;
  invNo?: string | null;
  disNo?: string | null;
  dnNo?: string | null;
}
