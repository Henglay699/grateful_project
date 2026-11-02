import { pgTable, text, uuid, date, boolean, index, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { id, timestamps, softDelete, money, qty } from './_common';
import { users } from './auth';
import { clients } from './reference';
import { shipments } from './shipments';
import { documents } from './documents';

/** Every move of a shipment between workflow stages: who, when, why. */
export const shipmentStageHistory = pgTable(
  'shipment_stage_history',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    fromStage: text('from_stage'),
    toStage: text('to_stage').notNull(),
    /** ADVANCE, RETURN (sent back), OVERRIDE (moved on with requirements unmet), APPROVE. */
    action: text('action').notNull(),
    note: text('note'),
    overrideReason: text('override_reason'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shipment_stage_history_shipment_idx').on(t.shipmentId, t.createdAt)],
);

/** GDCE import / export permits (e.g. PRT20260914GDCE168890), with their validity. */
export const customsPermits = pgTable(
  'customs_permits',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    permitNo: text('permit_no').notNull(),
    issueDate: date('issue_date'),
    validFrom: date('valid_from'),
    validUntil: date('valid_until'),
    office: text('office'),
    remark: text('remark'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('customs_permits_shipment_idx').on(t.shipmentId),
    index('customs_permits_valid_until_idx')
      .on(t.validUntil)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

/** Invoices from forwarders / destination agents for a shipment (our cost). */
export const vendorInvoices = pgTable(
  'vendor_invoices',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    vendorName: text('vendor_name').notNull(),
    invoiceNo: text('invoice_no').notNull(),
    invoiceDate: date('invoice_date'),
    description: text('description'),
    amount: money('amount').notNull().default('0'),
    vat: money('vat').notNull().default('0'),
    billedCbm: qty('billed_cbm'),
    billedGrossWeightKg: qty('billed_gross_weight_kg'),
    dueDate: date('due_date'),
    paidOn: date('paid_on'),
    paymentRef: text('payment_ref'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('vendor_invoices_shipment_idx').on(t.shipmentId)],
);

/** Our customs broker company and its representatives, as printed on authorization letters. */
export const brokerAgents = pgTable('broker_agents', {
  id: id(),
  company: text('company').notNull(),
  companyVattin: text('company_vattin'),
  /** Person the rights are transferred to (head / deputy of the broker company). */
  granteeName: text('grantee_name').notNull(),
  granteeIdNo: text('grantee_id_no'),
  granteePhone: text('grantee_phone'),
  /** Licensed customs agent (ជើងសាគយ) representing the company. */
  agentName: text('agent_name').notNull(),
  agentIdNo: text('agent_id_no'),
  agentPhone: text('agent_phone'),
  cardNo: text('card_no'),
  cardExpiry: date('card_expiry'),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

/** Who signs a client's customs letters (owner of the goods). */
export const clientSignatories = pgTable(
  'client_signatories',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    passportNo: text('passport_no'),
    title: text('title'),
    titleKm: text('title_km'),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('client_signatories_client_idx').on(t.clientId)],
);

/** Standing papers a client has given us (authorization letters, broker ID, patent…). */
export const clientAuthorizations = pgTable(
  'client_authorizations',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    reference: text('reference'),
    issuedOn: date('issued_on'),
    validUntil: date('valid_until'),
    notes: text('notes'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('client_authorizations_client_idx').on(t.clientId)],
);
