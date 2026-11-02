import { z } from 'zod';
import type { DocumentCategory, Direction } from './enums';
import type { Permission, RoleCode } from './permissions';
import { decimal, optDate, optText, optUuid } from './schemas/fields';

/**
 * A shipment's job workflow: the steps a job goes through from the first document to the
 * closed file, who does each one, and what must be in place before it can move on.
 *
 * Each stage names the role that owns it and the permission needed to move it forward.
 * "Requirements" are checked by the API (see apps/api/src/modules/workflow) and must all be met
 * before the stage can be completed; someone with `workflow:approve` can move on anyway with a
 * written reason, which is kept in the stage history.
 */

export type WorkflowOwner = 'OPERATIONS' | 'BROKER' | 'ACCOUNTANT' | 'OPERATION_MANAGER';

export const OWNER_LABEL: Record<WorkflowOwner, string> = {
  OPERATIONS: 'Operations',
  BROKER: 'Customs Broker',
  ACCOUNTANT: 'Accountant',
  OPERATION_MANAGER: 'Operation Manager',
};

/** The permission that lets someone complete a stage owned by each role. */
export const OWNER_PERMISSION: Record<WorkflowOwner, Permission> = {
  OPERATIONS: 'shipments:write',
  BROKER: 'customs:write',
  ACCOUNTANT: 'accounting:write',
  OPERATION_MANAGER: 'workflow:approve',
};

/** Which owners a role normally works as (for "My Work"). */
export const ROLE_OWNERS: Record<RoleCode, WorkflowOwner[]> = {
  ADMIN: ['OPERATIONS', 'BROKER', 'ACCOUNTANT', 'OPERATION_MANAGER'],
  MANAGER: ['OPERATION_MANAGER'],
  OPERATOR: ['OPERATIONS'],
  ACCOUNTANT: ['ACCOUNTANT'],
  VIEWER: [],
  CUSTOMS_BROKER: ['BROKER'],
  CEO: [],
  OPERATION_MANAGER: ['OPERATION_MANAGER'],
};

/** Things the API checks before a stage can be completed. */
export const REQUIREMENT_KEYS = [
  'HAS_CARGO_LINES',
  'HAS_HBL_NO',
  'HAS_BOOKING_NO',
  'HAS_BOOKED_FIGURES',
  'HAS_ETA',
  'HAS_DO_DATE',
  'HAS_ARRIVE_FTY',
  'HAS_ATD',
  'HAS_MEASURED',
  'VALID_PERMIT',
  'DECLARED',
  'VENDOR_INVOICES',
  'VENDOR_INVOICES_PAID',
  'LEDGER_ENTRY',
  'CO_DONE',
  'NO_BLOCKING_ISSUES',
] as const;
export type RequirementKey = (typeof REQUIREMENT_KEYS)[number];

export interface StageDef {
  key: string;
  label: string;
  /** One line on what happens in this stage, shown under the stepper. */
  hint: string;
  owner: WorkflowOwner;
  /** Documents that must be attached to the shipment before the stage can be completed. */
  docs: DocumentCategory[];
  checks: RequirementKey[];
  /** Completing this stage is an approval (recorded as such in the history). */
  approval?: boolean;
}

export const IMPORT_STAGES: readonly StageDef[] = [
  {
    key: 'PRE_ALERT',
    label: 'Pre-alert',
    hint: "Upload the supplier's invoice, packing list and HBL and enter the cargo lines.",
    owner: 'OPERATIONS',
    docs: ['COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING'],
    checks: ['HAS_CARGO_LINES', 'HAS_HBL_NO'],
  },
  {
    key: 'DOC_CHECK',
    label: 'Document check',
    hint: 'Fix any mismatch between invoice, packing list, HBL and CDC master list.',
    owner: 'OPERATIONS',
    docs: [],
    checks: ['NO_BLOCKING_ISSUES'],
  },
  {
    key: 'PERMIT_PACKAGE',
    label: 'Permit package',
    hint: 'Export INV + PL: the Khmer INV/PL, cover letter to GDCE and authorization letter.',
    owner: 'OPERATIONS',
    docs: [],
    checks: ['NO_BLOCKING_ISSUES'],
  },
  {
    key: 'REVIEW',
    label: 'Manager review',
    hint: 'Operation Manager checks the package before it goes to the customer and customs.',
    owner: 'OPERATION_MANAGER',
    docs: [],
    checks: ['NO_BLOCKING_ISSUES'],
    approval: true,
  },
  {
    key: 'CUSTOMER_SIGNING',
    label: 'Customer signing',
    hint: 'Customer signs and stamps the letters; upload the signed scans.',
    owner: 'OPERATIONS',
    docs: ['AUTHORIZATION_LETTER'],
    checks: [],
  },
  {
    key: 'PERMIT',
    label: 'Customs permit',
    hint: 'Apply on NSW, then record the permit number and validity and upload the permit.',
    owner: 'BROKER',
    docs: ['CUSTOMS_PERMIT'],
    checks: ['VALID_PERMIT'],
  },
  {
    key: 'ARRIVAL',
    label: 'Arrival notice',
    hint: "Upload the destination agent's arrival notice and confirm the ETA.",
    owner: 'OPERATIONS',
    docs: ['ARRIVAL_NOTICE'],
    checks: ['HAS_ETA'],
  },
  {
    key: 'LOCAL_CHARGES',
    label: 'Local charges',
    hint: "Enter and pay the destination agent's invoices; the DO is released after payment.",
    owner: 'ACCOUNTANT',
    docs: [],
    checks: ['VENDOR_INVOICES', 'VENDOR_INVOICES_PAID'],
  },
  {
    key: 'DELIVERY_ORDER',
    label: 'Delivery order',
    hint: 'Upload the DO and the release letter and record the DO date.',
    owner: 'OPERATIONS',
    docs: ['DELIVERY_ORDER'],
    checks: ['HAS_DO_DATE'],
  },
  {
    key: 'CLEARANCE',
    label: 'Customs clearance',
    hint: 'Lodge the declaration at the port and record its number.',
    owner: 'BROKER',
    docs: [],
    checks: ['DECLARED', 'VALID_PERMIT'],
  },
  {
    key: 'DELIVERY',
    label: 'Delivery',
    hint: 'Truck to the factory, record the arrival date and the empty return.',
    owner: 'OPERATIONS',
    docs: [],
    checks: ['HAS_ARRIVE_FTY'],
  },
  {
    key: 'BILLING',
    label: 'Billing',
    hint: 'Record the job in the ledger and invoice the customer.',
    owner: 'ACCOUNTANT',
    docs: [],
    checks: ['LEDGER_ENTRY'],
  },
  {
    key: 'CLOSING',
    label: 'Close job',
    hint: 'Operation Manager closes the file; low-margin jobs also need CEO approval.',
    owner: 'OPERATION_MANAGER',
    docs: [],
    checks: [],
    approval: true,
  },
];

export const EXPORT_STAGES: readonly StageDef[] = [
  {
    key: 'BOOKING_RECEIVED',
    label: 'Booking received',
    hint: "Enter the customer's booking: POs, styles, quantities and the booked weight / CBM.",
    owner: 'OPERATIONS',
    docs: [],
    checks: ['HAS_CARGO_LINES', 'HAS_BOOKED_FIGURES'],
  },
  {
    key: 'BOOKED',
    label: 'Booked with forwarder',
    hint: 'Send the booking form and record the SO / booking number.',
    owner: 'OPERATIONS',
    docs: [],
    checks: ['HAS_BOOKING_NO'],
  },
  {
    key: 'FINAL_PACKING',
    label: 'Final packing list',
    hint: "Upload the factory's final packing list; differences from the booking are flagged.",
    owner: 'OPERATIONS',
    docs: ['PACKING_LIST', 'COMMERCIAL_INVOICE'],
    checks: ['NO_BLOCKING_ISSUES'],
  },
  {
    key: 'WAREHOUSE_DOCS',
    label: 'Warehouse documents',
    hint: 'Checklist, cargo DO and authorization letters, signed and stamped by the customer.',
    owner: 'OPERATIONS',
    docs: ['WAREHOUSE_CHECKLIST', 'AUTHORIZATION_LETTER'],
    checks: [],
  },
  {
    key: 'REVIEW',
    label: 'Manager review',
    hint: 'Operation Manager checks the package before it goes to customs.',
    owner: 'OPERATION_MANAGER',
    docs: [],
    checks: ['NO_BLOCKING_ISSUES'],
    approval: true,
  },
  {
    key: 'DECLARATION',
    label: 'Export declaration',
    hint: 'Clear export customs and record the declaration number.',
    owner: 'BROKER',
    docs: [],
    checks: ['DECLARED'],
  },
  {
    key: 'CFS_DELIVERY',
    label: 'Delivered to CFS',
    hint: 'Truck the cargo in and record the CBM and weight the warehouse measured.',
    owner: 'OPERATIONS',
    docs: [],
    checks: ['HAS_MEASURED'],
  },
  {
    key: 'BL',
    label: 'Bill of lading',
    hint: 'Confirm the draft B/L with the customer, upload the final and record the on-board date.',
    owner: 'OPERATIONS',
    docs: ['BILL_OF_LADING'],
    checks: ['HAS_ATD'],
  },
  {
    key: 'CO',
    label: 'Certificate of origin',
    hint: 'Apply for the CO; its ship date must match the B/L on-board date.',
    owner: 'BROKER',
    docs: [],
    checks: ['CO_DONE', 'NO_BLOCKING_ISSUES'],
  },
  {
    key: 'VENDOR_COSTS',
    label: 'Vendor costs',
    hint: "Enter the forwarder's invoices; billed CBM is compared with what was measured.",
    owner: 'ACCOUNTANT',
    docs: [],
    checks: ['VENDOR_INVOICES'],
  },
  {
    key: 'BILLING',
    label: 'Billing',
    hint: 'Record the job in the ledger and invoice the customer.',
    owner: 'ACCOUNTANT',
    docs: [],
    checks: ['LEDGER_ENTRY'],
  },
  {
    key: 'CLOSING',
    label: 'Close job',
    hint: 'Operation Manager closes the file; low-margin jobs also need CEO approval.',
    owner: 'OPERATION_MANAGER',
    docs: [],
    checks: [],
    approval: true,
  },
];

/** The stage after the last one. */
export const CLOSED_STAGE = 'CLOSED';

export function stagesFor(direction: Direction): readonly StageDef[] {
  return direction === 'IMPORT' ? IMPORT_STAGES : EXPORT_STAGES;
}

/** A stored stage, or the first stage when none is stored yet. */
export function currentStageKey(direction: Direction, stored: string | null | undefined): string {
  if (stored === CLOSED_STAGE) return CLOSED_STAGE;
  const stages = stagesFor(direction);
  return stages.some((s) => s.key === stored) ? stored! : stages[0]!.key;
}

export function stageIndex(direction: Direction, key: string): number {
  if (key === CLOSED_STAGE) return stagesFor(direction).length;
  return stagesFor(direction).findIndex((s) => s.key === key);
}

export function stageLabel(direction: Direction, key: string | null | undefined): string {
  if (key === CLOSED_STAGE) return 'Closed';
  return stagesFor(direction).find((s) => s.key === currentStageKey(direction, key))!.label;
}

/** Every stage key used by either direction, plus CLOSED (for filters). */
export const ALL_STAGE_KEYS = [
  ...new Set([...IMPORT_STAGES, ...EXPORT_STAGES].map((s) => s.key)),
  CLOSED_STAGE,
];

/** Margin under this share of revenue (or a loss) needs CEO approval to close the job. */
export const LOW_MARGIN_RATIO = 0.1;

/** Allowed difference before a cross-check is flagged (5 % weight / CBM). */
export const VARIANCE_TOLERANCE = 0.05;

/* ---------- Cross-check issues ---------- */

export type IssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface WorkflowIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** Where to fix it, e.g. a form tab or a section of the workflow panel. */
  fix?: string;
}

/* ---------- API shapes ---------- */

export interface RequirementStatus {
  key: string;
  label: string;
  met: boolean;
  /** Extra detail, e.g. "permit expires in 3 days". */
  detail?: string;
  kind: 'DOCUMENT' | 'CHECK';
  /** For documents: the category to upload. */
  category?: DocumentCategory;
}

export interface StageHistoryEntry {
  id: string;
  fromStage: string | null;
  toStage: string;
  action: 'ADVANCE' | 'RETURN' | 'OVERRIDE' | 'APPROVE';
  note: string | null;
  overrideReason: string | null;
  userName: string | null;
  createdAt: string;
}

export interface CustomsPermitRow {
  id: string;
  shipmentId: string;
  permitNo: string;
  issueDate: string | null;
  validFrom: string | null;
  validUntil: string | null;
  office: string | null;
  remark: string | null;
  documentId: string | null;
  daysLeft: number | null;
}

export interface VendorInvoiceRow {
  id: string;
  shipmentId: string;
  vendorName: string;
  invoiceNo: string;
  invoiceDate: string | null;
  description: string | null;
  amount: string;
  vat: string;
  total: string;
  billedCbm: string | null;
  billedGrossWeightKg: string | null;
  dueDate: string | null;
  paidOn: string | null;
  paymentRef: string | null;
  documentId: string | null;
}

export interface WorkflowMargin {
  revenue: number;
  cost: number;
  netProfit: number;
  /** null when there is no revenue yet. */
  ratio: number | null;
  low: boolean;
}

export interface ShipmentWorkflow {
  shipmentId: string;
  reference: string;
  direction: Direction;
  stage: string;
  stageIndex: number;
  stageChangedAt: string | null;
  stages: (StageDef & { index: number })[];
  requirements: RequirementStatus[];
  issues: WorkflowIssue[];
  /** What the signed-in user may do right now. */
  can: {
    advance: boolean;
    override: boolean;
    sendBack: boolean;
    /** Closing needs CEO approval and this user can give it. */
    financeApprove: boolean;
  };
  /** Why the user can't advance (missing permission or requirements), for the button tooltip. */
  blockedReason: string | null;
  needsCeoApproval: boolean;
  margin: WorkflowMargin | null;
  permits: CustomsPermitRow[];
  vendorInvoices: { count: number; unpaid: number; total: string; rows: VendorInvoiceRow[] | null };
  history: StageHistoryEntry[];
  measured: { cbm: string | null; grossWeightKg: string | null };
  booked: { qty: string | null; grossWeightKg: string | null; cbm: string | null };
}

export const workflowAdvanceSchema = z.object({
  /** The stage the client thinks the shipment is at (rejects a stale screen). */
  from: z.string().min(1).max(40),
  note: optText(500),
  /** Required to move on while requirements are unmet (needs workflow:approve). */
  overrideReason: optText(500),
});
export type WorkflowAdvanceInput = z.input<typeof workflowAdvanceSchema>;

export const workflowReturnSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  note: z.string().trim().min(3, 'Say what needs fixing').max(500),
});
export type WorkflowReturnInput = z.input<typeof workflowReturnSchema>;

export const workflowFiguresSchema = z.object({
  bookedQty: decimal(3, { min: 0 }),
  bookedGrossWeightKg: decimal(3, { min: 0 }),
  bookedCbm: decimal(3, { min: 0 }),
  measuredCbm: decimal(3, { min: 0 }),
  measuredGrossWeightKg: decimal(3, { min: 0 }),
});
export type WorkflowFiguresInput = z.input<typeof workflowFiguresSchema>;

export const customsPermitInputSchema = z.object({
  permitNo: z.string().trim().min(3, 'Enter the permit number').max(60),
  issueDate: optDate,
  validFrom: optDate,
  validUntil: optDate,
  office: optText(120),
  remark: optText(300),
  documentId: optUuid,
});
export type CustomsPermitInput = z.input<typeof customsPermitInputSchema>;

export const vendorInvoiceInputSchema = z.object({
  vendorName: z.string().trim().min(2, 'Enter the vendor').max(120),
  invoiceNo: z.string().trim().min(1, 'Enter the invoice number').max(60),
  invoiceDate: optDate,
  description: optText(300),
  amount: decimal(2, { min: 0, allowEmpty: false }),
  vat: decimal(2, { min: 0 }).transform((v) => v ?? '0'),
  billedCbm: decimal(3, { min: 0 }),
  billedGrossWeightKg: decimal(3, { min: 0 }),
  dueDate: optDate,
  paidOn: optDate,
  paymentRef: optText(80),
  documentId: optUuid,
});
export type VendorInvoiceInput = z.input<typeof vendorInvoiceInputSchema>;

/* ---------- My Work and alerts ---------- */

export interface WorkQueueItem {
  shipmentId: string;
  reference: string;
  clientName: string;
  clientCode: string;
  direction: Direction;
  stage: string;
  stageLabel: string;
  owner: WorkflowOwner;
  invoiceNos: string[];
  eta: string | null;
  etd: string | null;
  /** Days the shipment has been in this stage. */
  daysInStage: number | null;
}

export type AlertKind =
  | 'PERMIT_EXPIRING'
  | 'PERMIT_EXPIRED'
  | 'CDC_EXPIRING'
  | 'AUTHORIZATION_EXPIRING'
  | 'BROKER_CARD_EXPIRING'
  | 'ETA_SOON'
  | 'APPROVAL_WAITING'
  | 'VENDOR_INVOICE_DUE'
  | 'STUCK';

export interface AlertItem {
  id: string;
  kind: AlertKind;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** In-app link, e.g. /plans/:id?tab=workflow */
  link: string | null;
  date: string | null;
}

/* ---------- Master data: broker agents, signatories, authorizations ---------- */

export interface BrokerAgentRow {
  id: string;
  company: string;
  companyVattin: string | null;
  granteeName: string;
  granteeIdNo: string | null;
  granteePhone: string | null;
  agentName: string;
  agentIdNo: string | null;
  agentPhone: string | null;
  cardNo: string | null;
  cardExpiry: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export const brokerAgentInputSchema = z.object({
  company: z.string().trim().min(2).max(160),
  companyVattin: optText(40),
  granteeName: z.string().trim().min(2).max(120),
  granteeIdNo: optText(40),
  granteePhone: optText(40),
  agentName: z.string().trim().min(2).max(120),
  agentIdNo: optText(40),
  agentPhone: optText(40),
  cardNo: optText(40),
  cardExpiry: optDate,
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type BrokerAgentInput = z.input<typeof brokerAgentInputSchema>;

export interface ClientSignatoryRow {
  id: string;
  clientId: string;
  name: string;
  passportNo: string | null;
  title: string | null;
  titleKm: string | null;
  isDefault: boolean;
}

export const clientSignatoryInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  passportNo: optText(40),
  title: optText(80),
  titleKm: optText(160),
  isDefault: z.boolean().default(false),
});
export type ClientSignatoryInput = z.input<typeof clientSignatoryInputSchema>;

export const AUTHORIZATION_KINDS = [
  'AUTHORIZATION_LETTER',
  'OWNER_TO_STAFF',
  'BROKER_ID',
  'PATENT_VAT',
  'CDC_EXTENSION',
  'OTHER',
] as const;
export type AuthorizationKind = (typeof AUTHORIZATION_KINDS)[number];
export const AUTHORIZATION_KIND_LABEL: Record<AuthorizationKind, string> = {
  AUTHORIZATION_LETTER: 'Authorization letter (to broker)',
  OWNER_TO_STAFF: 'Owner to shipping staff',
  BROKER_ID: 'Broker ID',
  PATENT_VAT: 'Patent & VAT certificate',
  CDC_EXTENSION: 'CDC master list extension',
  OTHER: 'Other',
};

export interface ClientAuthorizationRow {
  id: string;
  clientId: string;
  kind: AuthorizationKind;
  reference: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  notes: string | null;
  documentId: string | null;
  daysLeft: number | null;
}

export const clientAuthorizationInputSchema = z.object({
  kind: z.enum(AUTHORIZATION_KINDS),
  reference: optText(80),
  issuedOn: optDate,
  validUntil: optDate,
  notes: optText(300),
  documentId: optUuid,
});
export type ClientAuthorizationInput = z.input<typeof clientAuthorizationInputSchema>;

/** Days from today (Phnom Penh) to a YYYY-MM-DD date; negative once past. */
export function daysUntil(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Expiry warnings start this many days before the date. */
export const EXPIRY_WARNING_DAYS = 30;
