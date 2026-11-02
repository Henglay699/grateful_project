import { eq, sql, type SQL } from 'drizzle-orm';
import type { CoBreakdownInput, CoDetail, CoRecordValues, CoRow } from '@gs/shared';
import type { Request } from 'express';
import { db } from '../../db/client';
import { coRecords } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { queryRows, whereAll } from '../../lib/listing';
import { assertClientAllowed, assertClientVisible, clientCondition } from '../../lib/clientScope';

/**
 * Every export invoice of a live shipment, with its CO. Until something is saved for an
 * invoice, its form is the shipment's and so is its CO no. when the shipment has only that
 * invoice (a shipment's CO numbers can't be told apart per invoice); its status is the shipment's
 * CO Status, else "Approve" once the shipment has a CO no. and "Pending" before. The country is the destination, "USA" for the US as on
 * the sheet.
 */
const ROWS = sql`(
  SELECT i.id AS "invoiceId", s.id AS "shipmentId", s.reference, cl.id AS "clientId",
    cl.code AS "clientCode", cl.name AS "clientName",
    to_char(coalesce(i.invoice_date, s.etd, s.created_at::date), 'YYYY-MM') AS month,
    coalesce(r.form, s.co_form) AS form, s.transport_mode::text AS mode,
    CASE WHEN s.destination_country_iso2 = 'US' THEN 'USA' ELSE upper(co.name) END AS country,
    CASE WHEN r.id IS NOT NULL THEN r.co_no WHEN n.invoices = 1 THEN s.co_number END AS "coNo",
    s.co_number AS "shipmentCoNo", to_char(r.co_date, 'YYYY-MM-DD') AS "coDate",
    i.invoice_no AS "invoiceNo",
    to_char(i.invoice_date, 'YYYY-MM-DD') AS "invoiceDate",
    coalesce(l.pcs, 0)::float8 AS pcs, coalesce(l.ctns, 0)::float8 AS ctns,
    coalesce(l.amount, 0)::float8 AS amount, coalesce(l.nw, 0)::float8 AS "netWeightKg",
    to_char(s.atd, 'YYYY-MM-DD') AS atd, to_char(s.etd, 'YYYY-MM-DD') AS etd,
    coalesce(r.status, CASE s.co_status WHEN 'Pending' THEN 'PENDING' WHEN 'Draft' THEN 'DRAFT'
      WHEN 'Submitted' THEN 'SUBMIT' WHEN 'Approved' THEN 'APPROVE' END,
      CASE WHEN s.co_number IS NOT NULL THEN 'APPROVE' ELSE 'PENDING' END) AS status,
    r.remark, r.id IS NOT NULL AS saved, r.breakdown IS NOT NULL AS "hasBreakdown",
    (r.id IS NOT NULL OR s.co_form IS NOT NULL OR s.co_number IS NOT NULL) AS "hasCo",
    i.sort_order AS ord
  FROM cargo_invoices i
  JOIN shipments s ON s.id = i.shipment_id AND s.deleted_at IS NULL AND s.direction = 'EXPORT'
  JOIN clients cl ON cl.id = s.client_id
  LEFT JOIN countries co ON co.iso2 = s.destination_country_iso2
  LEFT JOIN co_records r ON r.invoice_id = i.id
  LEFT JOIN LATERAL (
    SELECT sum(pcs) AS pcs, sum(ctns) AS ctns, sum(fob_amount) AS amount, sum(net_weight_kg) AS nw
    FROM cargo_invoice_lines WHERE invoice_id = i.id
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS invoices FROM cargo_invoices WHERE shipment_id = s.id
  ) n ON true
)`;

const COLUMNS = sql`r."invoiceId", r."shipmentId", r.reference, r."clientId", r."clientCode",
  r."clientName", r.month, r.form, r.mode, r.country, r."coNo", r."shipmentCoNo", r."coDate", r."invoiceNo",
  r."invoiceDate", r.pcs, r.ctns, r.amount, r."netWeightKg", r.atd, r.etd, r.status, r.remark,
  r.saved, r."hasBreakdown"`;

export interface CoFilters {
  from: string;
  to: string;
  status?: string | undefined;
  all?: boolean | undefined;
  clientIds: string[] | undefined;
}

export async function listCo(f: CoFilters): Promise<CoRow[]> {
  const conds: (SQL | undefined)[] = [
    sql`r.month BETWEEN ${f.from} AND ${f.to}`,
    clientCondition(sql`r."clientId"`, f.clientIds),
    f.status ? sql`r.status = ${f.status}` : undefined,
    f.all ? undefined : sql`r."hasCo"`,
  ];
  return queryRows<CoRow>(
    db,
    sql`SELECT ${COLUMNS} FROM ${ROWS} r ${whereAll(conds.filter((c): c is SQL => !!c))}
    ORDER BY r.month, r."invoiceDate" NULLS LAST, r."invoiceNo", r.ord LIMIT 2000`,
  );
}

export async function getCo(invoiceId: string, req: Request): Promise<CoDetail> {
  const [row] = await queryRows<
    CoRow & {
      breakdown: CoBreakdownInput | null;
      companyName: string;
      address: string | null;
      phone: string | null;
      htsCode: string | null;
    }
  >(
    db,
    sql`SELECT ${COLUMNS}, cr.breakdown, coalesce(nullif(c.legal_name, ''), c.name) AS "companyName",
          c.address, c.contact_phone AS phone,
          (SELECT string_agg(DISTINCT upper(trim(l.hts_code)), ', ') FROM cargo_invoice_lines l
           WHERE l.invoice_id = r."invoiceId" AND trim(coalesce(l.hts_code, '')) <> '') AS "htsCode"
        FROM ${ROWS} r
        JOIN clients c ON c.id = r."clientId"
        LEFT JOIN co_records cr ON cr.invoice_id = r."invoiceId"
        WHERE r."invoiceId" = ${invoiceId}::uuid`,
  );
  if (!row) throw notFound('Export invoice');
  assertClientVisible(req, row.clientId, 'Export invoice');
  const [last] = await queryRows<{ breakdown: CoBreakdownInput }>(
    db,
    sql`SELECT cr.breakdown FROM co_records cr
        JOIN cargo_invoices i ON i.id = cr.invoice_id
        JOIN shipments s ON s.id = i.shipment_id
        WHERE s.client_id = ${row.clientId}::uuid AND cr.breakdown IS NOT NULL
          AND cr.invoice_id <> ${invoiceId}::uuid
        ORDER BY cr.updated_at DESC LIMIT 1`,
  );
  const { breakdown, companyName, address, phone, ...rest } = row;
  return {
    ...rest,
    company: { name: companyName, address: address ?? '', phone: phone ?? '' },
    breakdown,
    template: last?.breakdown ?? null,
  };
}

/** The invoice's client, checked against the user's; 404 for a non-export invoice. */
async function invoiceClient(invoiceId: string, req: Request): Promise<void> {
  const [inv] = await queryRows<{ clientId: string }>(
    db,
    sql`SELECT s.client_id AS "clientId" FROM cargo_invoices i
        JOIN shipments s ON s.id = i.shipment_id AND s.deleted_at IS NULL AND s.direction = 'EXPORT'
        WHERE i.id = ${invoiceId}::uuid`,
  );
  if (!inv) throw notFound('Export invoice');
  assertClientAllowed(req, inv.clientId);
}

/** CO Plans → edit a row: its form, CO no. and date, status and remark. */
export async function saveCoRecord(
  invoiceId: string,
  input: CoRecordValues,
  req: Request,
): Promise<void> {
  await invoiceClient(invoiceId, req);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(coRecords).where(eq(coRecords.invoiceId, invoiceId));
    const values = { ...input, updatedById: req.auth?.userId ?? null };
    const [saved] = await tx
      .insert(coRecords)
      .values({ invoiceId, ...values })
      .onConflictDoUpdate({ target: coRecords.invoiceId, set: values })
      .returning({ id: coRecords.id });
    await audit(
      tx,
      {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'co_record',
        entityId: saved?.id ?? null,
        before: before ? { ...before, breakdown: undefined } : undefined,
        after: { invoiceId, ...input },
      },
      req,
    );
  });
}

/**
 * Breakdown → Save: the sheet's inputs. An invoice saved here for the first time starts its
 * CO row with the values the list showed (the shipment's form, a draft).
 */
export async function saveBreakdown(
  invoiceId: string,
  breakdown: CoBreakdownInput,
  req: Request,
): Promise<void> {
  await invoiceClient(invoiceId, req);
  const current = await getCo(invoiceId, req);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(coRecords).where(eq(coRecords.invoiceId, invoiceId));
    const userId = req.auth?.userId ?? null;
    const [saved] = await tx
      .insert(coRecords)
      .values({
        invoiceId,
        form: current.form,
        coNo: current.coNo,
        status: current.status,
        breakdown,
        updatedById: userId,
      })
      .onConflictDoUpdate({ target: coRecords.invoiceId, set: { breakdown, updatedById: userId } })
      .returning({ id: coRecords.id });
    await audit(
      tx,
      {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'co_breakdown',
        entityId: saved?.id ?? null,
        before: before?.breakdown ?? undefined,
        after: { invoiceId, ...breakdown },
      },
      req,
    );
  });
}
