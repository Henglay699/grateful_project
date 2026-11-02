import { Router } from 'express';
import { z } from 'zod';
import {
  customsReportQuerySchema,
  mihDraftQuerySchema,
  mihMonthInputSchema,
  mihYearQuerySchema,
  payrollMonthInputSchema,
  productionProfileSchema,
  productionReportQuerySchema,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { assertClientAllowed, assertClientVisible, scopeClients } from '../../lib/clientScope';
import * as customs from './customs';
import * as mih from './mih';
import * as svc from './service';

/** Reports (Payroll, MIH, Import & Export). A payroll file is read in the browser; saving keeps it. */
export const reportsRouter = Router();
reportsRouter.use(requireAuth);

/** Payroll → Capacity report: the month's exports by product line, and the saved setup. */
reportsRouter.get('/production', requirePermission('reports:read'), async (req, res) => {
  const q = parse(productionReportQuerySchema, req.query);
  assertClientVisible(req, q.clientId, 'Client');
  res.json(await svc.productionReport(q.clientId, q.month));
});

reportsRouter.put(
  '/production/profile/:clientId',
  requirePermission('reports:write'),
  async (req, res) => {
    const { clientId } = parse(z.object({ clientId: z.string().uuid() }), req.params);
    assertClientAllowed(req, clientId);
    res.json(await svc.saveProfile(clientId, parse(productionProfileSchema, req.body), req));
  },
);

const idParam = z.object({ id: z.string().uuid('Invalid payroll month id') });

/** Payroll → saved months, newest first. */
reportsRouter.get('/payroll', requirePermission('reports:read'), async (req, res) => {
  res.json(await svc.listPayrollMonths(scopeClients(req)));
});

/** One saved month with its staff rows, to reopen it as imported. */
reportsRouter.get('/payroll/:id', requirePermission('reports:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const month = await svc.getPayrollMonth(id);
  assertClientVisible(req, month.clientId, 'Payroll month');
  res.json(month);
});

/** Payroll → Save month. 409 when the month is saved already and `replace` isn't set. */
reportsRouter.post('/payroll', requirePermission('reports:write'), async (req, res) => {
  const v = parse(payrollMonthInputSchema, req.body);
  assertClientAllowed(req, v.clientId);
  res.status(201).json(await svc.savePayrollMonth(v, req));
});

reportsRouter.delete('/payroll/:id', requirePermission('reports:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const month = await svc.getPayrollMonth(id);
  assertClientVisible(req, month.clientId, 'Payroll month');
  await svc.deletePayrollMonth(id, req);
  res.status(204).end();
});

/** Import & Export: the factory's invoice lines by customs declaration, for a run of months. */
reportsRouter.get('/customs', requirePermission('reports:read'), async (req, res) => {
  const q = parse(customsReportQuerySchema, req.query);
  assertClientVisible(req, q.clientId, 'Client');
  res.json(await customs.customsReport(q));
});

/* ---------- MIH: the monthly report to the Ministry of Industry ---------- */

const mihIdParam = z.object({ id: z.string().uuid('Invalid MIH month id') });

/** MIH → saved months, newest first. */
reportsRouter.get('/mih', requirePermission('reports:read'), async (req, res) => {
  res.json(await mih.listMihMonths(scopeClients(req)));
});

/** A factory's saved months of the year, to add up the year-to-date. */
reportsRouter.get('/mih/year', requirePermission('reports:read'), async (req, res) => {
  const q = parse(mihYearQuerySchema, req.query);
  assertClientVisible(req, q.clientId, 'Client');
  res.json(await mih.mihYear(q.clientId, q.year));
});

/** A new month filled in from the payroll, the invoices and the last saved month. */
reportsRouter.get('/mih/draft', requirePermission('reports:read'), async (req, res) => {
  const q = parse(mihDraftQuerySchema, req.query);
  assertClientVisible(req, q.clientId, 'Client');
  res.json(await mih.mihDraft(q.clientId, q.month));
});

reportsRouter.get('/mih/:id', requirePermission('reports:read'), async (req, res) => {
  const { id } = parse(mihIdParam, req.params);
  const month = await mih.getMihMonth(id);
  assertClientVisible(req, month.clientId, 'MIH month');
  res.json(month);
});

/** MIH → Save month. 409 when the month is saved already and `replace` isn't set. */
reportsRouter.post('/mih', requirePermission('reports:write'), async (req, res) => {
  const v = parse(mihMonthInputSchema, req.body);
  assertClientAllowed(req, v.clientId);
  res.status(201).json(await mih.saveMihMonth(v, req));
});

reportsRouter.delete('/mih/:id', requirePermission('reports:write'), async (req, res) => {
  const { id } = parse(mihIdParam, req.params);
  const month = await mih.getMihMonth(id);
  assertClientAllowed(req, month.clientId);
  await mih.deleteMihMonth(id, req);
  res.status(204).end();
});
