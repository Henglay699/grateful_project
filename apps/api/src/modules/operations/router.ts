import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { declarationRegisterQuerySchema, type DeclarationRegisterRow } from '@gs/shared';
import { db } from '../../db/client';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { likePattern, paginate, queryRows, toPaginated, whereAll } from '../../lib/listing';
import { clientCondition, scopeClients } from '../../lib/clientScope';

export const operationsRouter = Router();
operationsRouter.use(requireAuth, requirePermission('shipments:read'));

/** Customs declaration register with ledger and document status. */
operationsRouter.get('/declarations', async (req, res) => {
  const q = parse(declarationRegisterQuerySchema, req.query);
  const c = [sql`s.deleted_at IS NULL`];
  if (q.clientId) c.push(sql`s.client_id = ${q.clientId}`);
  const scoped = clientCondition(sql`s.client_id`, scopeClients(req));
  if (scoped) c.push(scoped);
  if (q.direction) c.push(sql`s.direction = ${q.direction}`);
  if (q.month)
    c.push(
      sql`d.declare_date >= ${`${q.month}-01`}::date AND d.declare_date < (${`${q.month}-01`}::date + interval '1 month')`,
    );
  if (q.ledger === 'with') c.push(sql`a.id IS NOT NULL`);
  if (q.ledger === 'without') c.push(sql`a.id IS NULL`);
  if (q.q) {
    const like = likePattern(q.q);
    c.push(
      sql`(d.declare_no ILIKE ${like} OR s.reference ILIKE ${like} OR s.hbl_no ILIKE ${like} OR cl.code ILIKE ${like})`,
    );
  }
  const rows = await queryRows<DeclarationRegisterRow & { total_count: string }>(
    db,
    sql`
    SELECT d.id, d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate", p.code AS "portCode",
           s.id AS "shipmentId", s.reference AS "shipmentReference", s.hbl_no AS "hblNo", cl.code AS "clientCode", s.direction,
           s.clearance_status AS "clearanceStatus", a.id AS "ledgerId", a.inv_no AS "invNo",
           (SELECT count(*) FROM documents x WHERE x.shipment_id = s.id AND x.deleted_at IS NULL)::int AS documents,
           (SELECT count(*) FROM cdc_lines l WHERE l.declaration_id = d.id)::int AS "cdcLines",
           count(*) OVER () AS total_count
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id JOIN clients cl ON cl.id = s.client_id
    LEFT JOIN ports p ON p.id = d.port_id LEFT JOIN accounting_records a ON a.declaration_id = d.id
    ${whereAll(c)} ORDER BY d.declare_date DESC, d.declare_no DESC ${paginate(q.page, q.pageSize)}`,
  );
  res.json(toPaginated(rows, q.page, q.pageSize));
});
