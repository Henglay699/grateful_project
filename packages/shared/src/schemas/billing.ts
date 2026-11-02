import { z } from 'zod';
import {
  BILLING_DOC_STATUSES,
  PAYMENT_METHODS,
  STATEMENT_KINDS,
  type BillingDocStatus,
  type Direction,
  type TransportMode,
  type PaymentMethod,
  type StatementKind,
} from '../enums';
import type { BillingDoc } from './accounting';
import { paginationQuerySchema } from './common';
import { decimal, optText } from './fields';

/*
 * Client Billing: a client's month as the Excel pack had it — each shipment's tax invoice,
 * disbursement and debit note, the two account statements, and the official receipts.
 */

const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');

export const billingMonthQuerySchema = z.object({ month });

/** The documents billed per shipment, in print order. */
export const BILLING_PACK_TYPES = ['tax-invoices', 'disbursements', 'debit-notes'] as const;
export type BillingPackType = (typeof BILLING_PACK_TYPES)[number];

/**
 * Drafts for the month's shipments that have no document of a type yet.
 * lines "previous": copy the line items of the client's last issued document of that type
 * (same direction and container size when there is one); "ledger": one line with the
 * amount in the Monthly Ledger.
 */
export const billingDraftsInputSchema = z.object({
  month,
  types: z.array(z.enum(BILLING_PACK_TYPES)).min(1, 'Choose at least one document type'),
  lines: z.enum(['previous', 'ledger']).default('previous'),
});
export type BillingDraftsInput = z.input<typeof billingDraftsInputSchema>;

export const billingIssueInputSchema = z.object({ month });

export interface BillingDraftsResult {
  created: {
    type: BillingPackType;
    id: string;
    number: string | null;
    copiedFrom: string | null;
  }[];
}
export interface BillingIssueResult {
  issued: { type: BillingPackType; id: string; number: string | null }[];
  /** Drafts left as they were, with why (e.g. a $0.00 total). */
  skipped: { type: BillingPackType; id: string; number: string | null; reason: string }[];
}

/* ------------------------------ Official receipts ------------------------------ */

export const receiptInputSchema = z.object({
  clientId: z.string().uuid('Choose a client'),
  /** The statement month this payment is for. */
  month,
  kind: z.enum(STATEMENT_KINDS),
  receiptDate: isoDate,
  // Required (allowEmpty: false), so never null once parsed.
  amount: decimal(2, { min: 0.01, allowEmpty: false }).transform((v) => v as string),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentRef: optText(80),
  note: optText(300),
});
export type ReceiptInput = z.input<typeof receiptInputSchema>;

export const receiptListQuerySchema = paginationQuerySchema.extend({
  clientId: z.string().uuid().optional(),
  /** Month of the receipt date. */
  month: month.optional(),
  status: z.enum(BILLING_DOC_STATUSES).optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
});

export interface OfficialReceipt {
  id: string;
  receiptNo: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  /** Legal name (upper case) as printed after "Received from". */
  receivedFrom: string;
  /** Statement month, YYYY-MM. */
  month: string;
  kind: StatementKind;
  receiptDate: string;
  amount: string;
  paymentMethod: PaymentMethod;
  paymentRef: string | null;
  note: string | null;
  status: BillingDocStatus;
  createdByName: string | null;
  createdAt: string;
}

/* ------------------------------ A client's month ------------------------------ */

export interface BillingDocSlot {
  id: string;
  type: BillingPackType;
  number: string | null;
  date: string;
  status: BillingDocStatus;
  total: string;
}

export interface BillingShipmentRow {
  recordId: string;
  invDate: string;
  declareNo: string;
  shipmentId: string;
  shipmentReference: string;
  direction: Direction;
  /** SEA, AIR or ROAD (Truck). */
  transportMode: TransportMode;
  hbl: string | null;
  containers: string | null;
  /** The shipment's package count and its unit (PKGS, CTNS, ROLLS…). */
  quantity: string | null;
  quantityUnit: string | null;
  /** Live (non-void) documents of each type. */
  docs: Record<BillingPackType, BillingDocSlot[]>;
  /**
   * A number typed in the Monthly Ledger with no issued document behind it: the document
   * was made outside the system (e.g. in Excel). It still counts on the statement.
   */
  manual: Record<BillingPackType, { number: string; total: string } | null>;
}

export interface StatementLine {
  date: string;
  invNo: string | null;
  disNo: string | null;
  dnNo: string | null;
  /** HBL, else the declaration (or, for a debit note without a shipment, its reference). */
  ref: string | null;
  amount: string;
  /** Comes from numbers typed in the Monthly Ledger, not an issued document. */
  manual: boolean;
  /** Its document (or one of them) is still a draft: shown, and printed, marked DRAFT. */
  draft: boolean;
}

export interface BillingStatement {
  kind: StatementKind;
  lines: StatementLine[];
  total: string;
  /** Sum of the issued (non-void) receipts. */
  received: string;
  balance: string;
  receipts: OfficialReceipt[];
  /** Lines whose document is still a draft (the statement prints marked DRAFT). */
  drafts: number;
}

/**
 * Where a client's month stands, earliest open step first: shipments without a tax invoice,
 * drafts to issue, then payment.
 */
export const BILLING_STAGES = [
  'EMPTY',
  'NOT_INVOICED',
  'DRAFTS',
  'AWAITING_PAYMENT',
  'PARTLY_PAID',
  'PAID',
] as const;
export type BillingStage = (typeof BILLING_STAGES)[number];

export interface BillingSummary {
  shipments: number;
  /** Tax invoices, disbursements and debit notes of the month by status. */
  issued: number;
  drafts: number;
  /** Numbers typed in the Monthly Ledger with no document in the system (made in Excel). */
  manual: number;
  /** Shipments with no document of the type (and no number typed in the ledger). */
  missing: Record<BillingPackType, number>;
  billed: string;
  received: string;
  balance: string;
  stage: BillingStage;
}

export interface BillingClient {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  legalNameKm: string | null;
  address: string | null;
  vattin: string | null;
}

export interface BillingClientMonth {
  client: BillingClient;
  month: string;
  rows: BillingShipmentRow[];
  /** Documents of the month tied to no shipment, e.g. a monthly service-fee debit note. */
  others: (BillingDocSlot & { reference: string | null })[];
  statements: Record<StatementKind, BillingStatement>;
  summary: BillingSummary;
}

export interface BillingOverviewRow extends BillingSummary {
  clientId: string;
  clientCode: string;
  clientName: string;
  invoiceTotal: string;
  debitNoteTotal: string;
}

export interface BillingOverview {
  month: string;
  rows: BillingOverviewRow[];
  totals: {
    clients: number;
    shipments: number;
    drafts: number;
    notInvoiced: number;
    billed: string;
    received: string;
    balance: string;
  };
}

/** Everything the print pack needs: the month plus each issued document in full. */
export interface BillingPack extends BillingClientMonth {
  /** Issued documents in print order: per shipment tax invoice, disbursement, then debit notes. */
  docs: BillingDoc[];
}
