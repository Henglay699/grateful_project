import { pgEnum, timestamp, uuid, numeric } from 'drizzle-orm/pg-core';
import {
  DIRECTIONS,
  TRANSPORT_MODES,
  LOAD_TYPES,
  SHIPMENT_STATUSES,
  CLEARANCE_STATUSES,
  CONTAINER_SIZES,
  PORT_KINDS,
  CLIENT_STATUSES,
  CUT_STOCK_CATEGORIES,
  CHEA_STATUSES,
  BILLING_DOC_STATUSES,
  STATEMENT_KINDS,
  PAYMENT_METHODS,
  QUOTATION_STATUSES,
  DOCUMENT_CATEGORIES,
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_STATUSES,
  STAFF_STATUSES,
  CREDIT_NOTE_REF_TYPES,
  CREDIT_NOTE_REVIEW_STATUSES,
  AUDIT_ACTIONS,
  LOOKUP_TYPES,
  ROLE_CODES,
} from '@gs/shared';

/* ---------- PostgreSQL enums (values come from @gs/shared) ---------- */
export const roleCodeEnum = pgEnum('role_code', ROLE_CODES);
export const directionEnum = pgEnum('direction', DIRECTIONS);
export const transportModeEnum = pgEnum('transport_mode', TRANSPORT_MODES);
export const loadTypeEnum = pgEnum('load_type', LOAD_TYPES);
export const shipmentStatusEnum = pgEnum('shipment_status', SHIPMENT_STATUSES);
export const clearanceStatusEnum = pgEnum('clearance_status', CLEARANCE_STATUSES);
export const containerSizeEnum = pgEnum('container_size', CONTAINER_SIZES);
export const portKindEnum = pgEnum('port_kind', PORT_KINDS);
export const clientStatusEnum = pgEnum('client_status', CLIENT_STATUSES);
export const cutStockCategoryEnum = pgEnum('cut_stock_category', CUT_STOCK_CATEGORIES);
export const cheaStatusEnum = pgEnum('chea_status', CHEA_STATUSES);
export const billingDocStatusEnum = pgEnum('billing_doc_status', BILLING_DOC_STATUSES);
export const statementKindEnum = pgEnum('statement_kind', STATEMENT_KINDS);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const quotationStatusEnum = pgEnum('quotation_status', QUOTATION_STATUSES);
export const documentCategoryEnum = pgEnum('document_category', DOCUMENT_CATEGORIES);
export const followUpPriorityEnum = pgEnum('follow_up_priority', FOLLOW_UP_PRIORITIES);
export const followUpStatusEnum = pgEnum('follow_up_status', FOLLOW_UP_STATUSES);
export const staffStatusEnum = pgEnum('staff_status', STAFF_STATUSES);
export const creditNoteRefTypeEnum = pgEnum('credit_note_ref_type', CREDIT_NOTE_REF_TYPES);
export const creditNoteReviewEnum = pgEnum('credit_note_review', CREDIT_NOTE_REVIEW_STATUSES);
export const auditActionEnum = pgEnum('audit_action', AUDIT_ACTIONS);
export const lookupTypeEnum = pgEnum('lookup_type', LOOKUP_TYPES);

/* ---------- Column helpers ---------- */
export const id = () => uuid('id').primaryKey().defaultRandom();

/** Money amount: NUMERIC(14,2). Returned by the driver as a string. */
export const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
/** Unit price / rate: NUMERIC(14,4) — FOB and tariff unit prices can have 3–4 decimals. */
export const rate = (name: string) => numeric(name, { precision: 14, scale: 4 });
/** Quantity, weight, CBM: NUMERIC(14,3). */
export const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
/** A VAT percent: NUMERIC(5,2), e.g. 10.00. */
export const percent = (name: string) => numeric(name, { precision: 5, scale: 2 });
/** A document's VAT percent, kept with it so a later change in Settings never alters it. */
export const vatRate = () => percent('vat_rate').notNull().default('10');
/** Whole riel amounts. */
export const khr = (name: string) => numeric(name, { precision: 16, scale: 0 });

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};
