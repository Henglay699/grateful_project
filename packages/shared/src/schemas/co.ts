import { z } from 'zod';
import { boolParam, optDate, optText } from './fields';

/*
 * CO: certificates of origin of export shipments, one per commercial invoice (the CO RECORD
 * workbook), and the GSP breakdown of each invoice's cost (the BREAKDOWN workbook).
 */

/** Not started → draft made → submitted to the MoC → approved (it has its CO no.). */
export const CO_STATUSES = ['PENDING', 'DRAFT', 'SUBMIT', 'APPROVE'] as const;
export type CoStatus = (typeof CO_STATUSES)[number];
export const CO_STATUS_LABEL: Record<CoStatus, string> = {
  PENDING: 'Pending',
  DRAFT: 'Draft',
  SUBMIT: 'Submit',
  APPROVE: 'Approve',
};

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/** CO Plans: export invoices dated from the first day of `from` to the last day of `to`. */
export const coListQuerySchema = z
  .object({
    clientId: z.string().uuid().optional(),
    from: monthSchema,
    to: monthSchema,
    status: z.enum(CO_STATUSES).optional(),
    /** Also the invoices of shipments without any CO form or number. */
    all: boolParam.optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'From must not be after To', path: ['to'] });
export type CoListQuery = Omit<z.input<typeof coListQuerySchema>, 'all'> & { all?: boolean };

/** The CO details kept for an invoice; the rest of its row comes from the shipment. */
export const coRecordInputSchema = z.object({
  form: optText(20),
  coNo: optText(60),
  coDate: optDate,
  status: z.enum(CO_STATUSES),
  remark: optText(300),
});
export type CoRecordInput = z.input<typeof coRecordInputSchema>;
export type CoRecordValues = z.output<typeof coRecordInputSchema>;

const share = z.number().min(0).max(1);
const cost = z.number().min(0).max(100000);
const text = (max: number) => z.string().trim().max(max);

/**
 * Breakdown → the sheet's inputs (its "BASE (original)" and "TARGET SETTINGS" columns, and
 * the texts). The quantity and net weight are always the invoice's.
 */
export const coBreakdownSchema = z.object({
  htsCode: text(60),
  date: optDate,
  kinds: text(200),
  poNo: text(200),
  styleNo: text(200),
  fabricName: text(80),
  fabricOrigin: text(60),
  accessoriesOrigin: text(60),
  /** FOB per piece the sheet must come to. */
  targetFob: cost,
  /** Part of the ex-factory price that is imported material (the rest is local content). */
  importShare: share,
  transportCost: cost,
  /** Relative weights the costs are split by, as the workbook's "BASE (original)". */
  base: z.object({
    fabric: cost,
    accessories: cost,
    local: cost,
    overhead: cost,
    profit: cost,
  }),
  accountant: text(80),
  manager: text(80),
});
export type CoBreakdownInput = z.output<typeof coBreakdownSchema>;

/** One export invoice on the CO Plans list. */
export interface CoRow {
  invoiceId: string;
  shipmentId: string;
  reference: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  /** The invoice date's month, "2026-07". */
  month: string;
  form: string | null;
  mode: string;
  country: string | null;
  coNo: string | null;
  /** The shipment's CO numbers (all its invoices'), shown while the row has none of its own. */
  shipmentCoNo: string | null;
  coDate: string | null;
  invoiceNo: string;
  invoiceDate: string | null;
  pcs: number;
  ctns: number;
  amount: number;
  netWeightKg: number;
  atd: string | null;
  etd: string | null;
  status: CoStatus;
  remark: string | null;
  /** False while nothing has been saved for the invoice: form and CO no. are the shipment's. */
  saved: boolean;
  /** A breakdown has been saved for the invoice. */
  hasBreakdown: boolean;
}

/** One invoice with what the breakdown sheet needs. */
export interface CoDetail extends CoRow {
  company: { name: string; address: string; phone: string };
  /** The HTS code(s) on the invoice's lines. */
  htsCode: string | null;
  breakdown: CoBreakdownInput | null;
  /** The client's latest breakdown of another invoice, to start a new one from. */
  template: CoBreakdownInput | null;
}
