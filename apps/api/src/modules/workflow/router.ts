import { Router, type Request } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  brokerAgentInputSchema,
  clientAuthorizationInputSchema,
  clientSignatoryInputSchema,
  customsPermitInputSchema,
  daysUntil,
  hasPermission,
  vendorInvoiceInputSchema,
  workflowAdvanceSchema,
  workflowFiguresSchema,
  workflowReturnSchema,
  type BrokerAgentRow,
  type ClientAuthorizationRow,
  type ClientSignatoryRow,
  type Permission,
} from '@gs/shared';
import { db } from '../../db/client';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { forbidden, notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';
import { assertClientAllowed, assertClientVisible } from '../../lib/clientScope';
import { attachmentName } from '../../lib/http';
import { shipmentClientId } from '../shipments/service';
import {
  advance,
  alerts,
  getWorkflow,
  listPermits,
  listVendorInvoices,
  sendBack,
  todayPP,
  workQueue,
} from './service';
import { buildExportDoc, EXPORT_DOC_KINDS } from './exportDocs';

export const workflowRouter = Router();
workflowRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });
const childParam = z.object({ id: z.string().uuid(), childId: z.string().uuid() });

/** Any one of the permissions (requirePermission needs all of them). */
const requireAny =
  (...perms: Permission[]) =>
  (req: Request, _res: unknown, next: (e?: unknown) => void) =>
    perms.some((p) => hasPermission(req.auth!.permissions, p))
      ? next()
      : next(forbidden(`Missing permission: ${perms.join(' or ')}`));

async function visibleShipment(req: Request, id: string, write = false) {
  const clientId = await shipmentClientId(id);
  if (write) assertClientAllowed(req, clientId);
  else assertClientVisible(req, clientId, 'Shipment');
  return clientId;
}

/* ---------- My Work and alerts ---------- */

workflowRouter.get('/queue', requirePermission('shipments:read'), async (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  res.json(await workQueue(req, scope));
});

workflowRouter.get('/alerts', async (req, res) => {
  res.json(await alerts(req));
});

/* ---------- One shipment's workflow ---------- */

workflowRouter.get('/shipments/:id', requirePermission('shipments:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json(await getWorkflow(req, id));
});

/** Anyone who completes some stage; which stage is theirs is checked in the service. */
const STAGE_WORKERS: Permission[] = [
  'shipments:write',
  'customs:write',
  'accounting:write',
  'workflow:approve',
];

workflowRouter.post('/shipments/:id/advance', requireAny(...STAGE_WORKERS), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(workflowAdvanceSchema, req.body);
  await advance(req, id, body);
  res.json(await getWorkflow(req, id));
});

workflowRouter.post('/shipments/:id/return', requireAny(...STAGE_WORKERS), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(workflowReturnSchema, req.body);
  await sendBack(req, id, body);
  res.json(await getWorkflow(req, id));
});

workflowRouter.put(
  '/shipments/:id/figures',
  requirePermission('shipments:write'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleShipment(req, id, true);
    const v = parse(workflowFiguresSchema, req.body);
    await db.transaction(async (tx) => {
      await tx.execute(sql`
      UPDATE shipments SET booked_qty = ${v.bookedQty}, booked_gross_weight_kg = ${v.bookedGrossWeightKg},
        booked_cbm = ${v.bookedCbm}, measured_cbm = ${v.measuredCbm},
        measured_gross_weight_kg = ${v.measuredGrossWeightKg}, updated_at = now(), updated_by_id = ${req.auth!.userId}
      WHERE id = ${id}`);
      await audit(
        tx,
        { action: 'UPDATE', entity: 'shipment_figures', entityId: id, after: v },
        req,
      );
    });
    res.json(await getWorkflow(req, id));
  },
);

/* ---------- Customs permits ---------- */

workflowRouter.get(
  '/shipments/:id/permits',
  requirePermission('customs:read'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleShipment(req, id);
    res.json(await listPermits(db, id));
  },
);

workflowRouter.post(
  '/shipments/:id/permits',
  requirePermission('customs:write'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleShipment(req, id, true);
    const v = parse(customsPermitInputSchema, req.body);
    await db.transaction(async (tx) => {
      const [row] = await queryRows<{ id: string }>(
        tx,
        sql`INSERT INTO customs_permits (shipment_id, permit_no, issue_date, valid_from, valid_until, office, remark, document_id, created_by_id)
          VALUES (${id}, ${v.permitNo}, ${v.issueDate}, ${v.validFrom}, ${v.validUntil}, ${v.office}, ${v.remark}, ${v.documentId}, ${req.auth!.userId})
          RETURNING id`,
      );
      await audit(
        tx,
        { action: 'CREATE', entity: 'customs_permit', entityId: row!.id, after: v },
        req,
      );
    });
    res.status(201).json(await getWorkflow(req, id));
  },
);

workflowRouter.put(
  '/shipments/:id/permits/:childId',
  requirePermission('customs:write'),
  async (req, res) => {
    const { id, childId } = parse(childParam, req.params);
    await visibleShipment(req, id, true);
    const v = parse(customsPermitInputSchema, req.body);
    await db.transaction(async (tx) => {
      const r = await tx.execute(
        sql`UPDATE customs_permits SET permit_no = ${v.permitNo}, issue_date = ${v.issueDate}, valid_from = ${v.validFrom},
              valid_until = ${v.validUntil}, office = ${v.office}, remark = ${v.remark}, document_id = ${v.documentId}, updated_at = now()
            WHERE id = ${childId} AND shipment_id = ${id} AND deleted_at IS NULL`,
      );
      if (!r.rowCount) throw notFound('Permit');
      await audit(
        tx,
        { action: 'UPDATE', entity: 'customs_permit', entityId: childId, after: v },
        req,
      );
    });
    res.json(await getWorkflow(req, id));
  },
);

workflowRouter.delete(
  '/shipments/:id/permits/:childId',
  requirePermission('customs:write'),
  async (req, res) => {
    const { id, childId } = parse(childParam, req.params);
    await visibleShipment(req, id, true);
    await db.transaction(async (tx) => {
      const r = await tx.execute(
        sql`UPDATE customs_permits SET deleted_at = now() WHERE id = ${childId} AND shipment_id = ${id} AND deleted_at IS NULL`,
      );
      if (!r.rowCount) throw notFound('Permit');
      await audit(tx, { action: 'DELETE', entity: 'customs_permit', entityId: childId }, req);
    });
    res.json(await getWorkflow(req, id));
  },
);

/* ---------- Vendor invoices ---------- */

workflowRouter.get(
  '/shipments/:id/vendor-invoices',
  requirePermission('accounting:read'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleShipment(req, id);
    res.json(await listVendorInvoices(db, id));
  },
);

workflowRouter.post(
  '/shipments/:id/vendor-invoices',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleShipment(req, id, true);
    const v = parse(vendorInvoiceInputSchema, req.body);
    await db.transaction(async (tx) => {
      const [row] = await queryRows<{ id: string }>(
        tx,
        sql`INSERT INTO vendor_invoices (shipment_id, vendor_name, invoice_no, invoice_date, description, amount, vat,
              billed_cbm, billed_gross_weight_kg, due_date, paid_on, payment_ref, document_id, created_by_id)
            VALUES (${id}, ${v.vendorName}, ${v.invoiceNo}, ${v.invoiceDate}, ${v.description}, ${v.amount}, ${v.vat},
              ${v.billedCbm}, ${v.billedGrossWeightKg}, ${v.dueDate}, ${v.paidOn}, ${v.paymentRef}, ${v.documentId}, ${req.auth!.userId})
            RETURNING id`,
      );
      await audit(
        tx,
        { action: 'CREATE', entity: 'vendor_invoice', entityId: row!.id, after: v },
        req,
      );
    });
    res.status(201).json(await getWorkflow(req, id));
  },
);

workflowRouter.put(
  '/shipments/:id/vendor-invoices/:childId',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { id, childId } = parse(childParam, req.params);
    await visibleShipment(req, id, true);
    const v = parse(vendorInvoiceInputSchema, req.body);
    await db.transaction(async (tx) => {
      const r = await tx.execute(
        sql`UPDATE vendor_invoices SET vendor_name = ${v.vendorName}, invoice_no = ${v.invoiceNo}, invoice_date = ${v.invoiceDate},
              description = ${v.description}, amount = ${v.amount}, vat = ${v.vat}, billed_cbm = ${v.billedCbm},
              billed_gross_weight_kg = ${v.billedGrossWeightKg}, due_date = ${v.dueDate}, paid_on = ${v.paidOn},
              payment_ref = ${v.paymentRef}, document_id = ${v.documentId}, updated_at = now()
            WHERE id = ${childId} AND shipment_id = ${id} AND deleted_at IS NULL`,
      );
      if (!r.rowCount) throw notFound('Vendor invoice');
      await audit(
        tx,
        { action: 'UPDATE', entity: 'vendor_invoice', entityId: childId, after: v },
        req,
      );
    });
    res.json(await getWorkflow(req, id));
  },
);

workflowRouter.delete(
  '/shipments/:id/vendor-invoices/:childId',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { id, childId } = parse(childParam, req.params);
    await visibleShipment(req, id, true);
    await db.transaction(async (tx) => {
      const r = await tx.execute(
        sql`UPDATE vendor_invoices SET deleted_at = now() WHERE id = ${childId} AND shipment_id = ${id} AND deleted_at IS NULL`,
      );
      if (!r.rowCount) throw notFound('Vendor invoice');
      await audit(tx, { action: 'DELETE', entity: 'vendor_invoice', entityId: childId }, req);
    });
    res.json(await getWorkflow(req, id));
  },
);

/* ---------- Generated export documents ---------- */

const docParam = z.object({ id: z.string().uuid(), kind: z.enum(EXPORT_DOC_KINDS) });
workflowRouter.get(
  '/shipments/:id/docs/:kind.xlsx',
  requirePermission('shipments:read'),
  async (req, res) => {
    const { id, kind } = parse(docParam, req.params);
    await visibleShipment(req, id);
    const { buffer, fileName } = await buildExportDoc(id, kind);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', attachmentName(fileName));
    res.send(buffer);
  },
);

/* ---------- Customs broker (our company and agent) ---------- */

const BROKER_SELECT = sql`
  SELECT id, company, company_vattin AS "companyVattin", grantee_name AS "granteeName", grantee_id_no AS "granteeIdNo",
         grantee_phone AS "granteePhone", agent_name AS "agentName", agent_id_no AS "agentIdNo", agent_phone AS "agentPhone",
         card_no AS "cardNo", to_char(card_expiry, 'YYYY-MM-DD') AS "cardExpiry", is_default AS "isDefault", is_active AS "isActive"
  FROM broker_agents`;

workflowRouter.get(
  '/broker-agents',
  requireAny('customs:read', 'shipments:read'),
  async (_req, res) => {
    res.json(
      await queryRows<BrokerAgentRow>(
        db,
        sql`${BROKER_SELECT} ORDER BY is_default DESC, created_at`,
      ),
    );
  },
);

async function saveBroker(req: Request, id: string | null) {
  const v = parse(brokerAgentInputSchema, req.body);
  return db.transaction(async (tx) => {
    if (v.isDefault) await tx.execute(sql`UPDATE broker_agents SET is_default = false`);
    let rowId = id;
    if (id) {
      const r = await tx.execute(
        sql`UPDATE broker_agents SET company = ${v.company}, company_vattin = ${v.companyVattin}, grantee_name = ${v.granteeName},
              grantee_id_no = ${v.granteeIdNo}, grantee_phone = ${v.granteePhone}, agent_name = ${v.agentName},
              agent_id_no = ${v.agentIdNo}, agent_phone = ${v.agentPhone}, card_no = ${v.cardNo}, card_expiry = ${v.cardExpiry},
              is_default = ${v.isDefault}, is_active = ${v.isActive}, updated_at = now()
            WHERE id = ${id}`,
      );
      if (!r.rowCount) throw notFound('Broker');
    } else {
      const [row] = await queryRows<{ id: string }>(
        tx,
        sql`INSERT INTO broker_agents (company, company_vattin, grantee_name, grantee_id_no, grantee_phone, agent_name, agent_id_no,
              agent_phone, card_no, card_expiry, is_default, is_active)
            VALUES (${v.company}, ${v.companyVattin}, ${v.granteeName}, ${v.granteeIdNo}, ${v.granteePhone}, ${v.agentName},
              ${v.agentIdNo}, ${v.agentPhone}, ${v.cardNo}, ${v.cardExpiry}, ${v.isDefault}, ${v.isActive}) RETURNING id`,
      );
      rowId = row!.id;
    }
    await audit(
      tx,
      { action: id ? 'UPDATE' : 'CREATE', entity: 'broker_agent', entityId: rowId, after: v },
      req,
    );
    return rowId!;
  });
}

workflowRouter.post('/broker-agents', requirePermission('customs:write'), async (req, res) => {
  const id = await saveBroker(req, null);
  res.status(201).json({ id });
});
workflowRouter.put('/broker-agents/:id', requirePermission('customs:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  await saveBroker(req, id);
  res.json({ id });
});

/* ---------- Client signatories and standing authorizations ---------- */

async function visibleClient(req: Request, clientId: string, write = false) {
  const [c] = await queryRows<{ id: string }>(
    db,
    sql`SELECT id FROM clients WHERE id = ${clientId} AND deleted_at IS NULL`,
  );
  if (!c) throw notFound('Client');
  if (write) assertClientAllowed(req, clientId);
  else assertClientVisible(req, clientId, 'Client');
}

workflowRouter.get(
  '/clients/:id/signatories',
  requirePermission('clients:read'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleClient(req, id);
    res.json(
      await queryRows<ClientSignatoryRow>(
        db,
        sql`SELECT id, client_id AS "clientId", name, passport_no AS "passportNo", title, title_km AS "titleKm", is_default AS "isDefault"
          FROM client_signatories WHERE client_id = ${id} ORDER BY is_default DESC, created_at`,
      ),
    );
  },
);

async function saveSignatory(req: Request, clientId: string, id: string | null) {
  const v = parse(clientSignatoryInputSchema, req.body);
  await db.transaction(async (tx) => {
    if (v.isDefault)
      await tx.execute(
        sql`UPDATE client_signatories SET is_default = false WHERE client_id = ${clientId}`,
      );
    if (id) {
      const r = await tx.execute(
        sql`UPDATE client_signatories SET name = ${v.name}, passport_no = ${v.passportNo}, title = ${v.title},
              title_km = ${v.titleKm}, is_default = ${v.isDefault}, updated_at = now()
            WHERE id = ${id} AND client_id = ${clientId}`,
      );
      if (!r.rowCount) throw notFound('Signatory');
    } else {
      // The first one is the default.
      await tx.execute(
        sql`INSERT INTO client_signatories (client_id, name, passport_no, title, title_km, is_default)
            VALUES (${clientId}, ${v.name}, ${v.passportNo}, ${v.title}, ${v.titleKm},
              ${v.isDefault} OR NOT EXISTS (SELECT 1 FROM client_signatories WHERE client_id = ${clientId}))`,
      );
    }
    await audit(
      tx,
      {
        action: id ? 'UPDATE' : 'CREATE',
        entity: 'client_signatory',
        entityId: id,
        after: { clientId, ...v },
      },
      req,
    );
  });
}

workflowRouter.post(
  '/clients/:id/signatories',
  requirePermission('clients:write'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleClient(req, id, true);
    await saveSignatory(req, id, null);
    res.status(201).json({ ok: true });
  },
);
workflowRouter.put(
  '/clients/:id/signatories/:childId',
  requirePermission('clients:write'),
  async (req, res) => {
    const { id, childId } = parse(childParam, req.params);
    await visibleClient(req, id, true);
    await saveSignatory(req, id, childId);
    res.json({ ok: true });
  },
);
workflowRouter.delete(
  '/clients/:id/signatories/:childId',
  requirePermission('clients:write'),
  async (req, res) => {
    const { id, childId } = parse(childParam, req.params);
    await visibleClient(req, id, true);
    await db.transaction(async (tx) => {
      const r = await tx.execute(
        sql`DELETE FROM client_signatories WHERE id = ${childId} AND client_id = ${id}`,
      );
      if (!r.rowCount) throw notFound('Signatory');
      await audit(tx, { action: 'DELETE', entity: 'client_signatory', entityId: childId }, req);
    });
    res.status(204).end();
  },
);

workflowRouter.get(
  '/clients/:id/authorizations',
  requirePermission('clients:read'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleClient(req, id);
    const today = todayPP();
    const rows = await queryRows<Omit<ClientAuthorizationRow, 'daysLeft'>>(
      db,
      sql`SELECT id, client_id AS "clientId", kind, reference, to_char(issued_on, 'YYYY-MM-DD') AS "issuedOn",
                 to_char(valid_until, 'YYYY-MM-DD') AS "validUntil", notes, document_id AS "documentId"
          FROM client_authorizations WHERE client_id = ${id} AND deleted_at IS NULL
          ORDER BY valid_until NULLS LAST, created_at`,
    );
    res.json(rows.map((r) => ({ ...r, daysLeft: daysUntil(r.validUntil, today) })));
  },
);

async function saveAuthorization(req: Request, clientId: string, id: string | null) {
  const v = parse(clientAuthorizationInputSchema, req.body);
  await db.transaction(async (tx) => {
    if (id) {
      const r = await tx.execute(
        sql`UPDATE client_authorizations SET kind = ${v.kind}, reference = ${v.reference}, issued_on = ${v.issuedOn},
              valid_until = ${v.validUntil}, notes = ${v.notes}, document_id = ${v.documentId}, updated_at = now()
            WHERE id = ${id} AND client_id = ${clientId} AND deleted_at IS NULL`,
      );
      if (!r.rowCount) throw notFound('Authorization');
    } else {
      await tx.execute(
        sql`INSERT INTO client_authorizations (client_id, kind, reference, issued_on, valid_until, notes, document_id)
            VALUES (${clientId}, ${v.kind}, ${v.reference}, ${v.issuedOn}, ${v.validUntil}, ${v.notes}, ${v.documentId})`,
      );
    }
    await audit(
      tx,
      {
        action: id ? 'UPDATE' : 'CREATE',
        entity: 'client_authorization',
        entityId: id,
        after: { clientId, ...v },
      },
      req,
    );
  });
}

workflowRouter.post(
  '/clients/:id/authorizations',
  requirePermission('clients:write'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    await visibleClient(req, id, true);
    await saveAuthorization(req, id, null);
    res.status(201).json({ ok: true });
  },
);
workflowRouter.put(
  '/clients/:id/authorizations/:childId',
  requirePermission('clients:write'),
  async (req, res) => {
    const { id, childId } = parse(childParam, req.params);
    await visibleClient(req, id, true);
    await saveAuthorization(req, id, childId);
    res.json({ ok: true });
  },
);
workflowRouter.delete(
  '/clients/:id/authorizations/:childId',
  requirePermission('clients:write'),
  async (req, res) => {
    const { id, childId } = parse(childParam, req.params);
    await visibleClient(req, id, true);
    await db.transaction(async (tx) => {
      const r = await tx.execute(
        sql`UPDATE client_authorizations SET deleted_at = now() WHERE id = ${childId} AND client_id = ${id} AND deleted_at IS NULL`,
      );
      if (!r.rowCount) throw notFound('Authorization');
      await audit(tx, { action: 'DELETE', entity: 'client_authorization', entityId: childId }, req);
    });
    res.status(204).end();
  },
);
