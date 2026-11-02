import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { ClientDetail, ClientInputParsed, ClientListItem, Paginated } from '@gs/shared';
import type { Request } from 'express';
import { db } from '../../db/client';
import { clients, consignees, countries } from '../../db/schema';
import { env } from '../../config/env';
import { listSuppliers } from './parties';
import { audit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import {
  likePattern,
  orderBy,
  paginate,
  queryRows,
  toPaginated,
  whereAll,
} from '../../lib/listing';
import { clientCondition } from '../../lib/clientScope';

interface ListParams {
  page: number;
  pageSize: number;
  sort?: string | undefined;
  q?: string | undefined;
  status?: string | undefined;
  /** Only these clients (per-user access); undefined = all. */
  ids?: string[] | undefined;
  withProfit: boolean;
}

const baseSelect = (withProfit: boolean, extra: SQL = sql``) => sql`
  SELECT c.id, c.code, c.name, c.legal_name AS "legalName", c.country_iso2 AS "countryIso2", co.name AS "countryName",
         c.status, c.commission_usd::text AS "commissionUsd",
         count(s.id)::int AS "shipmentCount",
         (count(s.id) FILTER (WHERE s.status IN ('IN_PROGRESS', 'PENDING')))::int AS "activeShipments",
         to_char(max(s.eta), 'YYYY-MM-DD') AS "lastEta"
         ${
           withProfit
             ? sql`, (SELECT coalesce(sum(a.net_profit), 0)::text FROM accounting_records a
              WHERE a.client_id = c.id
                AND a.inv_date >= date_trunc('year', now() AT TIME ZONE ${env.BUSINESS_TIMEZONE})::date) AS "netProfitYtd"`
             : sql``
         }
         ${extra}
  FROM clients c
  JOIN countries co ON co.iso2 = c.country_iso2
  LEFT JOIN shipments s ON s.client_id = c.id AND s.deleted_at IS NULL`;

export async function listClients(p: ListParams): Promise<Paginated<ClientListItem>> {
  const conds = [sql`c.deleted_at IS NULL`];
  if (p.status) conds.push(sql`c.status = ${p.status}`);
  const scoped = clientCondition(sql`c.id`, p.ids);
  if (scoped) conds.push(scoped);
  if (p.q) {
    const like = likePattern(p.q);
    conds.push(sql`(c.name ILIKE ${like} OR c.code ILIKE ${like} OR c.legal_name ILIKE ${like})`);
  }
  const res = await queryRows<ClientListItem & { total_count: number }>(
    db,
    sql`
    ${baseSelect(p.withProfit, sql`, count(*) OVER () AS total_count`)}
    ${whereAll(conds)}
    GROUP BY c.id, co.name
    ${orderBy(p.sort, { name: sql`c.name`, code: sql`c.code`, shipments: sql`count(s.id)`, lastEta: sql`max(s.eta)` }, sql`c.name`)}
    ${paginate(p.page, p.pageSize)}`,
  );
  return toPaginated(res, p.page, p.pageSize);
}

export async function getClient(id: string, withProfit: boolean): Promise<ClientDetail> {
  const res = await queryRows<ClientListItem>(
    db,
    sql`
    ${baseSelect(withProfit)}
    WHERE c.id = ${id} AND c.deleted_at IS NULL
    GROUP BY c.id, co.name`,
  );
  const head = res[0];
  if (!head) throw notFound('Client');

  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  const extra = await queryRows<{ imports: number; exports: number; cut: number }>(
    db,
    sql`
    SELECT (SELECT count(*) FROM shipments WHERE client_id = ${id} AND deleted_at IS NULL AND direction = 'IMPORT')::int AS imports,
           (SELECT count(*) FROM shipments WHERE client_id = ${id} AND deleted_at IS NULL AND direction = 'EXPORT')::int AS exports,
           (SELECT count(*) FROM cut_stock_items WHERE client_id = ${id} AND deleted_at IS NULL)::int AS cut`,
  );
  const consigneeRows = await queryRows<ClientDetail['consignees'][number]>(
    db,
    sql`
    SELECT id, name, country_iso2 AS "countryIso2", address FROM consignees WHERE client_id = ${id} AND is_active ORDER BY name`,
  );
  const supplierRows = await listSuppliers(id);
  const recent = await queryRows<ClientDetail['recentShipments'][number]>(
    db,
    sql`
    SELECT s.id, s.reference, s.direction, s.status, to_char(s.eta, 'YYYY-MM-DD') AS eta,
           coalesce((SELECT array_agg(invoice_no ORDER BY sort_order) FROM cargo_invoices WHERE shipment_id = s.id), '{}') AS "invoiceNos"
    FROM shipments s WHERE s.client_id = ${id} AND s.deleted_at IS NULL
    ORDER BY s.eta DESC NULLS LAST LIMIT 8`,
  );
  const e = extra[0]!;
  return {
    ...head,
    legalNameKm: row!.legalNameKm,
    address: row!.address,
    addressKm: row!.addressKm,
    vattin: row!.vattin,
    contactName: row!.contactName,
    contactEmail: row!.contactEmail,
    contactPhone: row!.contactPhone,
    cdcNo: row!.cdcNo,
    cdcIssueDate: row!.cdcIssueDate,
    cdcValidUntil: row!.cdcValidUntil,
    cdcExtensionLetterNo: row!.cdcExtensionLetterNo,
    cdcCustomsNoteDate: row!.cdcCustomsNoteDate,
    companyPhone: row!.companyPhone,
    createdAt: row!.createdAt.toISOString(),
    importCount: e.imports,
    exportCount: e.exports,
    cutStockItems: e.cut,
    consignees: consigneeRows,
    suppliers: supplierRows,
    recentShipments: recent,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The client's own consignee: one named exactly as its legal name and linked to it (imports
 * default to it). An unlinked consignee of that name is linked; one already belonging to
 * another client is left alone.
 */
async function ensureOwnConsignee(tx: Tx, clientId: string, legalName: string | null | undefined) {
  const name = legalName?.trim();
  if (!name) return;
  const [found] = await tx
    .select({ id: consignees.id, clientId: consignees.clientId })
    .from(consignees)
    .where(sql`lower(${consignees.name}) = lower(${name})`);
  if (found) {
    if (!found.clientId)
      await tx.update(consignees).set({ clientId }).where(eq(consignees.id, found.id));
    return;
  }
  const [kh] = await tx
    .select({ iso2: countries.iso2 })
    .from(countries)
    .where(eq(countries.iso2, 'KH'));
  await tx.insert(consignees).values({ clientId, name, countryIso2: kh?.iso2 ?? null });
}

export async function createClient(input: ClientInputParsed, req: Request): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clients)
      .values({ ...input, commissionUsd: input.commissionUsd! })
      .returning();
    await ensureOwnConsignee(tx, row!.id, row!.legalName);
    await audit(tx, { action: 'CREATE', entity: 'client', entityId: row!.id, after: row }, req);
    return row!.id;
  });
}

export async function updateClient(
  id: string,
  input: Partial<ClientInputParsed>,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .for('update');
    if (!before) throw notFound('Client');
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (patch.commissionUsd === null) delete patch.commissionUsd;
    const [after] = await tx.update(clients).set(patch).where(eq(clients.id, id)).returning();
    if (after!.legalName !== before.legalName) await ensureOwnConsignee(tx, id, after!.legalName);
    await audit(tx, { action: 'UPDATE', entity: 'client', entityId: id, before, after }, req);
  });
}

/** Clients with shipments are kept for history: deactivate them instead. */
export async function deleteClient(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .for('update');
    if (!before) throw notFound('Client');
    const used = await queryRows<{ n: number }>(
      tx,
      sql`
      SELECT ((SELECT count(*) FROM shipments WHERE client_id = ${id} AND deleted_at IS NULL)
            + (SELECT count(*) FROM cut_stock_items WHERE client_id = ${id} AND deleted_at IS NULL))::int AS n`,
    );
    if ((used[0]?.n ?? 0) > 0)
      throw conflict(
        `${before.name} has shipments or cut-stock items. Set its status to Inactive instead of deleting it.`,
      );
    await tx.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, id));
    await audit(tx, { action: 'DELETE', entity: 'client', entityId: id, before }, req);
  });
}
