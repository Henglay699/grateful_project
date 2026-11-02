import { Router } from 'express';
import { z } from 'zod';
import {
  containerNo,
  sealPlanInputSchema,
  sealPlanListQuerySchema,
  sealPlanStandaloneSchema,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { scopeClients } from '../../lib/clientScope';
import { attachmentName } from '../../lib/http';
import { sealPlanWorkbook } from './excel';
import * as svc from './service';

const idParam = z.object({ id: z.string().uuid('Invalid seal plan id') });
const shipmentParam = z.object({ id: z.string().uuid('Invalid shipment id') });
const containerParams = z.object({
  shipmentId: z.string().uuid('Invalid shipment id'),
  containerNo,
});

/** Seal Plans: the containers of export shipments with their seals, trucking and depot. */
export const sealPlansRouter = Router();
sealPlansRouter.use(requireAuth);

sealPlansRouter.get('/', requirePermission('sealplans:read'), async (req, res) => {
  const q = parse(sealPlanListQuerySchema, req.query);
  res.json(
    await svc.listSealPlans({
      year: q.year,
      month: q.month,
      q: q.q,
      clientIds: scopeClients(req, q.clientId, 'sealplans'),
    }),
  );
});

/** "+ New Seal Plan" picker: the latest export CY/CY shipments. */
/** Seal Plans → ⋯ → Export Excel: the list's filters, laid out like the SEAL PLAN sheet. */
sealPlansRouter.get('/export.xlsx', requirePermission('sealplans:read'), async (req, res) => {
  const q = parse(sealPlanListQuerySchema, req.query);
  const rows = await svc.listSealPlans({
    year: q.year,
    month: q.month,
    q: q.q,
    clientIds: scopeClients(req, q.clientId, 'sealplans'),
  });
  const wb = sealPlanWorkbook(rows, q.year, q.month);
  const period = q.month ? `${q.year}-${String(q.month).padStart(2, '0')}` : String(q.year);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', attachmentName(`seal-plan-${period}.xlsx`));
  await wb.xlsx.write(res);
  res.end();
});

sealPlansRouter.get('/shipments', requirePermission('sealplans:read'), async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(120).optional() }), req.query);
  res.json(
    await svc.sealPlanShipmentOptions(q || undefined, scopeClients(req, undefined, 'sealplans')),
  );
});

sealPlansRouter.get('/shipments/:id', requirePermission('sealplans:read'), async (req, res) => {
  const { id } = parse(shipmentParam, req.params);
  res.json(await svc.sealPlanShipment(id, req));
});

/** A plan started blank (no shipment). */
sealPlansRouter.post('/', requirePermission('sealplans:write'), async (req, res) => {
  const body = parse(sealPlanStandaloneSchema, req.body);
  res.status(201).json(await svc.createStandalonePlan(body, req));
});

sealPlansRouter.put('/:id', requirePermission('sealplans:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(sealPlanStandaloneSchema, req.body);
  await svc.updateStandalonePlan(id, body, req);
  res.status(204).end();
});

sealPlansRouter.delete('/:id', requirePermission('sealplans:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  await svc.deleteSealPlan(id, req);
  res.status(204).end();
});

/** A shipment's container (added to the shipment when it doesn't have that no. yet). */
sealPlansRouter.put(
  '/:shipmentId/:containerNo',
  requirePermission('sealplans:write'),
  async (req, res) => {
    const { shipmentId, containerNo } = parse(containerParams, req.params);
    const body = parse(sealPlanInputSchema, req.body);
    await svc.saveSealPlan(shipmentId, containerNo, body, req);
    res.status(204).end();
  },
);
