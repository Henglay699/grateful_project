import { Router } from 'express';
import { z } from 'zod';
import {
  clientInputSchema,
  clientListQuerySchema,
  clientConsigneeInputSchema,
  clientNoteInputSchema,
  consigneeAddressSchema,
  supplierInputSchema,
  hasPermission,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import * as svc from './service';
import * as notes from './notes';
import * as parties from './parties';
import {
  allowedClients,
  assertClientAllowed,
  assertClientVisible,
  scopeClients,
} from '../../lib/clientScope';

const idParam = z.object({ id: z.string().uuid('Invalid client id') });
const consigneeParams = idParam.extend({ consigneeId: z.string().uuid('Invalid consignee id') });
const noteParams = idParam.extend({ noteId: z.string().uuid('Invalid note id') });
export const clientsRouter = Router();
clientsRouter.use(requireAuth);

clientsRouter.get('/', requirePermission('clients:read'), async (req, res) => {
  const q = parse(clientListQuerySchema, req.query);
  res.json(
    await svc.listClients({
      ...q,
      ids: scopeClients(req, undefined, 'clients'),
      withProfit: hasPermission(req.auth!.permissions, 'accounting:read'),
    }),
  );
});

clientsRouter.get('/:id', requirePermission('clients:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  res.json(await svc.getClient(id, hasPermission(req.auth!.permissions, 'accounting:read')));
});

clientsRouter.post('/', requirePermission('clients:write'), async (req, res) => {
  // A user limited to some clients can't add new ones (they'd never see them).
  if (allowedClients(req, 'clients')) assertClientAllowed(req, null, 'clients');
  const id = await svc.createClient(parse(clientInputSchema, req.body), req);
  res.status(201).json({ id });
});

clientsRouter.patch('/:id', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  await svc.updateClient(id, parse(clientInputSchema.partial(), req.body), req);
  res.json({ id });
});

clientsRouter.delete('/:id', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  await svc.deleteClient(id, req);
  res.status(204).end();
});

/* ---------- Remarks: notes per client (Client Details) ---------- */

clientsRouter.get('/:id/notes', requirePermission('clients:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  res.json(await notes.listNotes(id));
});

clientsRouter.post('/:id/notes', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  res.status(201).json(await notes.createNote(id, parse(clientNoteInputSchema, req.body), req));
});

clientsRouter.put('/:id/notes/:noteId', requirePermission('clients:write'), async (req, res) => {
  const { id, noteId } = parse(noteParams, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  await notes.updateNote(id, noteId, parse(clientNoteInputSchema, req.body), req);
  res.status(204).end();
});

clientsRouter.delete('/:id/notes/:noteId', requirePermission('clients:write'), async (req, res) => {
  const { id, noteId } = parse(noteParams, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  await notes.deleteNote(id, noteId, req);
  res.status(204).end();
});

/* ---------- Suppliers and consignees: addresses for the INV + PL letterhead ---------- */

clientsRouter.put('/:id/suppliers', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  res.json(await parties.saveSupplier(id, parse(supplierInputSchema, req.body), req));
});

/** Deletes a supplier from the list, by name (it may have no record: a shipper name only). */
clientsRouter.delete('/:id/suppliers', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  const { name } = parse(supplierInputSchema.pick({ name: true }), req.query);
  await parties.deleteSupplier(id, name, req);
  res.status(204).end();
});

clientsRouter.post('/:id/consignees', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client', 'clients');
  res
    .status(201)
    .json(await parties.addConsignee(id, parse(clientConsigneeInputSchema, req.body), req));
});

clientsRouter.delete(
  '/:id/consignees/:consigneeId',
  requirePermission('clients:write'),
  async (req, res) => {
    const { id, consigneeId } = parse(consigneeParams, req.params);
    assertClientVisible(req, id, 'Client', 'clients');
    await parties.deleteConsignee(id, consigneeId, req);
    res.status(204).end();
  },
);

clientsRouter.patch(
  '/:id/consignees/:consigneeId',
  requirePermission('clients:write'),
  async (req, res) => {
    const { id, consigneeId } = parse(consigneeParams, req.params);
    assertClientVisible(req, id, 'Client', 'clients');
    const { address } = parse(consigneeAddressSchema, req.body);
    await parties.setConsigneeAddress(id, consigneeId, address, req);
    res.status(204).end();
  },
);
