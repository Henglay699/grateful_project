import {
  pgTable,
  text,
  boolean,
  integer,
  uuid,
  char,
  index,
  uniqueIndex,
  date,
  jsonb,
  doublePrecision,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  id,
  timestamps,
  softDelete,
  money,
  portKindEnum,
  clientStatusEnum,
  lookupTypeEnum,
  rate,
  khr,
  percent,
} from './_common';
import { users } from './auth';

export const countries = pgTable('countries', {
  iso2: char('iso2', { length: 2 }).primaryKey(),
  name: text('name').notNull().unique(),
  /** Approximate centroid, for map markers. */
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
});

/**
 * Merges the prototype's two port lists: the customs directory from the accounting
 * engine (port no. + code) and the "Add New" port names used in shipping plans.
 */
export const ports = pgTable(
  'ports',
  {
    id: id(),
    code: text('code').notNull().unique(), // customs code, e.g. SHV11
    customsPortNo: text('customs_port_no'), // e.g. "11", "11+"
    name: text('name').notNull(), // e.g. "Sihanoukville Port"
    shortName: text('short_name').notNull(), // chart label, e.g. "SIHANOUKVILLE"
    kind: portKindEnum('kind').notNull(),
    countryIso2: char('country_iso2', { length: 2 })
      .notNull()
      .default('KH')
      .references(() => countries.iso2),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('ports_name_unique').on(sql`lower(${t.name})`)],
);

export const forwarders = pgTable(
  'forwarders',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    contactEmail: text('contact_email'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('forwarders_name_unique').on(sql`lower(${t.name})`)],
);

export const clients = pgTable(
  'clients',
  {
    id: id(),
    /** Short code used in debit note numbers and filters: JR, JYX, VFL, SAK. */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    legalNameKm: text('legal_name_km'),
    countryIso2: char('country_iso2', { length: 2 })
      .notNull()
      .references(() => countries.iso2),
    address: text('address'),
    addressKm: text('address_km'),
    vattin: text('vattin'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    /** QIP master list (CDC) number and issue date, printed on export invoices / packing lists. */
    cdcNo: text('cdc_no'),
    cdcIssueDate: date('cdc_issue_date'),
    cdcValidUntil: date('cdc_valid_until'),
    cdcExtensionLetterNo: text('cdc_extension_letter_no'),
    cdcCustomsNoteDate: date('cdc_customs_note_date'),
    companyPhone: text('company_phone'),
    /** "CM" deducted in the monthly ledger. Prototype rule: JR = 0, others = 50. */
    commissionUsd: money('commission_usd').notNull().default('50.00'),
    status: clientStatusEnum('status').notNull().default('ACTIVE'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex('clients_name_unique').on(sql`lower(${t.name})`)],
);

export const consignees = pgTable(
  'consignees',
  {
    id: id(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    address: text('address'),
    countryIso2: char('country_iso2', { length: 2 }).references(() => countries.iso2),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('consignees_client_idx').on(t.clientId),
    uniqueIndex('consignees_name_unique').on(sql`lower(${t.name})`),
  ],
);

/**
 * A client's supplier (the shipper on its imports) with its address, printed under the name on
 * the import INV + PL letterhead. Shipments keep the shipper as free text; the name matches it
 * case-insensitively.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address'),
    /** Deleted from Client Details: left out of its list even while shipments use the name. */
    hidden: boolean('hidden').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('suppliers_client_name_unique').on(t.clientId, sql`lower(${t.name})`)],
);

/**
 * Client Details → Remarks: notes kept per client under a subject, e.g. a ministry website's
 * login link and password. A hidden note's text shows only on request (and is never audited).
 */
export const clientNotes = pgTable(
  'client_notes',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    body: text('body').notNull().default(''),
    hidden: boolean('hidden').notNull().default(false),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('client_notes_client_idx').on(t.clientId)],
);

/** Replaces the prototype's localStorage "Add New" lists for simple dropdowns. */
export const lookupValues = pgTable(
  'lookup_values',
  {
    id: id(),
    type: lookupTypeEnum('type').notNull(),
    value: text('value').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('lookup_values_type_value_unique').on(t.type, t.value)],
);

export const exchangeRates = pgTable('exchange_rates', {
  id: id(),
  effectiveDate: date('effective_date').notNull().unique(),
  usdToKhr: rate('usd_to_khr').notNull(),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/**
 * Settings → Tax Management: the VAT percent in force from each date. A document takes the
 * percent of its own date when it is made (stored in its vat_rate), so adding or changing a
 * rate here never alters documents already made.
 */
export const vatRates = pgTable('vat_rates', {
  id: id(),
  effectiveDate: date('effective_date').notNull().unique(),
  percent: percent('percent').notNull(),
  /** e.g. the Prakas or law the new rate comes from. */
  note: text('note'),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** Ministry of Commerce retail fuel price ceilings (riel per litre), one row per price period. */
export const fuelPrices = pgTable('fuel_prices', {
  id: id(),
  startDate: date('start_date').notNull().unique(),
  endDate: date('end_date'),
  gasoline92: khr('gasoline_92').notNull(),
  gasoil: khr('gasoil_50ppm').notNull(),
  sourceLink: text('source_link'),
  /** 'MEF' (open-data API) or 'manual'. */
  source: text('source').notNull().default('MEF'),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/**
 * Cambodian public holidays (Settings → Public holidays). Document issue dates skip them, as
 * they skip weekends: the issue date is the next working day after the declaration date.
 */
export const publicHolidays = pgTable('public_holidays', {
  id: id(),
  holidayDate: date('holiday_date').notNull().unique(),
  name: text('name').notNull(),
  /** The name in Khmer, as in the sub-decree. */
  nameKh: text('name_kh'),
  /** e.g. "Provisional: check against the sub-decree". */
  note: text('note'),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** International spot price per metal per day (USD per troy ounce); the day's last fetch wins. */
export const metalPrices = pgTable(
  'metal_prices',
  {
    id: id(),
    symbol: text('symbol').notNull(),
    priceDate: date('price_date').notNull(),
    usdPerOz: rate('usd_per_oz').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('metal_prices_symbol_date_unique').on(t.symbol, t.priceDate)],
);

/** Workspace settings as key → JSON value (default clearing port, company details…). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Gap-free document numbering, allocated with UPDATE … RETURNING inside the
 * transaction that creates the document. Key examples: "TAX_INVOICE:2026",
 * "DEBIT_NOTE:JR:2606".
 */
export const numberSequences = pgTable('number_sequences', {
  key: text('key').primaryKey(),
  nextValue: integer('next_value').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
