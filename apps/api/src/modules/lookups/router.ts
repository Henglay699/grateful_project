import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  LOOKUP_TYPES,
  consigneeInputSchema,
  forwarderInputSchema,
  type LookupType,
  type LookupsResponse,
  type Permission,
} from '@gs/shared';
import { db } from '../../db/client';
import {
  clients,
  consignees,
  countries,
  forwarders,
  lookupValues,
  ports,
  shipments,
} from '../../db/schema';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { anyAllowedClients, assertClientAllowed } from '../../lib/clientScope';

export const lookupsRouter = Router();
lookupsRouter.use(requireAuth);

/** Everything the forms' dropdowns need, in one request. */
lookupsRouter.get('/', async (req, res) => {
  const [c, cn, f, p, co, v, br] = await Promise.all([
    db
      .select({
        id: clients.id,
        code: clients.code,
        name: clients.name,
        legalName: clients.legalName,
        status: clients.status,
        commissionUsd: clients.commissionUsd,
      })
      .from(clients)
      .where(isNull(clients.deletedAt))
      .orderBy(asc(clients.name)),
    db
      .select({
        id: consignees.id,
        name: consignees.name,
        clientId: consignees.clientId,
        countryIso2: consignees.countryIso2,
      })
      .from(consignees)
      .where(eq(consignees.isActive, true))
      .orderBy(asc(consignees.name)),
    db
      .select({ id: forwarders.id, code: forwarders.code, name: forwarders.name })
      .from(forwarders)
      .where(eq(forwarders.isActive, true))
      .orderBy(asc(forwarders.name)),
    db
      .select({
        id: ports.id,
        code: ports.code,
        name: ports.name,
        shortName: ports.shortName,
        kind: ports.kind,
        customsPortNo: ports.customsPortNo,
      })
      .from(ports)
      .where(eq(ports.isActive, true))
      .orderBy(asc(ports.name)),
    db
      .select({ iso2: countries.iso2, name: countries.name })
      .from(countries)
      .orderBy(asc(countries.name)),
    db
      .select({ type: lookupValues.type, value: lookupValues.value, label: lookupValues.label })
      .from(lookupValues)
      .where(eq(lookupValues.isActive, true))
      .orderBy(asc(lookupValues.type), asc(lookupValues.sortOrder)),
    // Brokers are typed on shipments (no table of their own): every name used so far.
    db
      .selectDistinct({ name: sql<string>`trim(${shipments.broker})` })
      .from(shipments)
      .where(and(isNull(shipments.deletedAt), sql`trim(coalesce(${shipments.broker}, '')) <> ''`))
      .orderBy(sql`trim(${shipments.broker})`),
  ]);
  const values = Object.fromEntries(
    LOOKUP_TYPES.map((t) => [t, [] as { value: string; label: string }[]]),
  ) as LookupsResponse['values'];
  for (const row of v) values[row.type as LookupType].push({ value: row.value, label: row.label });
  // Users limited to some clients only get those clients (and their consignees): every client
  // they may use in any section, since sections can have their own client access.
  const allowed = anyAllowedClients(req);
  const body: LookupsResponse = {
    clients: allowed ? c.filter((x) => allowed.includes(x.id)) : c,
    consignees: allowed ? cn.filter((x) => !x.clientId || allowed.includes(x.clientId)) : cn,
    forwarders: f,
    ports: p,
    countries: co,
    brokers: br.map((x) => x.name),
    values,
  };
  res.json(body);
});

lookupsRouter.post('/consignees', requirePermission('shipments:write'), async (req, res) => {
  const input = parse(consigneeInputSchema, req.body);
  if (input.clientId) assertClientAllowed(req, input.clientId, 'shipments');
  const row = await db.transaction(async (tx) => {
    // A consignee deleted from Client Details (inactive) comes back instead of clashing on its name.
    const [inactive] = await tx
      .select()
      .from(consignees)
      .where(
        and(sql`lower(${consignees.name}) = lower(${input.name})`, eq(consignees.isActive, false)),
      );
    if (inactive) {
      const [back] = await tx
        .update(consignees)
        .set({
          isActive: true,
          clientId: input.clientId ?? inactive.clientId,
          countryIso2: input.countryIso2 ?? inactive.countryIso2,
        })
        .where(eq(consignees.id, inactive.id))
        .returning();
      await audit(
        tx,
        {
          action: 'UPDATE',
          entity: 'consignee',
          entityId: back!.id,
          before: inactive,
          after: back,
        },
        req,
      );
      return back!;
    }
    const [created] = await tx.insert(consignees).values(input).returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'consignee', entityId: created!.id, after: created },
      req,
    );
    return created!;
  });
  res
    .status(201)
    .json({ id: row.id, name: row.name, clientId: row.clientId, countryIso2: row.countryIso2 });
});

lookupsRouter.post('/forwarders', requirePermission('shipments:write'), async (req, res) => {
  const input = parse(forwarderInputSchema, req.body);
  const code =
    input.code ??
    input.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 12);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(forwarders).values({ code, name: input.name }).returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'forwarder', entityId: created!.id, after: created },
      req,
    );
    return created!;
  });
  res.status(201).json({ id: row.id, code: row.code, name: row.name });
});

/**
 * "+ Add New" in a credit note line's dropdowns: adds a charge description (Charge descriptions)
 * or a unit (Charge units) to its list in Settings → Dropdown lists; in a record summary's
 * Quantity, a unit (Quantity units); in a shipping plan's CO Form, a form (CO forms, stored by
 * its code: "Form XYZ" or "XYZ" is kept as XYZ and shown as "Form XYZ"). Stored in capitals; one
 * that already exists is returned as is.
 */
const quickAdd = (
  type: 'CHARGE' | 'CHARGE_UNIT' | 'QUANTITY_UNIT' | 'CO_FORM',
  path: string,
  permission: Permission,
  min: number,
  max: number,
  toItem: (typed: string) => { value: string; label: string } = (typed) => {
    const value = typed.toUpperCase();
    return { value, label: value };
  },
) =>
  lookupsRouter.post(path, requirePermission(permission), async (req, res) => {
    const { label } = parse(
      z.object({ label: z.string().trim().min(min, 'Enter the item').max(max) }),
      req.body,
    );
    const item = toItem(label);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(lookupValues)
        .values({ type, ...item, sortOrder: 999 })
        .onConflictDoNothing()
        .returning();
      if (!created) return null;
      await audit(
        tx,
        { action: 'CREATE', entity: 'lookup_value', entityId: created.id, after: created },
        req,
      );
      return created;
    });
    res.status(row ? 201 : 200).json(item);
  });
quickAdd('CHARGE', '/charges', 'creditnotes:write', 2, 200);
quickAdd('CHARGE_UNIT', '/charge-units', 'creditnotes:write', 1, 20);
quickAdd('QUANTITY_UNIT', '/quantity-units', 'recordsummaries:write', 1, 20);
quickAdd('CO_FORM', '/co-forms', 'shipments:write', 1, 30, (typed) => {
  const value = typed
    .toUpperCase()
    .replace(/^FORM\s+/, '')
    .trim();
  return { value, label: `Form ${value}` };
});
