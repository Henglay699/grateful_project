import { z } from 'zod';
import {
  DOCUMENT_CATEGORIES,
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_STATUSES,
  LOOKUP_TYPES,
  PORT_KINDS,
  QUOTATION_STATUSES,
  STAFF_STATUSES,
  type DocumentCategory,
  type FollowUpPriority,
  type FollowUpStatus,
  type LookupType,
  type PortKind,
  type QuotationStatus,
  type StaffStatus,
} from '../enums';
import {
  PERMISSIONS,
  ROLE_CODES,
  type ClientScopes,
  type Permission,
  type RoleCode,
} from '../permissions';
import { clientScopesSchema } from './auth';
import { paginationQuerySchema } from './common';
import { boolParam, decimal, optText, optUuid } from './fields';

/* ------------------------------ Passwords ------------------------------ */

/** At least 10 characters with a letter and a digit. */
export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letters and at least one number');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Choose a different password',
    path: ['newPassword'],
  });

/* ------------------------------ Staff & roles ------------------------------ */

export const staffInputSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  role: z.enum(ROLE_CODES),
  jobTitle: optText(120),
  department: optText(80),
  phone: optText(40),
  status: z.enum(STAFF_STATUSES).default('ACTIVE'),
  /** Temporary password the person changes after first sign-in. */
  password: passwordSchema,
  /** Per-user tweaks on top of the role: extra permissions and removed ones. */
  permissionsAdd: z.array(z.enum(PERMISSIONS)).default([]),
  permissionsRemove: z.array(z.enum(PERMISSIONS)).default([]),
  /** Clients this person may work with; null = every client. */
  clientIds: z
    .array(z.string().uuid())
    .min(1, 'Choose at least one client, or allow all clients')
    .nullable()
    .default(null),
  /** Sections with their own client access, replacing clientIds there. */
  clientScopes: clientScopesSchema.default({}),
});
export const staffUpdateSchema = staffInputSchema.omit({ password: true, email: true }).partial();
export const resetPasswordSchema = z.object({ password: passwordSchema });
export const rolePermissionsSchema = z.object({ permissions: z.array(z.enum(PERMISSIONS)) });

export interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  /** Profile picture URL (set in My profile), or null to show initials. */
  avatarUrl: string | null;
  role: RoleCode;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  status: StaffStatus;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  permissionsAdd: Permission[];
  permissionsRemove: Permission[];
  /** null = every client. */
  clientIds: string[] | null;
  clientScopes: ClientScopes;
}

export interface RoleInfo {
  code: RoleCode;
  name: string;
  permissions: Permission[];
  members: number;
}

/* ------------------------------ Follow-ups ------------------------------ */

export const followUpInputSchema = z.object({
  subject: z.string().trim().min(3, 'Enter a subject').max(200),
  notes: optText(2000),
  clientId: optUuid,
  shipmentId: optUuid,
  assigneeId: optUuid,
  /** Local Phnom Penh date-time "YYYY-MM-DDTHH:mm" (from a datetime-local input) or ISO. */
  dueAt: z.string().min(10, 'Enter a due date'),
  priority: z.enum(FOLLOW_UP_PRIORITIES).default('MEDIUM'),
  status: z.enum(FOLLOW_UP_STATUSES).default('OPEN'),
});
export const followUpUpdateSchema = followUpInputSchema.partial();

export const followUpListQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...FOLLOW_UP_STATUSES, 'ACTIVE'] as const).optional(),
  priority: z.enum(FOLLOW_UP_PRIORITIES).optional(),
  assigneeId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  overdue: boolParam,
});

export interface FollowUpRow {
  id: string;
  reference: string;
  subject: string;
  notes: string | null;
  clientId: string | null;
  clientName: string | null;
  shipmentId: string | null;
  shipmentReference: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string;
  priority: FollowUpPriority;
  status: FollowUpStatus;
  overdue: boolean;
  completedAt: string | null;
}

/* ------------------------------ Documents ------------------------------ */

export const documentMetaSchema = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(200),
  category: z.enum(DOCUMENT_CATEGORIES).default('OTHER'),
  statusLabel: optText(60),
  shipmentId: optUuid,
  clientId: optUuid,
  /** A credit note's or record summary's support document (⋯ → Upload support documents). */
  creditNoteId: optUuid,
  recordSummaryId: optUuid,
});

export const documentListQuerySchema = paginationQuerySchema.extend({
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  shipmentId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  creditNoteId: z.string().uuid().optional(),
  recordSummaryId: z.string().uuid().optional(),
});

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  BILL_OF_LADING: 'Bill of Lading',
  CUSTOMS_DECLARATION: 'Customs Declaration',
  CERTIFICATE_OF_ORIGIN: 'Certificate of Origin',
  COMMERCIAL_INVOICE: 'Commercial Invoice',
  PACKING_LIST: 'Packing List',
  CONTRACT: 'Contract',
  POLICY: 'Policy',
  OTHER: 'Other',
  CUSTOMS_PERMIT: 'Customs Permit',
  ARRIVAL_NOTICE: 'Arrival Notice',
  DELIVERY_ORDER: 'Delivery Order',
  AUTHORIZATION_LETTER: 'Authorization Letter',
  BOOKING_FORM: 'Booking Form',
  WAREHOUSE_CHECKLIST: 'Warehouse Checklist',
  VENDOR_INVOICE: 'Vendor Invoice',
  BROKER_ID: 'Broker ID',
  PATENT_VAT: 'Patent & VAT',
};

export interface DocumentRow {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  category: DocumentCategory;
  statusLabel: string | null;
  shipmentId: string | null;
  shipmentReference: string | null;
  clientId: string | null;
  clientName: string | null;
  creditNoteId: string | null;
  recordSummaryId: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

/* ------------------------------ Operations ------------------------------ */

export const declarationRegisterQuerySchema = paginationQuerySchema.extend({
  clientId: z.string().uuid().optional(),
  direction: z.enum(['IMPORT', 'EXPORT']).optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  ledger: z.enum(['with', 'without']).optional(),
});

export interface DeclarationRegisterRow {
  id: string;
  /** Null = pending (an air shipment's, before customs numbers it). */
  declareNo: string | null;
  declareDate: string;
  portCode: string | null;
  shipmentId: string;
  shipmentReference: string;
  hblNo: string | null;
  clientCode: string;
  direction: 'IMPORT' | 'EXPORT';
  clearanceStatus: string;
  ledgerId: string | null;
  invNo: string | null;
  documents: number;
  cdcLines: number;
}

/* ------------------------------ Quotations ------------------------------ */

export const quotationInputSchema = z.object({
  templateKey: z.string().min(1, 'Choose a service category'),
  clientId: optUuid,
  toName: z.string().trim().min(2, 'Who is the quotation for?').max(200),
  attn: optText(120),
  quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date'),
  paymentTermDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(365)
    .nullish()
    .transform((v) => v ?? null),
  latePenaltyPctPerDay: decimal(3, { min: 0 }),
  notes: optText(4000),
  /** One object per row: column key → displayed text ("As per receipt", "60", "5/10/15"). */
  lines: z.array(z.record(z.string().max(300))).min(1, 'Add at least one row'),
});
export type QuotationInput = z.input<typeof quotationInputSchema>;

export const quotationListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(QUOTATION_STATUSES).optional(),
  clientId: z.string().uuid().optional(),
  templateKey: z.string().optional(),
  latestOnly: boolParam,
});

export interface QuotationTemplate {
  key: string;
  label: string;
  docTitle: string;
  columns: { key: string; label: string; type: 'wide' | 'text' | 'num' | 'remark' }[];
  defaultRows: string[][];
  notes: string | null;
}

export interface QuotationRow {
  id: string;
  quoteNo: string;
  version: number;
  status: QuotationStatus;
  templateKey: string;
  templateLabel: string;
  clientId: string | null;
  clientName: string | null;
  toName: string;
  quoteDate: string;
  lineCount: number;
  isLatest: boolean;
}

export interface QuotationDetail extends Omit<QuotationRow, 'lineCount' | 'isLatest'> {
  attn: string | null;
  paymentTermDays: number | null;
  latePenaltyPctPerDay: string | null;
  notes: string | null;
  docTitle: string;
  columns: QuotationTemplate['columns'];
  lines: Record<string, string>[];
  versions: { id: string; version: number; status: QuotationStatus; quoteDate: string }[];
}

/* ------------------------------ Settings ------------------------------ */

export const companyBankSchema = z.object({
  bankName: z.string().trim().min(1, 'Enter the bank').max(120),
  accountName: optText(200),
  accountNo: z.string().trim().min(1, 'Enter the account number').max(60),
});

export const companySchema = z.object({
  nameEn: z.string().trim().min(2).max(200),
  nameKm: optText(200),
  vattin: optText(40),
  addressEn: optText(400),
  addressKm: optText(400),
  phone: optText(60),
  /** Legacy single account, kept in step with banks[0] for older readers. */
  bankName: optText(120),
  bankAccountName: optText(200),
  bankAccountNo: optText(60),
  /** Every account clients can pay into, in print order. */
  banks: z.array(companyBankSchema).max(10).optional(),
});
export type CompanyInput = z.input<typeof companySchema>;

/**
 * The company's bank accounts, in print order: the `banks` list, or the one legacy account
 * saved before the list existed.
 */
export function companyBanks(c: {
  banks?: { bankName?: string | null; accountName?: string | null; accountNo?: string | null }[];
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
}): { bankName: string; accountName: string; accountNo: string }[] {
  const list = c.banks?.length
    ? c.banks
    : [{ bankName: c.bankName, accountName: c.bankAccountName, accountNo: c.bankAccountNo }];
  return list
    .map((b) => ({
      bankName: b.bankName ?? '',
      accountName: b.accountName ?? '',
      accountNo: b.accountNo ?? '',
    }))
    .filter((b) => b.bankName || b.accountName || b.accountNo);
}

export const exchangeRateInputSchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date'),
  usdToKhr: decimal(4, { min: 1, allowEmpty: false }),
});
export const exchangeRateUpdateSchema = exchangeRateInputSchema.partial();

/** Result of importing dated rates from a spreadsheet (preview with dryRun, then apply). */
export interface ExchangeRateImportResult {
  dryRun: boolean;
  /** Dates found in the file, one rate each. */
  rates: { effectiveDate: string; usdToKhr: string; status: 'new' | 'changed' | 'same' }[];
  created: number;
  updated: number;
  unchanged: number;
  skipped: { sheet: string; row: number; message: string }[];
}

export const portInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,8}$/, '3–8 letters/digits, e.g. SHV11'),
  customsPortNo: optText(10),
  name: z.string().trim().min(2).max(120),
  shortName: z.string().trim().toUpperCase().min(2).max(30),
  kind: z.enum(PORT_KINDS),
  isActive: z.boolean().default(true),
});
export const forwarderUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  contactEmail: optText(200),
  isActive: z.boolean().optional(),
});
export const consigneeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  clientId: optUuid,
  countryIso2: optText(2),
  address: optText(400),
  isActive: z.boolean().optional(),
});
export const lookupValueInputSchema = z.object({
  type: z.enum(LOOKUP_TYPES),
  value: z.string().trim().min(1).max(80),
  label: optText(120),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});

/** Last fetch of the official rate from the MEF open-data API (auto or "Update now"). */
export interface ExchangeRateSyncStatus {
  at: string; // ISO timestamp of the attempt
  trigger: 'auto' | 'manual';
  ok: boolean;
  /** The rate's own date (MEF "valid_date"), its value, and what happened to our list. */
  effectiveDate?: string;
  usdToKhr?: string;
  result?: 'new' | 'changed' | 'same';
  error?: string;
}

/* ---------- Fuel & precious-metal prices (Settings → Rates) ---------- */

/** Last automatic or manual fetch of fuel or metal prices. */
export interface MarketSyncStatus {
  at: string; // ISO timestamp of the attempt
  trigger: 'auto' | 'manual';
  ok: boolean;
  /** Rows the fetch added / changed (0 + 0 = already up to date). */
  added?: number;
  updated?: number;
  error?: string;
}

export const METAL_SYMBOLS = ['XAU', 'XAG', 'XPT'] as const;
export type MetalSymbol = (typeof METAL_SYMBOLS)[number];
export const METAL_LABEL: Record<MetalSymbol, string> = {
  XAU: 'Gold',
  XAG: 'Silver',
  XPT: 'Platinum',
};
/** Grams per troy ounce, and the Cambodian gold weights (1 chi = 3.75 g, 1 damlung = 10 chi). */
export const GRAMS_PER_TROY_OZ = 31.1034768;
export const GRAMS_PER_CHI = 3.75;
export const GRAMS_PER_DAMLUNG = 37.5;

/** Retail fuel price ceiling set by the Ministry of Commerce, in riel per litre. */
export interface FuelPriceRow {
  id: string;
  startDate: string;
  endDate: string | null;
  gasoline92: string;
  gasoil: string;
  sourceLink: string | null;
  source: 'MEF' | 'manual';
}

export interface MetalQuote {
  symbol: MetalSymbol;
  /** Latest international spot price (USD per troy ounce) and the day before it, if known. */
  latest: { usdPerOz: string; priceDate: string; fetchedAt: string } | null;
  previous: { usdPerOz: string; priceDate: string } | null;
}

export interface MarketPrices {
  /** Newest period first. */
  fuel: FuelPriceRow[];
  fuelSync: MarketSyncStatus | null;
  /** False when the server has automatic updates turned off (FUEL_PRICE_SYNC=false). */
  fuelAutoSync: boolean;
  metals: MetalQuote[];
  metalSync: MarketSyncStatus | null;
  metalAutoSync: boolean;
  /** Latest dated USD→KHR rate, for showing metal prices in riel. */
  usdToKhr: string | null;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
export const fuelPriceInputSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || null),
    gasoline92: decimal(0, { min: 1, allowEmpty: false }),
    gasoil: decimal(0, { min: 1, allowEmpty: false }),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'The end date is before the start date',
    path: ['endDate'],
  });
export type FuelPriceInput = z.input<typeof fuelPriceInputSchema>;

/** A Cambodian public holiday: document issue dates skip it, like a weekend. */
export const publicHolidayInputSchema = z.object({
  holidayDate: isoDate,
  name: z.string().trim().min(2, 'Enter the holiday name').max(120),
  nameKh: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  note: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
});
export type PublicHolidayInput = z.input<typeof publicHolidayInputSchema>;
export interface PublicHoliday {
  id: string;
  holidayDate: string;
  name: string;
  nameKh: string | null;
  note: string | null;
}

/** Settings → Invoice Management: the VAT percent in force from a date. */
export const vatRateInputSchema = z.object({
  effectiveDate: isoDate,
  percent: z.coerce
    .number({ invalid_type_error: 'Enter the VAT percent' })
    .min(0, 'The VAT percent cannot be below 0')
    .max(100, 'The VAT percent cannot be over 100')
    .multipleOf(0.01, 'Use at most 2 decimals'),
  note: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
});
export type VatRateInput = z.input<typeof vatRateInputSchema>;

export interface SettingsBundle {
  company: CompanyInput;
  baseExchangeRate: number;
  exchangeRates: { id: string; effectiveDate: string; usdToKhr: string }[];
  exchangeRateSync: ExchangeRateSyncStatus | null;
  /** False when the server has automatic updates turned off (EXCHANGE_RATE_SYNC=false). */
  exchangeRateAutoSync: boolean;
  ports: {
    id: string;
    code: string;
    customsPortNo: string | null;
    name: string;
    shortName: string;
    kind: PortKind;
    isActive: boolean;
    shipments: number;
  }[];
  forwarders: {
    id: string;
    code: string;
    name: string;
    contactEmail: string | null;
    isActive: boolean;
    shipments: number;
  }[];
  consignees: {
    id: string;
    name: string;
    clientId: string | null;
    countryIso2: string | null;
    address: string | null;
    isActive: boolean;
    shipments: number;
  }[];
  lookupValues: {
    id: string;
    type: LookupType;
    value: string;
    label: string;
    sortOrder: number;
    isActive: boolean;
  }[];
}
