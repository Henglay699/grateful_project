/**
 * Domain enums shared by the API (database enums) and the web app (labels, pills).
 * The string values are what is stored in PostgreSQL.
 */

export const DIRECTIONS = ['IMPORT', 'EXPORT'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** How the cargo travels. Split from load type (see Phase 1, decision 2). */
export const TRANSPORT_MODES = ['SEA', 'AIR', 'ROAD', 'RAIL'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/** FCL = "CY/CY" in the prototype. NONE is used for air and loose road cargo. */
export const LOAD_TYPES = ['FCL', 'LCL', 'NONE'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

/** Incoterms 2020: the seven rules for any mode of transport, then the four for sea and inland waterway. */
export const INCOTERMS = [
  'EXW',
  'FCA',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
] as const;
export type Incoterm = (typeof INCOTERMS)[number];
export const INCOTERM_LABEL: Record<Incoterm, string> = {
  EXW: 'Ex Works',
  FCA: 'Free Carrier',
  CPT: 'Carriage Paid To',
  CIP: 'Carriage and Insurance Paid To',
  DAP: 'Delivered at Place',
  DPU: 'Delivered at Place Unloaded',
  DDP: 'Delivered Duty Paid',
  FAS: 'Free Alongside Ship',
  FOB: 'Free on Board',
  CFR: 'Cost and Freight',
  CIF: 'Cost, Insurance and Freight',
};

/** Worked out from the shipment's dates and declarations (see shipmentStatusOf), never chosen. */
export const SHIPMENT_STATUSES = ['COMPLETED', 'IN_PROGRESS', 'PENDING'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const CLEARANCE_STATUSES = ['PENDING', 'IN_PROGRESS', 'CLEARED', 'EXCEPTION'] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

export const CONTAINER_SIZES = ['20GP', '40GP', '40HQ', '45HQ'] as const;
export type ContainerSize = (typeof CONTAINER_SIZES)[number];

export const PORT_KINDS = ['SEA', 'DRY', 'AIR', 'LAND', 'RAIL'] as const;
export type PortKind = (typeof PORT_KINDS)[number];

export const CLIENT_STATUSES = ['ACTIVE', 'ONBOARDING', 'INACTIVE'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CUT_STOCK_CATEGORIES = ['MACHINERY_EQUIPMENT', 'RAW_MATERIAL', 'ACCESSORY'] as const;
export type CutStockCategory = (typeof CUT_STOCK_CATEGORIES)[number];

export const CHEA_STATUSES = ['UNPAID', 'PAID'] as const;
export type CheaStatus = (typeof CHEA_STATUSES)[number];
/** A ledger row's shown Chea status: NA when it has no clear fee (nothing owed to Chea). */
export type CheaPaymentStatus = CheaStatus | 'NA';

export const BILLING_DOC_STATUSES = ['DRAFT', 'ISSUED', 'VOID'] as const;
export type BillingDocStatus = (typeof BILLING_DOC_STATUSES)[number];

/**
 * A client's two monthly account statements, as in the Excel pack: ST-INV (tax invoices +
 * disbursements) and STA-DN (debit notes). Each is paid with its own official receipt.
 */
export const STATEMENT_KINDS = ['INVOICE', 'DEBIT_NOTE'] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'SUPERSEDED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  'BILL_OF_LADING',
  'CUSTOMS_DECLARATION',
  'CERTIFICATE_OF_ORIGIN',
  'COMMERCIAL_INVOICE',
  'PACKING_LIST',
  'CONTRACT',
  'POLICY',
  'OTHER',
  'CUSTOMS_PERMIT',
  'ARRIVAL_NOTICE',
  'DELIVERY_ORDER',
  'AUTHORIZATION_LETTER',
  'BOOKING_FORM',
  'WAREHOUSE_CHECKLIST',
  'VENDOR_INVOICE',
  'BROKER_ID',
  'PATENT_VAT',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const FOLLOW_UP_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type FollowUpPriority = (typeof FOLLOW_UP_PRIORITIES)[number];

export const FOLLOW_UP_STATUSES = ['OPEN', 'AWAITING_REPLY', 'IN_REVIEW', 'DONE'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const STAFF_STATUSES = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const CREDIT_NOTE_REF_TYPES = ['HOUSE_BILL', 'BILL_NO', 'HAWB_NO'] as const;
export type CreditNoteRefType = (typeof CREDIT_NOTE_REF_TYPES)[number];
/**
 * Accounting's check of a submitted credit note or record summary. REVISION_REQUESTED ("Request
 * Revise"): its maker reopened it after submitting and resubmitted it for accounting to approve.
 */
export const CREDIT_NOTE_REVIEW_STATUSES = [
  'UNCHECKED',
  'REVIEWED',
  'CHECKED',
  'REVISED',
  'REVISION_REQUESTED',
] as const;
export type CreditNoteReviewStatus = (typeof CREDIT_NOTE_REVIEW_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'TOKEN_REUSE',
  'OVERRIDE',
  'IMPORT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const LOOKUP_TYPES = [
  'QUANTITY_UNIT',
  'MATERIAL',
  'CO_FORM',
  'BROKER',
  'DEPARTMENT',
  'CHARGE',
  'CHARGE_UNIT',
] as const;
export type LookupType = (typeof LOOKUP_TYPES)[number];

/** Units on credit note / charge lines; always offered, plus any added to "Charge units". */
export const DEFAULT_CHARGE_UNITS = [
  'SHIP',
  'DAY',
  'MIN',
  'CBM',
  'SET',
  'TRUCK 1.5T',
  'TRUCK 2.5T',
  'TRUCK 5T',
  '40FT',
  '20FT',
  'TIME',
  'BALES',
] as const;

/* ---------- Display labels (prototype wording) ---------- */

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  COMPLETED: 'Completed',
  IN_PROGRESS: 'In Progress',
  PENDING: 'Pending',
};

/** CSS modifier used by the prototype's `.status-tag` / status pill classes. */
export const SHIPMENT_STATUS_PILL: Record<ShipmentStatus, 'completed' | 'progress' | 'pending'> = {
  COMPLETED: 'completed',
  IN_PROGRESS: 'progress',
  PENDING: 'pending',
};

export const STATEMENT_KIND_LABEL: Record<StatementKind, string> = {
  INVOICE: 'Tax invoices & disbursements',
  DEBIT_NOTE: 'Debit notes',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
};

export const CLEARANCE_STATUS_LABEL: Record<ClearanceStatus, string> = {
  PENDING: 'Pending Review',
  IN_PROGRESS: 'In Progress',
  CLEARED: 'Customs Cleared',
  EXCEPTION: 'Exception',
};

/** "Freight method" as the prototype shows it, derived from mode + load type. */
export function freightMethodLabel(mode: TransportMode, load: LoadType): string {
  if (mode === 'AIR') return 'AIR';
  if (mode === 'SEA')
    return load === 'LCL' ? 'SEA LCL/LCL' : load === 'FCL' ? 'SEA CY/CY' : 'BY SEA';
  return `BY ${mode}`;
}

/** Key Logistics Accounts buckets: CY/CY, LCL, AIR. */
export type AccountBucket = 'CY' | 'LCL' | 'AIR' | 'OTHER';
export function accountBucket(mode: TransportMode, load: LoadType): AccountBucket {
  if (mode === 'AIR') return 'AIR';
  if (load === 'LCL') return 'LCL';
  if (load === 'FCL') return 'CY';
  return 'OTHER';
}
