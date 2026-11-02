import {
  pgTable,
  text,
  uuid,
  char,
  date,
  integer,
  index,
  uniqueIndex,
  check,
  pgView,
  numeric,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  id,
  timestamps,
  softDelete,
  money,
  rate,
  qty,
  directionEnum,
  transportModeEnum,
  loadTypeEnum,
  shipmentStatusEnum,
  clearanceStatusEnum,
  containerSizeEnum,
  cutStockCategoryEnum,
} from './_common';
import type { CoBreakdownInput, CoStatus } from '@gs/shared';
import { users } from './auth';
import { clients, consignees, forwarders, ports, countries } from './reference';

/** The Shipping Plan record. */
export const shipments = pgTable(
  'shipments',
  {
    id: id(),
    /** Human reference, e.g. SHP-26-0001 (allocated from number_sequences). */
    reference: text('reference').notNull().unique(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    direction: directionEnum('direction').notNull(),
    transportMode: transportModeEnum('transport_mode').notNull(),
    loadType: loadTypeEnum('load_type').notNull(),
    status: shipmentStatusEnum('status').notNull().default('PENDING'),
    clearanceStatus: clearanceStatusEnum('clearance_status').notNull().default('PENDING'),

    // Parties
    shipperName: text('shipper_name'),
    consigneeId: uuid('consignee_id').references(() => consignees.id, { onDelete: 'set null' }),
    forwarderId: uuid('forwarder_id').references(() => forwarders.id, { onDelete: 'set null' }),
    broker: text('broker'),

    // Routing
    clearancePortId: uuid('clearance_port_id').references(() => ports.id, { onDelete: 'restrict' }),
    /** Import: country of origin. Export: destination country. */
    originCountryIso2: char('origin_country_iso2', { length: 2 }).references(() => countries.iso2),
    destinationCountryIso2: char('destination_country_iso2', { length: 2 }).references(
      () => countries.iso2,
    ),
    etdPort: text('etd_port'),

    // Cargo summary
    quantity: qty('quantity'),
    quantityUnit: text('quantity_unit'), // ROLLS, PKGS, CTNS…
    material: text('material'),
    /** Incoterms 2020 rule (EXW, FOB, CIF…). */
    incoterm: text('incoterm'),

    // Booking / BL / vessel
    bookingNo: text('booking_no'),
    hblNo: text('hbl_no'),
    vesselName: text('vessel_name'),
    voyageNo: text('voyage_no'),

    // Dates (calendar dates; no time zone)
    crd: date('crd'),
    etd: date('etd'),
    atd: date('atd'),
    eta: date('eta'),
    /** Actual arrival — used for forwarder on-time %. */
    ata: date('ata'),
    arriveFty: date('arrive_fty'),
    /** The day the shipping documents (INV, PL…) were received. */
    receivedDocumentDate: date('received_document_date'),
    /** Import: the date of the delivery order (DO / EDO). */
    doDate: date('do_date'),
    // An export by air: its flight (the flight date is the ETD), check-in and cut-off.
    flightNo: text('flight_no'),
    checkInDate: date('check_in_date'),
    cutOffDate: date('cut_off_date'),

    // Invoice / THC (shown as "INVOICE / THC No.")
    thcHblNo: text('thc_hbl_no'),
    thcHblDate: date('thc_hbl_date'),
    thcHblAmount: money('thc_hbl_amount'),

    // Certificate of origin
    coForm: text('co_form'),
    coNumber: text('co_number'),
    coStatus: text('co_status'),

    /** Job workflow (see @gs/shared workflow.ts). Null = the direction's first stage. */
    workflowStage: text('workflow_stage'),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }),
    /** Exports: what the customer booked, compared with the final packing list. */
    bookedQty: qty('booked_qty'),
    bookedGrossWeightKg: qty('booked_gross_weight_kg'),
    bookedCbm: qty('booked_cbm'),
    /** Exports: what the CFS / warehouse measured, compared with what was declared and billed. */
    measuredCbm: qty('measured_cbm'),
    measuredGrossWeightKg: qty('measured_gross_weight_kg'),

    remark: text('remark'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('shipments_client_status_eta_dir_idx').on(t.clientId, t.status, t.eta, t.direction),
    index('shipments_eta_idx').on(t.eta),
    index('shipments_status_idx').on(t.status),
    index('shipments_direction_eta_idx').on(t.direction, t.eta),
    index('shipments_forwarder_idx').on(t.forwarderId),
    index('shipments_clearance_port_idx').on(t.clearancePortId),
    index('shipments_hbl_idx').on(t.hblNo),
    index('shipments_workflow_stage_idx').on(t.workflowStage),
    index('shipments_active_idx')
      .on(t.eta)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const containers = pgTable(
  'containers',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    containerNo: text('container_no').notNull(),
    size: containerSizeEnum('size'),
    linerSeal: text('liner_seal'),
    customsSeal: text('customs_seal'),
    /** Plate no. of the truck carrying the container (truck shipments). */
    truckNo: text('truck_no'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('containers_shipment_idx').on(t.shipmentId),
    index('containers_no_idx').on(t.containerNo),
    uniqueIndex('containers_shipment_no_unique').on(t.shipmentId, t.containerNo),
  ],
);

/**
 * Seal Plans: trucking and loading details of an export container. Keyed by container no., not
 * the containers row, because saving a shipment replaces its container rows. A plan started
 * blank has no shipment and keeps its own factory, SO no., port, vessel, ETD, size and seals.
 */
export const containerSealPlans = pgTable(
  'container_seal_plans',
  {
    id: id(),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'cascade' }),
    containerNo: text('container_no').notNull(),
    // Only for a plan without a shipment (the shipment's values are used otherwise).
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
    bookingNo: text('booking_no'),
    portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
    vesselName: text('vessel_name'),
    etd: date('etd'),
    size: containerSizeEnum('size'),
    linerSeal: text('liner_seal'),
    customsSeal: text('customs_seal'),
    /** Shipping line, e.g. MAERSK, COSCO (the shipment's forwarder is the agent). */
    carrier: text('carrier'),
    /** Port or city of discharge, e.g. LOS ANGELES, CA. */
    destination: text('destination'),
    tareWeightKg: qty('tare_weight_kg'),
    truckBy: text('truck_by'),
    driverPhone: text('driver_phone'),
    truckNo: text('truck_no'),
    deliverTo: text('deliver_to'),
    /** Date the container is delivered to the factory for loading; sets its Seal Plan month. */
    loadingDate: date('loading_date'),
    depot: text('depot'),
    other: text('other'),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('container_seal_plans_shipment_no_unique').on(t.shipmentId, t.containerNo),
    index('container_seal_plans_client_idx').on(t.clientId),
    check(
      'container_seal_plans_has_factory',
      sql`shipment_id IS NOT NULL OR client_id IS NOT NULL`,
    ),
  ],
);

/** Commercial (cargo) invoices of a shipment — the "Cargo, Pricing & FOB" section. */
export const cargoInvoices = pgTable(
  'cargo_invoices',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    invoiceNo: text('invoice_no').notNull(),
    invoiceDate: date('invoice_date'),
    description: text('description'),
    /** Imports: packages on the invoice (QTY PKGS of the import schedule). */
    packages: qty('packages'),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cargo_invoices_invoice_no_unique').on(sql`upper(${t.invoiceNo})`),
    index('cargo_invoices_shipment_idx').on(t.shipmentId),
  ],
);

export const cargoInvoiceLines = pgTable(
  'cargo_invoice_lines',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => cargoInvoices.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    poNo: text('po_no'),
    styleNo: text('style_no'),
    htsCode: text('hts_code'),
    /** Imports: CDC group, item no. on the client's CDC master list and its unit (MTR, SET…). */
    material: text('material'),
    cdcNo: text('cdc_no'),
    unit: text('unit'),
    pcs: qty('pcs').notNull().default('0'),
    ctns: qty('ctns').notNull().default('0'),
    cbm: qty('cbm').notNull().default('0'),
    netWeightKg: qty('net_weight_kg').notNull().default('0'),
    grossWeightKg: qty('gross_weight_kg').notNull().default('0'),
    fobUnitPrice: rate('fob_unit_price').notNull().default('0'),
    /** PCS × FOB price, rounded to cents — computed by PostgreSQL. */
    fobAmount: numeric('fob_amount', { precision: 16, scale: 2 }).generatedAlwaysAs(
      sql`round(pcs * fob_unit_price, 2)`,
    ),
    description: text('description'),
    /** Imports: the CDC master-list item `cdc_no` names. Its PCS reduce the item's balance. */
    cutStockItemId: uuid('cut_stock_item_id').references(() => cutStockItems.id, {
      onDelete: 'restrict',
    }),
    /** Set when a Manager/Admin allowed this line to push the balance below zero. */
    overrideReason: text('override_reason'),
    overrideById: uuid('override_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('cargo_invoice_lines_invoice_idx').on(t.invoiceId),
    index('cargo_invoice_lines_item_idx').on(t.cutStockItemId),
    uniqueIndex('cargo_invoice_lines_invoice_line_unique').on(t.invoiceId, t.lineNo),
    check(
      'cargo_invoice_lines_non_negative',
      sql`pcs >= 0 AND ctns >= 0 AND cbm >= 0 AND fob_unit_price >= 0`,
    ),
    check(
      'cargo_invoice_lines_override_complete',
      sql`(override_reason IS NULL) = (override_by_id IS NULL)`,
    ),
  ],
);

/**
 * CO → CO Plans: the certificate of origin of an export invoice, and its GSP cost breakdown.
 * The invoice's row (qty, amount, dates…) comes from the shipment; only what is typed on the
 * CO pages is kept here. An invoice without a row shows the shipment's CO form as a draft.
 */
export const coRecords = pgTable(
  'co_records',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .unique()
      .references(() => cargoInvoices.id, { onDelete: 'cascade' }),
    /** CO form, e.g. CRF, AB, A. */
    form: text('form'),
    coNo: text('co_no'),
    coDate: date('co_date'),
    status: text('status').$type<CoStatus>().notNull().default('PENDING'),
    remark: text('remark'),
    breakdown: jsonb('breakdown').$type<CoBreakdownInput>(),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [check('co_records_status', sql`status IN ('PENDING', 'DRAFT', 'SUBMIT', 'APPROVE')`)],
);

/** A customs declaration (e.g. "I 122050"). One shipment can have several. */
export const customsDeclarations = pgTable(
  'customs_declarations',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    /** Null = pending: an air shipment's declaration dated before customs numbers it. */
    declareNo: text('declare_no').unique(),
    declareDate: date('declare_date').notNull(),
    portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('customs_declarations_shipment_idx').on(t.shipmentId),
    index('customs_declarations_date_idx').on(t.declareDate),
  ],
);

/** CDC master list item (one list per client). */
export const cutStockItems = pgTable(
  'cut_stock_items',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    lineNo: integer('line_no').notNull(),
    /** "Declare" column of the master list, e.g. I-1, III-195. */
    declareRef: text('declare_ref').notNull(),
    category: cutStockCategoryEnum('category').notNull(),
    name: text('name').notNull(),
    newOrUsed: text('new_or_used'),
    unit: text('unit').notNull(),
    qty: qty('qty').notNull(),
    unitPrice: rate('unit_price').notNull().default('0'),
    remarks: text('remarks'),
    /** Imported quantity/value/N.W brought over from the spreadsheet (before this system). */
    openingImportedQty: qty('opening_imported_qty').notNull().default('0'),
    openingImportedValue: money('opening_imported_value').notNull().default('0'),
    openingImportedNw: qty('opening_imported_nw').notNull().default('0'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('cut_stock_items_client_ref_unique').on(t.clientId, t.declareRef),
    uniqueIndex('cut_stock_items_client_name_unique').on(t.clientId, sql`upper(${t.name})`),
    index('cut_stock_items_client_idx').on(t.clientId),
    check('cut_stock_items_qty_non_negative', sql`qty >= 0`),
  ],
);

/**
 * Legacy: a cut-stock quantity entered on a customs declaration. No longer written or counted;
 * the balance now comes from import invoice items (cargo_invoice_lines.cut_stock_item_id).
 */
export const cdcLines = pgTable(
  'cdc_lines',
  {
    id: id(),
    declarationId: uuid('declaration_id')
      .notNull()
      .references(() => customsDeclarations.id, { onDelete: 'cascade' }),
    cutStockItemId: uuid('cut_stock_item_id')
      .notNull()
      .references(() => cutStockItems.id, { onDelete: 'restrict' }),
    qty: qty('qty').notNull(),
    unitPrice: rate('unit_price').notNull().default('0'),
    netWeightKg: qty('net_weight_kg').notNull().default('0'),
    /** Set when a Manager/Admin allowed this line to push the balance below zero. */
    overrideReason: text('override_reason'),
    overrideById: uuid('override_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('cdc_lines_declaration_idx').on(t.declarationId),
    index('cdc_lines_item_idx').on(t.cutStockItemId),
    check('cdc_lines_qty_positive', sql`qty > 0`),
    check('cdc_lines_override_complete', sql`(override_reason IS NULL) = (override_by_id IS NULL)`),
  ],
);

/**
 * Live balance per item (created by a hand-written migration):
 *   imported = opening + Σ PCS of import invoice items on live shipments ; balance = qty − imported ;
 *   condition = CHECK when balance / qty < 50% (or qty = 0).
 */
export const cutStockBalances = pgView('cut_stock_balances', {
  itemId: uuid('item_id').notNull(),
  clientId: uuid('client_id').notNull(),
  importedQty: qty('imported_qty').notNull(),
  importedValue: money('imported_value').notNull(),
  importedNw: qty('imported_nw').notNull(),
  balance: qty('balance').notNull(),
  balancePct: numeric('balance_pct'),
  condition: text('condition').notNull(),
}).existing();
