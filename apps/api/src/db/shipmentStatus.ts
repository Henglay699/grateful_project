import { sql } from 'drizzle-orm';
import type { db as Db, Tx } from './client';

/**
 * The shipment status rule (shipmentStatusOf in @gs/shared), in SQL: Completed once an import
 * has its ETA Factory date or an export its ATD; In Progress once a declaration is recorded;
 * otherwise Pending. Used by the seed; migration 0014 applies the same rule to existing rows.
 */
export const shipmentStatusSql = sql`CASE
    WHEN (s.direction = 'IMPORT' AND s.arrive_fty IS NOT NULL)
      OR (s.direction = 'EXPORT' AND s.atd IS NOT NULL) THEN 'COMPLETED'
    WHEN EXISTS (SELECT 1 FROM customs_declarations d WHERE d.shipment_id = s.id) THEN 'IN_PROGRESS'
    ELSE 'PENDING'
  END::shipment_status`;

/** Brings every shipment's stored status in line with the rule. */
export async function recomputeShipmentStatuses(tx: Tx | typeof Db) {
  await tx.execute(sql`UPDATE shipments s SET status = ${shipmentStatusSql}`);
}
