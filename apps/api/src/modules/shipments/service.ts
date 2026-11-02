import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  hasPermission,
  type Incoterm,
  type OverImportViolation,
  type Paginated,
  type Permission,
  type ShipmentDetail,
  type ShipmentInputParsed,
  type ShipmentListItem,
} from '@gs/shared';
import { CLOSED_STAGE, EXPORT_STAGES, IMPORT_STAGES, currentStageKey } from '@gs/shared';
import type { Request } from 'express';
import { db, type Tx } from '../../db/client';
import {
  accountingRecords,
  cargoInvoiceLines,
  cargoInvoices,
  clients,
  consignees,
  containers,
  customsDeclarations,
  cutStockItems,
  forwarders,
  ports,
  shipments,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { AppError, businessRule, conflict, forbidden, notFound } from '../../lib/errors';
import {
  likePattern,
  orderBy,
  paginate,
  queryRows,
  toPaginated,
  whereAll,
} from '../../lib/listing';
import { formatNumber, nextNumber } from '../../lib/numbering';
import { applyClearanceDate } from '../accounting/docs';
import { clearanceDate, periodDate, shipmentDate, shipmentDateOf } from '../../lib/shipmentDate';

/* ============================== List ============================== */

export interface ShipmentFilters {
  clientId?: string[] | undefined;
  direction?: string | undefined;
  status?: string[] | undefined;
  /** Workflow stage keys; "OPEN" = every stage but Closed. */
  stage?: string[] | undefined;
  transportMode?: string | undefined;
  loadType?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  month?: string | undefined;
  q?: string | undefined;
}

export function shipmentWhere(f: ShipmentFilters) {
  const conds = [sql`s.deleted_at IS NULL`];
  if (f.clientId?.length)
    conds.push(
      sql`s.client_id IN (${sql.join(
        f.clientId.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  if (f.direction) conds.push(sql`s.direction = ${f.direction}`);
  if (f.status?.length)
    conds.push(
      sql`s.status IN (${sql.join(
        f.status.map((x) => sql`${x}`),
        sql`, `,
      )})`,
    );
  if (f.stage?.length) {
    const open = f.stage.includes('OPEN');
    const keys = f.stage.filter((x) => x !== 'OPEN');
    const stageSql = sql`coalesce(s.workflow_stage, CASE WHEN s.direction = 'IMPORT' THEN ${IMPORT_STAGES[0]!.key} ELSE ${EXPORT_STAGES[0]!.key} END)`;
    const parts = [];
    if (open) parts.push(sql`${stageSql} <> ${CLOSED_STAGE}`);
    if (keys.length) parts.push(sql`${stageSql} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  if (f.transportMode) conds.push(sql`s.transport_mode = ${f.transportMode}`);
  if (f.loadType) conds.push(sql`s.load_type = ${f.loadType}`);
  // An import by its ETA, an export by its ETD.
  if (f.from) conds.push(sql`${shipmentDate()} >= ${f.from}::date`);
  if (f.to) conds.push(sql`${shipmentDate()} <= ${f.to}::date`);
  // By the first declare date (the Clearance Date column); undeclared shipments drop out.
  if (f.month) conds.push(sql`to_char(${periodDate()}, 'YYYY-MM') = ${f.month}`);
  if (f.q) {
    const like = likePattern(f.q);
    conds.push(sql`(s.reference ILIKE ${like} OR s.hbl_no ILIKE ${like} OR s.booking_no ILIKE ${like} OR c.code ILIKE ${like}
      OR EXISTS (SELECT 1 FROM containers x WHERE x.shipment_id = s.id AND x.container_no ILIKE ${like})
      OR EXISTS (SELECT 1 FROM cargo_invoices x WHERE x.shipment_id = s.id AND x.invoice_no ILIKE ${like})
      OR EXISTS (SELECT 1 FROM customs_declarations x WHERE x.shipment_id = s.id AND x.declare_no ILIKE ${like}))`);
  }
  return whereAll(conds);
}

const listSelect = (extra: SQL = sql``) => sql`
  SELECT s.id, s.reference, s.client_id AS "clientId", c.code AS "clientCode", c.name AS "clientName",
         s.direction, s.transport_mode AS "transportMode", s.load_type AS "loadType", s.status, s.clearance_status AS "clearanceStatus",
         coalesce(s.workflow_stage, CASE WHEN s.direction = 'IMPORT' THEN ${IMPORT_STAGES[0]!.key} ELSE ${EXPORT_STAGES[0]!.key} END) AS "workflowStage",
         s.quantity::text AS quantity, s.quantity_unit AS "quantityUnit",
         to_char(s.eta, 'YYYY-MM-DD') AS eta, to_char(s.ata, 'YYYY-MM-DD') AS ata, to_char(s.etd, 'YYYY-MM-DD') AS etd,
         to_char(s.atd, 'YYYY-MM-DD') AS atd, to_char(s.crd, 'YYYY-MM-DD') AS crd, to_char(s.arrive_fty, 'YYYY-MM-DD') AS "arriveFty",
         f.name AS "forwarderName", p.name AS "clearancePortName", p.short_name AS "clearancePortShortName", s.etd_port AS "etdPort", s.hbl_no AS "hblNo", s.booking_no AS "bookingNo",
         cn.name AS "consigneeName", ctry.name AS "countryName", s.vessel_name AS "vesselName", s.voyage_no AS "voyageNo",
         s.co_form AS "coForm", s.co_number AS "coNumber", s.co_status AS "coStatus", s.thc_hbl_no AS "thcHblNo",
         to_char(s.thc_hbl_date, 'YYYY-MM-DD') AS "thcHblDate", s.thc_hbl_amount::text AS "thcHblAmount", s.remark,
         coalesce(inv.invoice_nos, '{}') AS "invoiceNos", to_char(inv.invoice_date, 'YYYY-MM-DD') AS "invoiceDate",
         coalesce(ct.items, '[]'::json) AS containers, coalesce(dc.items, '[]'::json) AS declarations,
         json_build_object('pcs', tot.pcs::text, 'ctns', tot.ctns::text, 'cbm', tot.cbm::text, 'netWeightKg', tot.nw::text,
                           'grossWeightKg', tot.gw::text, 'fob', tot.fob::text) AS totals,
         fl.first_line AS "firstLine"
         ${extra}
  FROM shipments s
  JOIN clients c ON c.id = s.client_id
  LEFT JOIN forwarders f ON f.id = s.forwarder_id
  LEFT JOIN ports p ON p.id = s.clearance_port_id
  LEFT JOIN consignees cn ON cn.id = s.consignee_id
  LEFT JOIN countries ctry ON ctry.iso2 = CASE WHEN s.direction = 'IMPORT' THEN s.origin_country_iso2 ELSE s.destination_country_iso2 END
  LEFT JOIN LATERAL (SELECT array_agg(invoice_no ORDER BY sort_order) AS invoice_nos, min(invoice_date) AS invoice_date
                     FROM cargo_invoices WHERE shipment_id = s.id) inv ON true
  LEFT JOIN LATERAL (SELECT json_agg(json_build_object('containerNo', container_no, 'size', size, 'linerSeal', liner_seal,
                       'customsSeal', customs_seal) ORDER BY sort_order) AS items FROM containers WHERE shipment_id = s.id) ct ON true
  LEFT JOIN LATERAL (SELECT json_agg(json_build_object('declareNo', declare_no, 'declareDate', declare_date) ORDER BY declare_date) AS items
                     FROM customs_declarations WHERE shipment_id = s.id) dc ON true
  LEFT JOIN LATERAL (SELECT coalesce(sum(l.pcs), 0) AS pcs, coalesce(sum(l.ctns), 0) AS ctns, coalesce(sum(l.cbm), 0) AS cbm,
                            coalesce(sum(l.net_weight_kg), 0) AS nw, coalesce(sum(l.gross_weight_kg), 0) AS gw,
                            coalesce(sum(l.fob_amount), 0) AS fob
                     FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id) tot ON true
  LEFT JOIN LATERAL (SELECT json_build_object('poNo', l.po_no, 'styleNo', l.style_no, 'htsCode', l.hts_code,
                       'fobUnitPrice', l.fob_unit_price::text, 'description', coalesce(l.description, ci.description)) AS first_line
                     FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id
                     WHERE ci.shipment_id = s.id ORDER BY ci.sort_order, l.line_no LIMIT 1) fl ON true`;

const SORTS = {
  eta: sql`s.eta`,
  // Customs clearance (declaration) date: the shipment's first declaration; none → last.
  clearanceDate: clearanceDate(),
  reference: sql`s.reference`,
  status: sql`s.status`,
  client: sql`c.code`,
  createdAt: sql`s.created_at`,
  arriveFty: sql`s.arrive_fty`,
};

export async function listShipments(
  f: ShipmentFilters & { page: number; pageSize: number; sort?: string | undefined },
): Promise<Paginated<ShipmentListItem>> {
  // 1) Pick the page's ids (cheap: filters, sort and count only).
  const page = await queryRows<{ id: string; total_count: string }>(
    db,
    sql`
    SELECT s.id, count(*) OVER () AS total_count
    FROM shipments s JOIN clients c ON c.id = s.client_id
    ${shipmentWhere(f)}
    ${orderBy(f.sort, SORTS, sql`${shipmentDate()} DESC NULLS LAST, s.reference DESC`)}
    ${paginate(f.page, f.pageSize)}`,
  );
  if (!page.length) return toPaginated([], f.page, f.pageSize);
  // 2) Build the full rows (totals, containers, declarations…) for those ids only.
  const rows = await queryRows<ShipmentListItem>(
    db,
    sql`
    ${listSelect()} WHERE s.id IN (${sql.join(
      page.map((p) => sql`${p.id}::uuid`),
      sql`, `,
    )})`,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = page.map((p) => ({ ...byId.get(p.id)!, total_count: p.total_count }));
  return toPaginated(ordered, f.page, f.pageSize);
}

/** All matching rows (for Excel export), capped. */
export async function listShipmentsForExport(
  f: ShipmentFilters & { sort?: string | undefined },
  limit = 10000,
): Promise<ShipmentListItem[]> {
  return queryRows<ShipmentListItem>(
    db,
    sql`${listSelect()} ${shipmentWhere(f)} ${orderBy(f.sort, SORTS, sql`${shipmentDate()} DESC NULLS LAST`)} LIMIT ${limit}`,
  );
}

/* ============================== Detail ============================== */

/** The shipment's client (for access checks); 404 when it doesn't exist. */
export async function shipmentClientId(id: string): Promise<string> {
  const [row] = await db
    .select({ clientId: shipments.clientId })
    .from(shipments)
    .where(and(eq(shipments.id, id), isNull(shipments.deletedAt)));
  if (!row) throw notFound('Shipment');
  return row.clientId;
}

export async function getShipment(id: string): Promise<ShipmentDetail> {
  const [s] = await db
    .select({ s: shipments, clientCode: clients.code, clientName: clients.name })
    .from(shipments)
    .innerJoin(clients, eq(clients.id, shipments.clientId))
    .where(and(eq(shipments.id, id), isNull(shipments.deletedAt)));
  if (!s) throw notFound('Shipment');

  const [ctrs, invs, decls] = await Promise.all([
    db
      .select()
      .from(containers)
      .where(eq(containers.shipmentId, id))
      .orderBy(asc(containers.sortOrder)),
    db
      .select()
      .from(cargoInvoices)
      .where(eq(cargoInvoices.shipmentId, id))
      .orderBy(asc(cargoInvoices.sortOrder)),
    db
      .select()
      .from(customsDeclarations)
      .where(eq(customsDeclarations.shipmentId, id))
      .orderBy(asc(customsDeclarations.declareDate)),
  ]);
  const lines = invs.length
    ? await db
        .select()
        .from(cargoInvoiceLines)
        .where(
          inArray(
            cargoInvoiceLines.invoiceId,
            invs.map((i) => i.id),
          ),
        )
        .orderBy(asc(cargoInvoiceLines.lineNo))
    : [];
  const declIds = decls.map((d) => d.id);
  const ledger = declIds.length
    ? await db
        .select({ declarationId: accountingRecords.declarationId })
        .from(accountingRecords)
        .where(inArray(accountingRecords.declarationId, declIds))
    : [];
  const withLedger = new Set(ledger.map((l) => l.declarationId));
  const r = s.s;
  return {
    id: r.id,
    reference: r.reference,
    clientId: r.clientId,
    clientCode: s.clientCode,
    clientName: s.clientName,
    direction: r.direction,
    transportMode: r.transportMode,
    loadType: r.loadType,
    status: r.status,
    clearanceStatus: r.clearanceStatus,
    workflowStage: currentStageKey(r.direction, r.workflowStage),
    shipperName: r.shipperName,
    consigneeId: r.consigneeId,
    forwarderId: r.forwarderId,
    broker: r.broker,
    clearancePortId: r.clearancePortId,
    originCountryIso2: r.originCountryIso2,
    destinationCountryIso2: r.destinationCountryIso2,
    etdPort: r.etdPort,
    quantity: r.quantity,
    quantityUnit: r.quantityUnit,
    material: r.material,
    incoterm: r.incoterm as Incoterm | null,
    bookingNo: r.bookingNo,
    hblNo: r.hblNo,
    vesselName: r.vesselName,
    voyageNo: r.voyageNo,
    crd: r.crd,
    etd: r.etd,
    atd: r.atd,
    eta: r.eta,
    ata: r.ata,
    arriveFty: r.arriveFty,
    receivedDocumentDate: r.receivedDocumentDate,
    doDate: r.doDate,
    flightNo: r.flightNo,
    checkInDate: r.checkInDate,
    cutOffDate: r.cutOffDate,
    thcHblNo: r.thcHblNo,
    thcHblDate: r.thcHblDate,
    thcHblAmount: r.thcHblAmount,
    coForm: r.coForm,
    coNumber: r.coNumber,
    coStatus: r.coStatus,
    remark: r.remark,
    containers: ctrs.map((c) => ({
      id: c.id,
      containerNo: c.containerNo,
      size: c.size,
      linerSeal: c.linerSeal,
      customsSeal: c.customsSeal,
      truckNo: c.truckNo,
    })),
    invoices: invs.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      invoiceDate: i.invoiceDate,
      description: i.description,
      packages: i.packages,
      lines: lines
        .filter((l) => l.invoiceId === i.id)
        .map((l) => ({
          id: l.id,
          poNo: l.poNo,
          styleNo: l.styleNo,
          htsCode: l.htsCode,
          material: l.material,
          cdcNo: l.cdcNo,
          unit: l.unit,
          pcs: l.pcs,
          ctns: l.ctns,
          cbm: l.cbm,
          netWeightKg: l.netWeightKg,
          grossWeightKg: l.grossWeightKg,
          fobUnitPrice: l.fobUnitPrice,
          fobAmount: l.fobAmount ?? '0',
          description: l.description,
          cutStockItemId: l.cutStockItemId,
          overrideReason: l.overrideReason,
        })),
    })),
    declarations: decls.map((d) => ({
      id: d.id,
      declareNo: d.declareNo,
      declareDate: d.declareDate,
      portId: d.portId,
      notes: d.notes,
      hasLedgerEntry: withLedger.has(d.id),
    })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/* ============================== Write ============================== */

export interface Actor {
  userId: string;
  permissions: readonly Permission[];
}

const milli = (v: string | null | undefined) => Math.round(Number(v ?? 0) * 1000);
const fromMilli = (m: number) => (m / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';

/** Check referenced rows exist and belong together (client consignee, active client, …). */
async function assertReferences(tx: Tx, input: ShipmentInputParsed, isNew: boolean): Promise<void> {
  const [client] = await tx
    .select()
    .from(clients)
    .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)));
  if (!client) throw businessRule('The selected client does not exist');
  if (isNew && client.status === 'INACTIVE')
    throw businessRule(
      `${client.name} is inactive. Reactivate the client before adding shipments.`,
    );
  if (input.consigneeId) {
    const [c] = await tx
      .select({ id: consignees.id })
      .from(consignees)
      .where(eq(consignees.id, input.consigneeId));
    if (!c) throw businessRule('The selected consignee does not exist');
  }
  if (input.forwarderId) {
    const [f] = await tx
      .select({ id: forwarders.id })
      .from(forwarders)
      .where(eq(forwarders.id, input.forwarderId));
    if (!f) throw businessRule('The selected forwarder does not exist');
  }
  const portIds = [input.clearancePortId, ...input.declarations.map((d) => d.portId)].filter(
    (x): x is string => !!x,
  );
  if (portIds.length) {
    const found = await tx
      .select({ id: ports.id })
      .from(ports)
      .where(inArray(ports.id, [...new Set(portIds)]));
    if (found.length !== new Set(portIds).size)
      throw businessRule('A selected port does not exist');
  }
}

/** CDC numbers compare without case, spaces or dashes ("II-125" = "ii 125"). */
const cdcKey = (v: string) => v.toUpperCase().replace(/[\s\-–—_]+/g, '');

type LineStock = { cutStockItemId: string; overrideReason: string | null };

/**
 * Links each import invoice item to the client's CDC master-list item its CDC No. names, and
 * enforces "an import may not push a cut-stock balance below zero": items that would need an
 * override reason AND the cutstock:override permission. Must run after the shipment's previous
 * invoices were removed (on update) and before the new ones are written, in the same transaction.
 * Returns each line's item and approved override, keyed "invoiceIndex:lineIndex".
 */
async function checkCutStock(tx: Tx, clientId: string, input: ShipmentInputParsed, actor: Actor) {
  const out = new Map<string, LineStock>();
  if (input.direction !== 'IMPORT' || !input.invoices.some((inv) => inv.lines.some((l) => l.cdcNo)))
    return out;
  // Lock the client's items so concurrent imports are serialised.
  const items = await tx
    .select({
      id: cutStockItems.id,
      name: cutStockItems.name,
      declareRef: cutStockItems.declareRef,
    })
    .from(cutStockItems)
    .where(and(eq(cutStockItems.clientId, clientId), isNull(cutStockItems.deletedAt)))
    .for('update');
  const byKey = new Map(items.map((i) => [cdcKey(i.declareRef), i]));
  const balances = await queryRows<{ item_id: string; balance: string }>(
    tx,
    sql`
    SELECT item_id, balance::text FROM cut_stock_balances WHERE client_id = ${clientId}`,
  );
  const remaining = new Map(balances.map((b) => [b.item_id, milli(b.balance)]));

  const violations = new Map<string, OverImportViolation>();
  let needsOverridePermission = false;
  input.invoices.forEach((inv, gi) =>
    inv.lines.forEach((l, li) => {
      // A CDC No. no longer on the master list stays on the invoice but draws nothing down.
      const it = l.cdcNo ? byKey.get(cdcKey(l.cdcNo)) : undefined;
      if (!it) return;
      const before = remaining.get(it.id) ?? 0;
      const after = before - milli(l.pcs);
      remaining.set(it.id, after);
      let overrideReason: string | null = null; // an override that isn't needed is dropped
      if (after < 0 && milli(l.pcs) > 0) {
        if (l.overrideReason) {
          needsOverridePermission = true;
          overrideReason = l.overrideReason;
        } else {
          const seen = violations.get(it.id);
          violations.set(it.id, {
            cutStockItemId: it.id,
            itemName: it.name,
            declareRef: it.declareRef,
            balance: seen?.balance ?? fromMilli(before),
            requested: fromMilli(milli(seen?.requested) + milli(l.pcs)),
          });
        }
      }
      out.set(`${gi}:${li}`, { cutStockItemId: it.id, overrideReason });
    }),
  );
  if (violations.size) {
    throw new AppError(
      422,
      'BUSINESS_RULE',
      'Some invoice items exceed the remaining cut-stock balance',
      { rule: 'CUT_STOCK_OVER_IMPORT', violations: [...violations.values()] },
    );
  }
  if (needsOverridePermission && !hasPermission(actor.permissions, 'cutstock:override')) {
    throw forbidden(
      'Only a Manager or Admin can approve importing more than the remaining cut-stock balance',
    );
  }
  return out;
}

async function writeChildren(
  tx: Tx,
  shipmentId: string,
  input: ShipmentInputParsed,
  actor: Actor,
  existingDeclIds: Set<string>,
) {
  if (input.containers.length) {
    await tx
      .insert(containers)
      .values(input.containers.map((c, i) => ({ ...c, shipmentId, sortOrder: i })));
  }
  const stock = await checkCutStock(
    tx,
    (
      await tx.select({ c: shipments.clientId }).from(shipments).where(eq(shipments.id, shipmentId))
    )[0]!.c,
    input,
    actor,
  );
  for (const [i, inv] of input.invoices.entries()) {
    const [row] = await tx
      .insert(cargoInvoices)
      .values({
        shipmentId,
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate,
        description: inv.description,
        packages: inv.packages,
        sortOrder: i,
      })
      .returning({ id: cargoInvoices.id });
    await tx.insert(cargoInvoiceLines).values(
      inv.lines.map(({ overrideReason: _o, ...l }, li) => {
        const st = stock.get(`${i}:${li}`);
        return {
          ...l,
          invoiceId: row!.id,
          lineNo: li + 1,
          cutStockItemId: st?.cutStockItemId ?? null,
          overrideReason: st?.overrideReason ?? null,
          overrideById: st?.overrideReason ? actor.userId : null,
        };
      }),
    );
  }
  for (const d of input.declarations) {
    const values = {
      declareNo: d.declareNo,
      declareDate: d.declareDate,
      portId: d.portId,
      notes: d.notes,
    };
    if (d.id && existingDeclIds.has(d.id)) {
      await tx.update(customsDeclarations).set(values).where(eq(customsDeclarations.id, d.id));
    } else {
      await tx
        .insert(customsDeclarations)
        .values({ ...values, shipmentId, createdById: actor.userId });
    }
  }
}

function scalarValues(input: ShipmentInputParsed) {
  const { containers: _c, invoices: _i, declarations: _d, ...rest } = input;
  return rest;
}

/** Friendlier messages for the unique constraints users can hit. */
function mapUniqueViolation(err: unknown): never {
  const cause =
    (err as { cause?: { code?: string; constraint?: string; detail?: string } }).cause ??
    (err as { code?: string; constraint?: string; detail?: string });
  if (cause?.code === '23505') {
    const value = /\)=\((.*)\)/.exec(cause.detail ?? '')?.[1];
    if (cause.constraint === 'cargo_invoices_invoice_no_unique')
      throw conflict(
        `Invoice no. ${value ?? ''} is already used on another shipment`.replace('  ', ' '),
      );
    if (cause.constraint === 'customs_declarations_declare_no_unique')
      throw conflict(`Declaration ${value ?? ''} is already recorded on another shipment`);
  }
  throw err;
}

export async function createShipment(
  input: ShipmentInputParsed,
  actor: Actor,
  req: Request,
): Promise<string> {
  try {
    return await db.transaction(async (tx) => (await insertShipment(tx, input, actor, req)).id);
  } catch (err) {
    return mapUniqueViolation(err);
  }
}

/** Creates one shipment inside the caller's transaction (the Excel import creates many). */
export async function insertShipment(
  tx: Tx,
  input: ShipmentInputParsed,
  actor: Actor,
  req: Request,
): Promise<{ id: string; reference: string }> {
  await assertReferences(tx, input, true);
  const year = (shipmentDateOf(input) ?? new Date().toISOString()).slice(0, 4);
  const n = await nextNumber(tx, `SHIPMENT:${year}`);
  const [row] = await tx
    .insert(shipments)
    .values({
      ...scalarValues(input),
      reference: formatNumber.shipment(year.slice(2), n),
      createdById: actor.userId,
      updatedById: actor.userId,
    })
    .returning({ id: shipments.id, reference: shipments.reference });
  await writeChildren(tx, row!.id, input, actor, new Set());
  await audit(
    tx,
    {
      action: 'CREATE',
      entity: 'shipment',
      entityId: row!.id,
      after: { reference: row!.reference, ...input },
    },
    req,
  );
  return row!;
}

/** The friendly message for a duplicate invoice or declaration number (for the import). */
export const shipmentUniqueMessage = (err: unknown): string | null => {
  try {
    mapUniqueViolation(err);
  } catch (e) {
    if (e instanceof AppError) return e.message;
  }
  return null;
};

export async function updateShipment(
  id: string,
  input: ShipmentInputParsed,
  actor: Actor,
  req: Request,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(shipments)
        .where(and(eq(shipments.id, id), isNull(shipments.deletedAt)))
        .for('update');
      if (!before) throw notFound('Shipment');
      await assertReferences(tx, input, false);
      if (input.clientId !== before.clientId) {
        const [{ n } = { n: 0 }] = await queryRows<{ n: number }>(
          tx,
          sql`
          SELECT count(*)::int AS n FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id WHERE d.shipment_id = ${id}`,
        );
        if (n)
          throw conflict(
            'This shipment already has ledger entries, so its client cannot be changed',
          );
      }

      const oldDecls = await tx
        .select()
        .from(customsDeclarations)
        .where(eq(customsDeclarations.shipmentId, id));
      const keep = new Set(input.declarations.map((d) => d.id).filter((x): x is string => !!x));
      const removed = oldDecls.filter((d) => !keep.has(d.id));
      if (removed.length) {
        const ledger = await tx
          .select({ id: accountingRecords.declarationId })
          .from(accountingRecords)
          .where(
            inArray(
              accountingRecords.declarationId,
              removed.map((d) => d.id),
            ),
          );
        if (ledger.length) {
          const nos = removed
            .filter((d) => ledger.some((l) => l.id === d.id))
            .map((d) => d.declareNo)
            .join(', ');
          throw conflict(
            `Declaration ${nos} has a ledger entry in Accounting and cannot be removed here`,
          );
        }
      }
      // Replace children. The old invoices are removed (below) before the new ones are checked,
      // so their items' quantities return to the balance first.
      if (removed.length)
        await tx.delete(customsDeclarations).where(
          inArray(
            customsDeclarations.id,
            removed.map((d) => d.id),
          ),
        );
      await tx.delete(containers).where(eq(containers.shipmentId, id));
      await tx.delete(cargoInvoices).where(eq(cargoInvoices.shipmentId, id));

      await tx
        .update(shipments)
        .set({ ...scalarValues(input), updatedById: actor.userId })
        .where(eq(shipments.id, id));
      await writeChildren(
        tx,
        id,
        input,
        actor,
        new Set(oldDecls.filter((d) => keep.has(d.id)).map((d) => d.id)),
      );
      // A changed declaration (clearance) date re-dates its ledger entry and draft documents.
      for (const d of input.declarations) {
        const old = oldDecls.find((o) => o.id === d.id);
        if (old && old.declareDate !== d.declareDate) await applyClearanceDate(tx, old.id, req);
      }
      await audit(
        tx,
        { action: 'UPDATE', entity: 'shipment', entityId: id, before, after: input },
        req,
      );
    });
  } catch (err) {
    mapUniqueViolation(err);
  }
}

/**
 * Soft-deletes the shipment; its invoice items stop counting against the cut-stock balance.
 * Blocked when any declaration already has a ledger entry (accounting is the financial record).
 */
export async function deleteShipment(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(shipments)
      .where(and(eq(shipments.id, id), isNull(shipments.deletedAt)))
      .for('update');
    if (!before) throw notFound('Shipment');
    const decls = await tx
      .select({ id: customsDeclarations.id })
      .from(customsDeclarations)
      .where(eq(customsDeclarations.shipmentId, id));
    if (decls.length) {
      const ledger = await tx
        .select({ id: accountingRecords.id })
        .from(accountingRecords)
        .where(
          inArray(
            accountingRecords.declarationId,
            decls.map((d) => d.id),
          ),
        );
      if (ledger.length)
        throw conflict(
          `${before.reference} has ledger entries in Accounting. Remove those first, or set the shipment to Exception instead.`,
        );
    }
    await audit(tx, { action: 'DELETE', entity: 'shipment', entityId: id, before }, req);
    await tx.update(shipments).set({ deletedAt: new Date() }).where(eq(shipments.id, id));
  });
}

/** Which of these invoice numbers already exist on (non-deleted) shipments. */
export async function existingInvoiceNumbers(
  nos: string[],
  exceptShipmentId?: string,
): Promise<Map<string, string>> {
  if (!nos.length) return new Map();
  const rows = await queryRows<{ invoice_no: string; reference: string }>(
    db,
    sql`
    SELECT ci.invoice_no, s.reference FROM cargo_invoices ci JOIN shipments s ON s.id = ci.shipment_id
    WHERE upper(ci.invoice_no) IN (${sql.join(
      nos.map((n) => sql`${n.toUpperCase()}`),
      sql`, `,
    )}) AND s.deleted_at IS NULL
      ${exceptShipmentId ? sql`AND s.id <> ${exceptShipmentId}` : sql``}`,
  );
  return new Map(rows.map((r) => [r.invoice_no.toUpperCase(), r.reference]));
}
