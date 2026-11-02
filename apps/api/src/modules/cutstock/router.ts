import { Router } from 'express';
import { z } from 'zod';
import {
  boolParam,
  cutStockItemInputSchema,
  cutStockItemUpdateSchema,
  cutStockListQuerySchema,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { forbidden } from '../../lib/errors';
import { attachmentName, excelUpload, requireFile } from '../../lib/http';
import { db } from '../../db/client';
import { clients } from '../../db/schema';
import { eq } from 'drizzle-orm';
import * as svc from './service';
import { assertClientAllowed, assertClientVisible } from '../../lib/clientScope';

const idParam = z.object({ id: z.string().uuid('Invalid item id') });
const clientQuery = z.object({ clientId: z.string().uuid('Choose a client') });
export const cutStockRouter = Router();
cutStockRouter.use(requireAuth);

cutStockRouter.get('/', requirePermission('cutstock:read'), async (req, res) => {
  const q = parse(cutStockListQuerySchema, req.query);
  assertClientVisible(req, q.clientId, 'Client', 'cutstock');
  res.json(await svc.listCutStock(q));
});

/** Item picker for CDC lines (any role that can edit shipments). */
cutStockRouter.get('/options', requirePermission('shipments:read'), async (req, res) => {
  const { clientId, q } = parse(
    clientQuery.extend({ q: z.string().trim().max(80).optional() }),
    req.query,
  );
  assertClientVisible(req, clientId, 'Client', 'cutstock');
  res.json(await svc.cutStockOptions(clientId, q));
});

cutStockRouter.get('/export.xlsx', requirePermission('cutstock:read'), async (req, res) => {
  const { clientId } = parse(clientQuery, req.query);
  assertClientVisible(req, clientId, 'Client', 'cutstock');
  const [c] = await db.select({ code: clients.code }).from(clients).where(eq(clients.id, clientId));
  const wb = await svc.exportMasterList(clientId);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    attachmentName(
      `${c?.code ?? 'client'}-cdc-master-list-${new Date().toISOString().slice(0, 10)}.xlsx`,
    ),
  );
  await wb.xlsx.write(res);
  res.end();
});

cutStockRouter.post(
  '/import',
  requirePermission('cutstock:write'),
  excelUpload,
  async (req, res) => {
    const q = parse(clientQuery.extend({ dryRun: boolParam, updateOpening: boolParam }), req.query);
    assertClientAllowed(req, q.clientId, 'cutstock');
    const file = requireFile(req.file);
    res.json(
      await svc.importMasterList(
        q.clientId,
        file.buffer,
        { dryRun: q.dryRun ?? true, updateOpening: q.updateOpening ?? false },
        req,
      ),
    );
  },
);

cutStockRouter.get('/:id', requirePermission('cutstock:read'), async (req, res) => {
  const item = await svc.getCutStockItem(parse(idParam, req.params).id);
  assertClientVisible(req, item.clientId, 'Item', 'cutstock');
  res.json(item);
});

cutStockRouter.post('/', requirePermission('cutstock:write'), async (req, res) => {
  // New master-list items are added by the IT administrator only; the rest import or edit.
  if (req.auth!.role !== 'ADMIN') throw forbidden('Only an administrator can add items');
  const input = parse(cutStockItemInputSchema, req.body);
  assertClientAllowed(req, input.clientId, 'cutstock');
  const id = await svc.createCutStockItem(input, req);
  res.status(201).json(await svc.getCutStockItem(id));
});

cutStockRouter.patch('/:id', requirePermission('cutstock:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, (await svc.getCutStockItem(id)).clientId, 'Item', 'cutstock');
  await svc.updateCutStockItem(id, parse(cutStockItemUpdateSchema, req.body), req);
  res.json(await svc.getCutStockItem(id));
});

cutStockRouter.delete('/:id', requirePermission('cutstock:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, (await svc.getCutStockItem(id)).clientId, 'Item', 'cutstock');
  await svc.deleteCutStockItem(id, req);
  res.status(204).end();
});
