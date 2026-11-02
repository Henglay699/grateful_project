import { z } from 'zod';
import { CLIENT_STATUSES, type ClientStatus, type Direction, type ShipmentStatus } from '../enums';
import { paginationQuerySchema } from './common';
import { decimal, optDate, optText } from './fields';

export const clientInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, '2–6 letters or digits, e.g. JR'),
  name: z.string().trim().min(2, 'Enter the company name').max(120),
  legalName: optText(200),
  legalNameKm: optText(200),
  countryIso2: z.string().trim().toUpperCase().length(2, 'Choose a country'),
  address: optText(400),
  addressKm: optText(400),
  vattin: optText(40),
  contactName: optText(120),
  contactEmail: z
    .string()
    .trim()
    .email('Enter a valid email')
    .nullish()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  contactPhone: optText(40),
  cdcNo: optText(60),
  cdcIssueDate: optDate,
  /** When the master list (or its latest extension) stops being valid. */
  cdcValidUntil: optDate,
  /** Customs letter that extended the master list, and the customs department's note date. */
  cdcExtensionLetterNo: optText(40),
  cdcCustomsNoteDate: optDate,
  /** Company phone printed on the customs letters. */
  companyPhone: optText(40),
  commissionUsd: decimal(2, { min: 0, allowEmpty: false }),
  status: z.enum(CLIENT_STATUSES).default('ACTIVE'),
});
export type ClientInput = z.input<typeof clientInputSchema>;
export type ClientInputParsed = z.output<typeof clientInputSchema>;

export const clientListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CLIENT_STATUSES).optional(),
});

export interface ClientListItem {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  countryIso2: string;
  countryName: string;
  status: ClientStatus;
  commissionUsd: string;
  shipmentCount: number;
  activeShipments: number;
  lastEta: string | null;
  /** Only returned to roles with accounting:read. */
  netProfitYtd?: string;
}

export interface ClientDetail extends ClientListItem {
  legalNameKm: string | null;
  address: string | null;
  addressKm: string | null;
  vattin: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  cdcNo: string | null;
  cdcIssueDate: string | null;
  cdcValidUntil: string | null;
  cdcExtensionLetterNo: string | null;
  cdcCustomsNoteDate: string | null;
  companyPhone: string | null;
  createdAt: string;
  importCount: number;
  exportCount: number;
  cutStockItems: number;
  consignees: { id: string; name: string; countryIso2: string | null; address: string | null }[];
  /**
   * Shipper names on the client's shipments plus suppliers added by hand, with their address.
   * `id` is null for a shipper name that has no supplier record (no address) yet.
   */
  suppliers: { id: string | null; name: string; address: string | null }[];
  recentShipments: {
    id: string;
    reference: string;
    direction: Direction;
    status: ShipmentStatus;
    eta: string | null;
    invoiceNos: string[];
  }[];
}

/** Client Details → Remarks: a note under a subject (a login link, a password, anything). */
export const clientNoteInputSchema = z.object({
  subject: z.string().trim().min(1, 'Enter a subject').max(120),
  body: z.string().trim().max(4000).default(''),
  /** Passwords and the like: the text shows only when someone clicks Show. */
  hidden: z.boolean().default(false),
});
export type ClientNoteInput = z.input<typeof clientNoteInputSchema>;

export interface ClientNote {
  id: string;
  subject: string;
  body: string;
  hidden: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

/** A client's supplier (import shipper): its name and the address under it on the letterhead. */
export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter the supplier name').max(200),
  address: optText(500),
});
export type SupplierInput = z.input<typeof supplierInputSchema>;

/** A consignee's address (printed on the export INV + PL). */
export const consigneeAddressSchema = z.object({ address: optText(500) });
export type ConsigneeAddressInput = z.input<typeof consigneeAddressSchema>;

/** Client Details → Consignees → "+ Add": a consignee for this client, with its address. */
export const clientConsigneeInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter the consignee name').max(160),
  address: optText(500),
});
export type ClientConsigneeInput = z.input<typeof clientConsigneeInputSchema>;
