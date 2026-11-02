import {
  pgTable,
  text,
  uuid,
  date,
  integer,
  index,
  check,
  uniqueIndex,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  id,
  timestamps,
  money,
  rate,
  qty,
  khr,
  vatRate,
  cheaStatusEnum,
  billingDocStatusEnum,
  directionEnum,
  transportModeEnum,
  loadTypeEnum,
  containerSizeEnum,
  creditNoteRefTypeEnum,
  creditNoteReviewEnum,
  statementKindEnum,
  paymentMethodEnum,
} from './_common';
import { users } from './auth';
import { clients, ports, forwarders } from './reference';
import { customsDeclarations } from './shipments';

/**
 * Monthly ledger / Chea payment row: one per customs declaration. All computed
 * columns (vat, commission, net_profit, inv_date) are written by the API using
 * @gs/shared `computeLedger` / `nextBusinessDay`, never by the browser.
 */
export const accountingRecords = pgTable(
  'accounting_records',
  {
    id: id(),
    declarationId: uuid('declaration_id')
      .notNull()
      .unique()
      .references(() => customsDeclarations.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
    invNo: text('inv_no'),
    disNo: text('dis_no'),
    dnNo: text('dn_no'),
    invDate: date('inv_date').notNull(),
    exchangeRate: rate('exchange_rate').notNull(),
    /** VAT percent on INV revenue: the rate in force on inv_date. */
    vatRate: vatRate(),
    clearFee: money('clear_fee').notNull().default('0'),
    thc: money('thc').notNull().default('0'),
    otherPay: money('other_pay').notNull().default('0'),
    commission: money('commission').notNull().default('0'),
    invRevenue: money('inv_revenue').notNull().default('0'),
    disTotal: money('dis_total').notNull().default('0'),
    vat: money('vat').notNull().default('0'),
    dnTotal: money('dn_total').notNull().default('0'),
    netProfit: money('net_profit').notNull().default('0'),
    cheaStatus: cheaStatusEnum('chea_status').notNull().default('UNPAID'),
    mark: text('mark'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('accounting_records_client_date_idx').on(t.clientId, t.invDate),
    index('accounting_records_inv_date_idx').on(t.invDate),
    uniqueIndex('accounting_records_inv_no_unique')
      .on(t.invNo)
      .where(sql`${t.invNo} IS NOT NULL`),
    uniqueIndex('accounting_records_dn_no_unique')
      .on(t.dnNo)
      .where(sql`${t.dnNo} IS NOT NULL`),
    // DIS restarts at DIS001 each January, so it is unique within its year.
    uniqueIndex('accounting_records_dis_no_year_unique')
      .on(t.disNo, sql`(extract(year from ${t.invDate}))`)
      .where(sql`${t.disNo} IS NOT NULL`),
  ],
);

/**
 * INV / DIS / DN numbers given back when an issued invoice set is deleted. The next shipment
 * to be numbered in the same period takes the lowest one before any new number, so the
 * sequence has no gaps. A number above the highest one still in use is not kept: the running
 * number simply comes back to it.
 */
export const releasedNumbers = pgTable(
  'released_numbers',
  {
    id: id(),
    /** INV, DIS or DN. */
    kind: text('kind').notNull(),
    /** '2026' for INV and DIS, 'JR:2610' for a debit note (client + YYMM). */
    period: text('period').notNull(),
    seq: integer('seq').notNull(),
    number: text('number').notNull(),
    fromDeclareNo: text('from_declare_no'),
    releasedById: uuid('released_by_id').references(() => users.id, { onDelete: 'set null' }),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
    reassignedToDeclareNo: text('reassigned_to_declare_no'),
    reassignedAt: timestamp('reassigned_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('released_numbers_free_unique')
      .on(t.kind, t.period, t.seq)
      .where(sql`${t.reassignedAt} IS NULL`),
  ],
);

/* Shared columns for billing document line items. */
const lineColumns = () => ({
  id: id(),
  lineNo: integer('line_no').notNull(),
  description: text('description').notNull(),
  qty: qty('qty').notNull().default('1'),
  unit: text('unit'),
  unitPrice: rate('unit_price').notNull().default('0'),
  subtotal: money('subtotal').notNull().default('0'),
  mark: text('mark'),
});

const docHeader = () => ({
  id: id(),
  accountingRecordId: uuid('accounting_record_id').references(() => accountingRecords.id, {
    onDelete: 'set null',
  }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'restrict' }),
  status: billingDocStatusEnum('status').notNull().default('DRAFT'),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** Bilingual Khmer/English tax invoice, VAT at the rate in force on its date (10% by default). */
export const taxInvoices = pgTable('tax_invoices', {
  ...docHeader(),
  invoiceNo: text('invoice_no').notNull().unique(),
  invoiceDate: date('invoice_date').notNull(),
  exchangeRate: rate('exchange_rate').notNull(),
  vatRate: vatRate(),
  customerNameEn: text('customer_name_en').notNull(),
  customerNameKm: text('customer_name_km'),
  customerAddress: text('customer_address'),
  customerVattin: text('customer_vattin'),
  pol: text('pol'),
  pod: text('pod'),
  containerNo: text('container_no'),
  containerSize: containerSizeEnum('container_size'),
  volumeCbm: qty('volume_cbm'),
  grossWeightKg: qty('gross_weight_kg'),
  shipper: text('shipper'),
  consignee: text('consignee'),
  hbl: text('hbl'),
  pkgs: text('pkgs'),
  pkgsUnit: text('pkgs_unit'),
  subtotal: money('subtotal').notNull().default('0'),
  vat: money('vat').notNull().default('0'),
  total: money('total').notNull().default('0'),
  subtotalKhr: khr('subtotal_khr').notNull().default('0'),
  vatKhr: khr('vat_khr').notNull().default('0'),
  totalKhr: khr('total_khr').notNull().default('0'),
});

export const taxInvoiceLines = pgTable(
  'tax_invoice_lines',
  {
    ...lineColumns(),
    taxInvoiceId: uuid('tax_invoice_id')
      .notNull()
      .references(() => taxInvoices.id, { onDelete: 'cascade' }),
    vat: money('vat').notNull().default('0'),
    amount: money('amount').notNull().default('0'),
  },
  (t) => [index('tax_invoice_lines_doc_idx').on(t.taxInvoiceId)],
);

/**
 * Disbursement voucher — VAT 0%. DIS numbers run company-wide and restart at DIS001 each
 * January, so a number is unique within its year (of the DIS date), not forever.
 */
export const disbursements = pgTable(
  'disbursements',
  {
    ...docHeader(),
    disNo: text('dis_no').notNull(),
    disDate: date('dis_date').notNull(),
    exchangeRate: rate('exchange_rate').notNull(),
    customerNameEn: text('customer_name_en').notNull(),
    customerNameKm: text('customer_name_km'),
    customerAddress: text('customer_address'),
    customerVattin: text('customer_vattin'),
    reference: text('reference'),
    pol: text('pol'),
    pod: text('pod'),
    containerNo: text('container_no'),
    containerSize: containerSizeEnum('container_size'),
    volumeCbm: qty('volume_cbm'),
    grossWeightKg: qty('gross_weight_kg'),
    shipper: text('shipper'),
    consignee: text('consignee'),
    hbl: text('hbl'),
    pkgs: text('pkgs'),
    pkgsUnit: text('pkgs_unit'),
    total: money('total').notNull().default('0'),
    totalKhr: khr('total_khr').notNull().default('0'),
  },
  (t) => [
    uniqueIndex('disbursements_dis_no_year_unique').on(
      t.disNo,
      sql`(extract(year from ${t.disDate}))`,
    ),
  ],
);

export const disbursementLines = pgTable(
  'disbursement_lines',
  {
    ...lineColumns(),
    disbursementId: uuid('disbursement_id')
      .notNull()
      .references(() => disbursements.id, { onDelete: 'cascade' }),
  },
  (t) => [index('disbursement_lines_doc_idx').on(t.disbursementId)],
);

export const debitNotes = pgTable('debit_notes', {
  ...docHeader(),
  dnNo: text('dn_no').notNull().unique(),
  dnDate: date('dn_date').notNull(),
  billTo: text('bill_to').notNull(),
  address: text('address'),
  reference: text('reference'),
  pol: text('pol'),
  pod: text('pod'),
  containerNo: text('container_no'),
  containerSize: containerSizeEnum('container_size'),
  volumeCbm: qty('volume_cbm'),
  grossWeightKg: qty('gross_weight_kg'),
  shipper: text('shipper'),
  consignee: text('consignee'),
  hbl: text('hbl'),
  pkgs: text('pkgs'),
  pkgsUnit: text('pkgs_unit'),
  total: money('total').notNull().default('0'),
});

export const debitNoteLines = pgTable(
  'debit_note_lines',
  {
    ...lineColumns(),
    debitNoteId: uuid('debit_note_id')
      .notNull()
      .references(() => debitNotes.id, { onDelete: 'cascade' }),
  },
  (t) => [index('debit_note_lines_doc_idx').on(t.debitNoteId)],
);

/** "Credit Noted" — the Chea payment voucher. */
export const creditNotes = pgTable('credit_notes', {
  ...docHeader(),
  cnNo: text('cn_no').notNull().unique(),
  cnDate: date('cn_date').notNull(),
  billTo: text('bill_to').notNull(),
  address: text('address'),
  shipper: text('shipper'),
  portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
  containerNo: text('container_no'),
  refType: creditNoteRefTypeEnum('ref_type'),
  refNo: text('ref_no'),
  quantityText: text('quantity_text'),
  grossWeightKg: qty('gross_weight_kg'),
  cbm: qty('cbm'),
  declareNo: text('declare_no'),
  /** VAT percent on the processing fee line. */
  vatRate: vatRate(),
  total: money('total').notNull().default('0'),
  /** Accounting's check of the submitted note (Accounting → Credit Noted). */
  reviewStatus: creditNoteReviewEnum('review_status').notNull().default('UNCHECKED'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});

export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    ...lineColumns(),
    creditNoteId: uuid('credit_note_id')
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'cascade' }),
  },
  (t) => [index('credit_note_lines_doc_idx').on(t.creditNoteId)],
);

export const recordSummaries = pgTable('record_summaries', {
  ...docHeader(),
  direction: directionEnum('direction').notNull(),
  transportMode: transportModeEnum('transport_mode').notNull(),
  loadType: loadTypeEnum('load_type').notNull(),
  invNo: text('inv_no'),
  disNo: text('dis_no'),
  dnNo: text('dn_no'),
  forwarderId: uuid('forwarder_id').references(() => forwarders.id, { onDelete: 'set null' }),
  portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
  declareNo: text('declare_no'),
  summaryDate: date('summary_date').notNull(),
  quantityText: text('quantity_text'),
  blNo: text('bl_no'),
  containerNo: text('container_no'),
  containerSize: containerSizeEnum('container_size'),
  grossWeightKg: qty('gross_weight_kg'),
  /** Usually a number, sometimes a note such as "NON": kept as typed. */
  cbm: text('cbm'),
  /** VAT percent on the processing fee line. */
  vatRate: vatRate(),
  total: money('total').notNull().default('0'),
  /** Accounting's check of the submitted summary (Accounting → Expense to Clients). */
  reviewStatus: creditNoteReviewEnum('review_status').notNull().default('UNCHECKED'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  /** "Revised": what accounting asked Operations to change. */
  reviewNote: text('review_note'),
});

export const recordSummaryLines = pgTable(
  'record_summary_lines',
  {
    ...lineColumns(),
    recordSummaryId: uuid('record_summary_id')
      .notNull()
      .references(() => recordSummaries.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('record_summary_lines_doc_idx').on(t.recordSummaryId),
    check('record_summary_lines_qty', sql`qty >= 0`),
  ],
);

/**
 * Official receipt: a client's payment against one of its monthly account statements
 * (tax invoices + disbursements, or debit notes). Issued when saved; void keeps the number.
 * The statements themselves are not stored: they are read from the month's documents.
 */
export const officialReceipts = pgTable(
  'official_receipts',
  {
    id: id(),
    receiptNo: text('receipt_no').notNull().unique(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /** First day of the statement month the payment is for. */
    periodMonth: date('period_month').notNull(),
    kind: statementKindEnum('kind').notNull(),
    receiptDate: date('receipt_date').notNull(),
    amount: money('amount').notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    paymentRef: text('payment_ref'),
    note: text('note'),
    status: billingDocStatusEnum('status').notNull().default('ISSUED'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('official_receipts_client_period_idx').on(t.clientId, t.periodMonth),
    index('official_receipts_date_idx').on(t.receiptDate),
    check('official_receipts_amount_positive', sql`amount > 0`),
  ],
);

/**
 * Payment to the customs broker (Chea) against a ledger month's clear fees. A month can be
 * paid in several parts; the month's balance is its clear fee total minus these.
 */
export const clearFeePayments = pgTable(
  'clear_fee_payments',
  {
    id: id(),
    /** First day of the ledger month the payment is for. */
    periodMonth: date('period_month').notNull(),
    paidOn: date('paid_on').notNull(),
    amount: money('amount').notNull(),
    remark: text('remark'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('clear_fee_payments_period_idx').on(t.periodMonth, t.paidOn),
    check('clear_fee_payments_amount_positive', sql`amount > 0`),
  ],
);

/**
 * Accounting → broker messages about a credit note ("Revised" with what to fix; older rows may be
 * "Checked", no longer sent). Shown in the broker's Credit Noted inbox.
 */
export const creditNoteMessages = pgTable(
  'credit_note_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditNoteId: uuid('credit_note_id')
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    kind: creditNoteReviewEnum('kind').notNull(),
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('credit_note_messages_recipient_idx').on(t.recipientId, t.createdAt),
    index('credit_note_messages_note_idx').on(t.creditNoteId),
  ],
);

/**
 * Accounting → Operations messages about a record summary ("Approved", or "Revised" with what
 * to fix). Shown in the Record Summary inbox.
 */
export const recordSummaryMessages = pgTable(
  'record_summary_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordSummaryId: uuid('record_summary_id')
      .notNull()
      .references(() => recordSummaries.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    kind: creditNoteReviewEnum('kind').notNull(),
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('record_summary_messages_recipient_idx').on(t.recipientId, t.createdAt),
    index('record_summary_messages_summary_idx').on(t.recordSummaryId),
  ],
);
