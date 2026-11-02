import { Router } from 'express';
import { z } from 'zod';
import {
  ROLE_CODES,
  resetPasswordSchema,
  rolePermissionsSchema,
  staffInputSchema,
  staffUpdateSchema,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import * as svc from './service';

const idParam = z.object({ id: z.string().uuid() });
export const staffRouter = Router();
staffRouter.use(requireAuth);

staffRouter.get('/', requirePermission('staff:read'), async (_req, res) =>
  res.json(await svc.listStaff()),
);
staffRouter.get('/roles', requirePermission('staff:read'), async (_req, res) =>
  res.json(await svc.listRoles()),
);
staffRouter.post('/', requirePermission('staff:manage'), async (req, res) =>
  res.status(201).json(await svc.createStaff(parse(staffInputSchema, req.body), req)),
);
staffRouter.patch('/:id', requirePermission('staff:manage'), async (req, res) =>
  res.json(
    await svc.updateStaff(parse(idParam, req.params).id, parse(staffUpdateSchema, req.body), req),
  ),
);
staffRouter.post('/:id/reset-password', requirePermission('staff:manage'), async (req, res) => {
  await svc.resetPassword(
    parse(idParam, req.params).id,
    parse(resetPasswordSchema, req.body).password,
    req,
  );
  res.status(204).end();
});
staffRouter.delete('/:id', requirePermission('staff:manage'), async (req, res) => {
  await svc.removeStaff(parse(idParam, req.params).id, req);
  res.status(204).end();
});
staffRouter.put('/roles/:code', requirePermission('staff:manage'), async (req, res) => {
  const { code } = parse(z.object({ code: z.enum(ROLE_CODES) }), req.params);
  res.json(
    await svc.setRolePermissions(code, parse(rolePermissionsSchema, req.body).permissions, req),
  );
});
