import { Router } from 'express';
import { z } from 'zod';
import { coBreakdownSchema, coListQuerySchema, coRecordInputSchema } from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { scopeClients } from '../../lib/clientScope';
import * as svc from './service';

const invoiceParam = z.object({ invoiceId: z.string().uuid('Invalid invoice id') });

/** CO: certificates of origin of export invoices (CO Plans) and their GSP breakdowns. */
export const coRouter = Router();
coRouter.use(requireAuth);

coRouter.get('/', requirePermission('shipments:read'), async (req, res) => {
  const q = parse(coListQuerySchema, req.query);
  res.json(
    await svc.listCo({
      from: q.from,
      to: q.to,
      status: q.status,
      all: q.all,
      clientIds: scopeClients(req, q.clientId),
    }),
  );
});

coRouter.get('/:invoiceId', requirePermission('shipments:read'), async (req, res) => {
  const { invoiceId } = parse(invoiceParam, req.params);
  res.json(await svc.getCo(invoiceId, req));
});

coRouter.put('/:invoiceId', requirePermission('shipments:write'), async (req, res) => {
  const { invoiceId } = parse(invoiceParam, req.params);
  await svc.saveCoRecord(invoiceId, parse(coRecordInputSchema, req.body), req);
  res.status(204).end();
});

coRouter.put('/:invoiceId/breakdown', requirePermission('shipments:write'), async (req, res) => {
  const { invoiceId } = parse(invoiceParam, req.params);
  await svc.saveBreakdown(invoiceId, parse(coBreakdownSchema, req.body), req);
  res.status(204).end();
});
