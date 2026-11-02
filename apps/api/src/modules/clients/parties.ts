import { and, eq, sql } from 'drizzle-orm';
import type { ClientDetail } from '@gs/shared';
import type { Request } from 'express';
import { db } from '../../db/client';
import { clients, consignees, suppliers } from '../../db/schema';
import { audit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';

/**
 * The client's suppliers: those saved with an address, plus the other shipper names on its
 * import shipments (no record yet, so no address). Deleted ones (hidden) are left out.
 */
export function listSuppliers(clientId: string): Promise<ClientDetail['suppliers']> {
  return queryRows<ClientDetail['suppliers'][number]>(
    db,
    sql`
    SELECT id, name, address FROM (
      SELECT sp.id, sp.name, sp.address FROM suppliers sp WHERE sp.client_id = ${clientId} AND NOT sp.hidden
      UNION ALL
      SELECT NULL::uuid, min(trim(s.shipper_name)), NULL FROM shipments s
      WHERE s.client_id = ${clientId} AND s.deleted_at IS NULL AND s.direction = 'IMPORT'
        AND trim(coalesce(s.shipper_name, '')) <> ''
        AND NOT EXISTS (SELECT 1 FROM suppliers x
                        WHERE x.client_id = ${clientId} AND lower(x.name) = lower(trim(s.shipper_name)))
      GROUP BY lower(trim(s.shipper_name))
    ) r ORDER BY upper(name)`,
  );
}

async function assertClient(clientId: string) {
  const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  if (!c) throw notFound('Client');
}

/** Adds a supplier (again, after a delete) or sets its address; matched on the name, any case. */
export async function saveSupplier(
  clientId: string,
  input: { name: string; address: string | null },
  req: Request,
): Promise<{ id: string }> {
  await assertClient(clientId);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(suppliers)
      .where(
        and(eq(suppliers.clientId, clientId), sql`lower(${suppliers.name}) = lower(${input.name})`),
      )
      .for('update');
    const [row] = before
      ? await tx
          .update(suppliers)
          .set({ ...input, hidden: false })
          .where(eq(suppliers.id, before.id))
          .returning({ id: suppliers.id })
      : await tx
          .insert(suppliers)
          .values({ clientId, ...input })
          .returning({ id: suppliers.id });
    await audit(
      tx,
      {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'supplier',
        entityId: row!.id,
        before,
        after: { clientId, ...input },
      },
      req,
    );
    return row!;
  });
}

/**
 * Deletes a supplier from the client's list: its address is cleared and the name hidden, even
 * while shipments still use it (they keep their Shipper Name). "+ Add" brings it back.
 */
export async function deleteSupplier(clientId: string, name: string, req: Request): Promise<void> {
  await assertClient(clientId);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.clientId, clientId), sql`lower(${suppliers.name}) = lower(${name})`))
      .for('update');
    if (before) {
      if (before.hidden) throw notFound('Supplier');
      await tx
        .update(suppliers)
        .set({ hidden: true, address: null })
        .where(eq(suppliers.id, before.id));
    } else {
      const [{ n } = { n: 0 }] = await queryRows<{ n: number }>(
        tx,
        sql`SELECT count(*)::int AS n FROM shipments WHERE client_id = ${clientId} AND deleted_at IS NULL
            AND direction = 'IMPORT' AND lower(trim(shipper_name)) = lower(${name})`,
      );
      if (!n) throw notFound('Supplier');
      await tx.insert(suppliers).values({ clientId, name, hidden: true });
    }
    await audit(
      tx,
      {
        action: 'DELETE',
        entity: 'supplier',
        entityId: before?.id ?? null,
        before,
        after: { clientId, name },
      },
      req,
    );
  });
}

/**
 * Deletes a consignee from the client: it is made inactive, so it leaves this list and the
 * consignee dropdowns while the shipments that name it keep it.
 */
export async function deleteConsignee(
  clientId: string,
  consigneeId: string,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(consignees)
      .where(
        and(
          eq(consignees.id, consigneeId),
          eq(consignees.clientId, clientId),
          eq(consignees.isActive, true),
        ),
      )
      .for('update');
    if (!before) throw notFound('Consignee');
    await tx.update(consignees).set({ isActive: false }).where(eq(consignees.id, consigneeId));
    await audit(tx, { action: 'DELETE', entity: 'consignee', entityId: consigneeId, before }, req);
  });
}

/**
 * Adds a consignee to the client with its address. Names are unique across clients: a deleted
 * (inactive) or unlinked consignee of that name is taken back for this client; one in use by
 * a client already is refused.
 */
export async function addConsignee(
  clientId: string,
  input: { name: string; address: string | null },
  req: Request,
): Promise<{ id: string }> {
  await assertClient(clientId);
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(consignees)
      .where(sql`lower(${consignees.name}) = lower(${input.name})`)
      .for('update');
    if (found?.isActive && found.clientId === clientId)
      throw conflict(`${found.name} is already one of this client's consignees`);
    if (found?.isActive && found.clientId)
      throw conflict(`${found.name} is already a consignee of another client`);
    const [row] = found
      ? await tx
          .update(consignees)
          .set({ clientId, address: input.address, isActive: true })
          .where(eq(consignees.id, found.id))
          .returning()
      : await tx
          .insert(consignees)
          .values({ clientId, name: input.name, address: input.address })
          .returning();
    await audit(
      tx,
      {
        action: found ? 'UPDATE' : 'CREATE',
        entity: 'consignee',
        entityId: row!.id,
        before: found,
        after: row,
      },
      req,
    );
    return { id: row!.id };
  });
}

/** Sets the address of one of the client's consignees. */
export async function setConsigneeAddress(
  clientId: string,
  consigneeId: string,
  address: string | null,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(consignees)
      .where(and(eq(consignees.id, consigneeId), eq(consignees.clientId, clientId)))
      .for('update');
    if (!before) throw notFound('Consignee');
    await tx.update(consignees).set({ address }).where(eq(consignees.id, consigneeId));
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'consignee',
        entityId: consigneeId,
        before: { address: before.address },
        after: { address },
      },
      req,
    );
  });
}
