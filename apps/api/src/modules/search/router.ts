import { Router } from 'express';
import { globalSearchQuerySchema, type GlobalSearchResponse } from '@gs/shared';
import { requireAuth } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { scopeClients } from '../../lib/clientScope';
import { globalSearch } from './service';

export const searchRouter = Router();
searchRouter.use(requireAuth);

/** Top-bar suggestions; each kind is gated by its own read permission in the service. */
searchRouter.get('/', async (req, res) => {
  const { q } = parse(globalSearchQuerySchema, req.query);
  const body: GlobalSearchResponse = {
    hits: await globalSearch(q, req.auth!.permissions, scopeClients(req)),
  };
  res.json(body);
});
