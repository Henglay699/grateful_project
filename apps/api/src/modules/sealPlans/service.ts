import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type {
  SealPlanRow,
  SealPlanShipment,
  SealPlanShipmentOption,
  SealPlanStandaloneValues,
  SealPlanValues,
} from '@gs/shared';
import type { Request } from 'express';
import { db, type Tx } from '../../db/client';
import { containerSealPlans, containers, shipments } from '../../db/schema';
import { audit } from '../../lib/audit';
import { businessRule, conflict, notFound } from '../../lib/errors';
import { likePattern, queryRows, whereAll } from '../../lib/listing';
import { assertClientAllowed, assertClientVisible, clientCondition } from '../../lib/clientScope';

/**
 * Every row: the containers of live export shipments (with their plan, if any) and the plans
 * started blank. A row's month is its loading date's, else the ETD's, else when it was added.
 */
/**
 * "Phnom Penh Port" → "Phnom Penh", as on the sheet. Other names stay whole: a dry port
 * ("Union Dry Port"), a border or an airport.
 */
const PORT_NAME = sql.raw(
  `CASE WHEN p.name ~* '\\sdry\\s+port$' THEN p.name ELSE regexp_replace(p.name, '\\s+port$', '', 'i') END`,
);

const ROWS = sql`(
  SELECT sp.id, s.id AS "shipmentId", s.reference AS "shipmentReference", c.container_no AS "containerNo",
         to_char(coalesce(sp.loading_date, s.etd, s.created_at::date), 'YYYY-MM') AS month,
         cl.id AS "clientId", cl.code AS "clientCode", cl.name AS "clientName", inv.inv_no AS "invNo",
         s.booking_no AS "bookingNo", p.id AS "portId", p.code AS "portCode", ${PORT_NAME} AS "portName",
         co.name AS "destinationCountry", s.vessel_name AS "vesselName",
         to_char(s.etd, 'YYYY-MM-DD') AS etd, c.size, c.liner_seal AS "linerSeal",
         c.customs_seal AS "customsSeal", sp.carrier, sp.destination,
         sp.tare_weight_kg AS "tareWeightKg", sp.truck_by AS "truckBy", sp.driver_phone AS "driverPhone",
         sp.truck_no AS "truckNo", sp.deliver_to AS "deliverTo",
         to_char(sp.loading_date, 'YYYY-MM-DD') AS "loadingDate", sp.depot, sp.other, c.sort_order AS ord
  FROM containers c
  JOIN shipments s ON s.id = c.shipment_id AND s.deleted_at IS NULL AND s.direction = 'EXPORT'
  JOIN clients cl ON cl.id = s.client_id
  LEFT JOIN ports p ON p.id = s.clearance_port_id
  LEFT JOIN countries co ON co.iso2 = s.destination_country_iso2
  LEFT JOIN container_seal_plans sp ON sp.shipment_id = c.shipment_id AND sp.container_no = c.container_no
  LEFT JOIN LATERAL (
    SELECT a.inv_no FROM customs_declarations d JOIN accounting_records a ON a.declaration_id = d.id
    WHERE d.shipment_id = s.id AND a.inv_no IS NOT NULL ORDER BY d.declare_date, d.declare_no LIMIT 1
  ) inv ON true
  UNION ALL
  SELECT sp.id, NULL, NULL, sp.container_no,
         to_char(coalesce(sp.loading_date, sp.etd, sp.created_at::date), 'YYYY-MM'),
         cl.id, cl.code, cl.name, NULL, sp.booking_no, p.id, p.code, ${PORT_NAME}, NULL, sp.vessel_name,
         to_char(sp.etd, 'YYYY-MM-DD'), sp.size, sp.liner_seal, sp.customs_seal, sp.carrier,
         sp.destination, sp.tare_weight_kg, sp.truck_by, sp.driver_phone, sp.truck_no, sp.deliver_to,
         to_char(sp.loading_date, 'YYYY-MM-DD'), sp.depot, sp.other, 0
  FROM container_seal_plans sp
  JOIN clients cl ON cl.id = sp.client_id
  LEFT JOIN ports p ON p.id = sp.port_id
  WHERE sp.shipment_id IS NULL
)`;

const COLUMNS = sql`r.id, r."shipmentId", r."shipmentReference", r."containerNo", r.month, r."clientId",
  r."clientCode", r."clientName", r."invNo", r."bookingNo", r."portId", r."portCode", r."portName",
  r."destinationCountry", r."vesselName", r.etd, r.size, r."linerSeal", r."customsSeal", r.carrier,
  r.destination, r."tareWeightKg", r."truckBy", r."driverPhone", r."truckNo", r."deliverTo",
  r."loadingDate", r.depot, r.other`;

function selectRows(conds: SQL[]) {
  return queryRows<SealPlanRow>(
    db,
    sql`SELECT ${COLUMNS} FROM ${ROWS} r ${whereAll(conds)}
    ORDER BY r.month, coalesce(r."loadingDate", r.etd), r."shipmentReference" NULLS LAST, r.ord, r."containerNo"
    LIMIT 2000`,
  );
}

export interface SealPlanFilters {
  year: number;
  month?: number | undefined;
  q?: string | undefined;
  /** Already narrowed to the clients the user may see. */
  clientIds?: string[] | undefined;
}

export function listSealPlans(f: SealPlanFilters): Promise<SealPlanRow[]> {
  const c = [
    f.month
      ? sql`r.month = ${`${f.year}-${String(f.month).padStart(2, '0')}`}`
      : sql`r.month LIKE ${`${f.year}-%`}`,
  ];
  const scoped = clientCondition(sql`r."clientId"`, f.clientIds);
  if (scoped) c.push(scoped);
  if (f.q) {
    const like = likePattern(f.q);
    c.push(
      sql`(r."containerNo" ILIKE ${like} OR r."linerSeal" ILIKE ${like} OR r."customsSeal" ILIKE ${like}
        OR r."bookingNo" ILIKE ${like} OR r."shipmentReference" ILIKE ${like} OR r."vesselName" ILIKE ${like}
        OR r."truckNo" ILIKE ${like} OR r.carrier ILIKE ${like} OR r."clientCode" ILIKE ${like}
        OR r."clientName" ILIKE ${like})`,
    );
  }
  return selectRows(c);
}

/** "+ New Seal Plan": the latest export CY/CY shipments, with how many containers are planned. */
export function sealPlanShipmentOptions(
  q: string | undefined,
  clientIds: string[] | undefined,
): Promise<SealPlanShipmentOption[]> {
  const c = [sql`s.deleted_at IS NULL`, sql`s.direction = 'EXPORT'`, sql`s.load_type = 'FCL'`];
  const scoped = clientCondition(sql`s.client_id`, clientIds);
  if (scoped) c.push(scoped);
  if (q) {
    const like = likePattern(q);
    c.push(
      sql`(s.reference ILIKE ${like} OR s.booking_no ILIKE ${like} OR s.vessel_name ILIKE ${like}
        OR cl.code ILIKE ${like} OR cl.name ILIKE ${like}
        OR EXISTS (SELECT 1 FROM containers x WHERE x.shipment_id = s.id AND x.container_no ILIKE ${like}))`,
    );
  }
  return queryRows<SealPlanShipmentOption>(
    db,
    sql`
    SELECT s.id, s.reference, cl.code AS "clientCode", cl.name AS "clientName", s.booking_no AS "bookingNo",
           s.vessel_name AS "vesselName", to_char(s.etd, 'YYYY-MM-DD') AS etd, ${PORT_NAME} AS "portName",
           ct.first_no AS "containerNo", ct.first_size AS "containerSize",
           coalesce(ct.n, 0)::int AS "containerCount", coalesce(ct.planned, 0)::int AS "plannedCount"
    FROM shipments s JOIN clients cl ON cl.id = s.client_id
    LEFT JOIN ports p ON p.id = s.clearance_port_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS n, (array_agg(c.container_no ORDER BY c.sort_order))[1] AS first_no,
             (array_agg(c.size ORDER BY c.sort_order))[1] AS first_size,
             count(sp.id) AS planned
      FROM containers c
      LEFT JOIN container_seal_plans sp ON sp.shipment_id = c.shipment_id AND sp.container_no = c.container_no
      WHERE c.shipment_id = s.id
    ) ct ON true
    ${whereAll(c)}
    ORDER BY coalesce(s.etd, s.created_at::date) DESC, s.reference DESC
    LIMIT 40`,
  );
}

/** A picked shipment with one row per container, so the editor can fill from it. */
export async function sealPlanShipment(id: string, req: Request): Promise<SealPlanShipment> {
  const [s] = await queryRows<Omit<SealPlanShipment, 'rows'> & { clientId: string }>(
    db,
    sql`
    SELECT s.id, s.reference, s.client_id AS "clientId", cl.name AS "clientName", s.booking_no AS "bookingNo",
           s.vessel_name AS "vesselName", to_char(s.etd, 'YYYY-MM-DD') AS etd, co.name AS "destinationCountry"
    FROM shipments s JOIN clients cl ON cl.id = s.client_id
    LEFT JOIN countries co ON co.iso2 = s.destination_country_iso2
    WHERE s.id = ${id} AND s.deleted_at IS NULL AND s.direction = 'EXPORT'`,
  );
  if (!s) throw notFound('Shipment');
  assertClientVisible(req, s.clientId, 'Shipment', 'sealplans');
  const { clientId: _c, ...rest } = s;
  return { ...rest, rows: await selectRows([sql`r."shipmentId" = ${id}`]) };
}

/**
 * Saves the plan of a shipment's container; the size and seals go to the container row. A
 * container no. the shipment doesn't have yet is added to it (CY/CY shipments only).
 */
export async function saveSealPlan(
  shipmentId: string,
  containerNo: string,
  input: SealPlanValues,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [ship] = await tx
      .select({
        clientId: shipments.clientId,
        direction: shipments.direction,
        loadType: shipments.loadType,
      })
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), isNull(shipments.deletedAt)))
      .for('update');
    if (!ship || ship.direction !== 'EXPORT') throw notFound('Shipment');
    assertClientAllowed(req, ship.clientId, 'sealplans');
    const [ctr] = await tx
      .select()
      .from(containers)
      .where(and(eq(containers.shipmentId, shipmentId), eq(containers.containerNo, containerNo)))
      .for('update');
    const [before] = await tx
      .select()
      .from(containerSealPlans)
      .where(
        and(
          eq(containerSealPlans.shipmentId, shipmentId),
          eq(containerSealPlans.containerNo, containerNo),
        ),
      );

    const { containerNo: newNo, size, linerSeal, customsSeal, ...plan } = input;
    // A corrected container no. renames the shipment's container and its plan.
    const renamed = !!ctr && !!newNo && newNo !== containerNo;
    if (renamed) {
      const [taken] = await tx
        .select({ id: containers.id })
        .from(containers)
        .where(and(eq(containers.shipmentId, shipmentId), eq(containers.containerNo, newNo)));
      if (taken) throw conflict(`This shipment already has container ${newNo}`);
      await tx
        .update(containerSealPlans)
        .set({ containerNo: newNo })
        .where(
          and(
            eq(containerSealPlans.shipmentId, shipmentId),
            eq(containerSealPlans.containerNo, containerNo),
          ),
        );
    }
    const key = renamed ? newNo : containerNo;
    if (ctr) {
      await tx
        .update(containers)
        .set({ containerNo: key, linerSeal, customsSeal, ...(size ? { size } : {}) })
        .where(eq(containers.id, ctr.id));
    } else {
      if (ship.loadType !== 'FCL')
        throw businessRule('Containers are only recorded for CY/CY (FCL) shipments');
      const [{ n } = { n: 0 }] = await queryRows<{ n: number }>(
        tx,
        sql`SELECT coalesce(max(sort_order) + 1, 0)::int AS n FROM containers WHERE shipment_id = ${shipmentId}`,
      );
      await tx
        .insert(containers)
        .values({ shipmentId, containerNo, size, linerSeal, customsSeal, sortOrder: n });
    }
    const values = { ...plan, updatedById: req.auth?.userId ?? null };
    await tx
      .insert(containerSealPlans)
      .values({ shipmentId, containerNo: key, ...values })
      .onConflictDoUpdate({
        target: [containerSealPlans.shipmentId, containerSealPlans.containerNo],
        set: values,
      });
    await audit(
      tx,
      {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'container_seal_plan',
        entityId: before?.id ?? null,
        before: before
          ? { ...before, size: ctr?.size, linerSeal: ctr?.linerSeal, customsSeal: ctr?.customsSeal }
          : undefined,
        after: {
          shipmentId,
          ...input,
          containerNo: key,
          renamedFrom: renamed ? containerNo : undefined,
          addedContainer: !ctr,
        },
      },
      req,
    );
  });
}

async function standalonePlan(tx: Tx, id: string, req: Request) {
  const [row] = await tx
    .select()
    .from(containerSealPlans)
    .where(and(eq(containerSealPlans.id, id), isNull(containerSealPlans.shipmentId)))
    .for('update');
  if (!row) throw notFound('Seal plan');
  assertClientAllowed(req, row.clientId, 'sealplans');
  return row;
}

/** A plan started blank, without a shipment. */
export async function createStandalonePlan(
  input: SealPlanStandaloneValues,
  req: Request,
): Promise<{ id: string }> {
  assertClientAllowed(req, input.clientId, 'sealplans');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(containerSealPlans)
      .values({ ...input, updatedById: req.auth?.userId ?? null })
      .returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'container_seal_plan', entityId: row!.id, after: input },
      req,
    );
    return { id: row!.id };
  });
}

export async function updateStandalonePlan(
  id: string,
  input: SealPlanStandaloneValues,
  req: Request,
): Promise<void> {
  assertClientAllowed(req, input.clientId, 'sealplans');
  await db.transaction(async (tx) => {
    const before = await standalonePlan(tx, id, req);
    await tx
      .update(containerSealPlans)
      .set({ ...input, updatedById: req.auth?.userId ?? null })
      .where(eq(containerSealPlans.id, id));
    await audit(
      tx,
      { action: 'UPDATE', entity: 'container_seal_plan', entityId: id, before, after: input },
      req,
    );
  });
}

/**
 * Deletes a plan. A blank one disappears; for a shipment's container only the plan's details
 * go (carrier, trucking, depot…): the container and its seals stay on the Shipping Plan.
 */
export async function deleteSealPlan(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ plan: containerSealPlans, shipClientId: shipments.clientId })
      .from(containerSealPlans)
      .leftJoin(shipments, eq(shipments.id, containerSealPlans.shipmentId))
      .where(eq(containerSealPlans.id, id))
      .for('update', { of: containerSealPlans });
    if (!before) throw notFound('Seal plan');
    assertClientAllowed(req, before.plan.clientId ?? before.shipClientId, 'sealplans');
    await tx.delete(containerSealPlans).where(eq(containerSealPlans.id, id));
    await audit(
      tx,
      { action: 'DELETE', entity: 'container_seal_plan', entityId: id, before: before.plan },
      req,
    );
  });
}
