/* eslint-disable no-console -- CLI script: progress goes to the terminal */
/**
 * pnpm db:seed — wipes and repopulates the database with a realistic, deterministic
 * 2026 dataset so every chart has data on first run. Refuses to run in production.
 */
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import {
  ROLE_CODES,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_LABEL,
  computeLedger,
  nextBusinessDay,
  toMoneyString,
  type Direction,
  type TransportMode,
  type LoadType,
  type ShipmentStatus,
  type ClearanceStatus,
  type ContainerSize,
} from '@gs/shared';
import { db, pool } from '../client';
import * as s from '../schema';
import { env, isProd } from '../../config/env';
import { seedWorkflow } from './workflow';
import { createRng, containerNumber, addDays, isoDate, daysInMonth } from './rng';
import {
  COUNTRIES,
  PORTS,
  FORWARDERS,
  CLIENTS,
  CONSIGNEES,
  VESSELS,
  LOOKUPS,
  COMPANY,
} from './data/reference';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMasterList } from '../../lib/masterList';
import { recomputeShipmentStatuses } from '../shipmentStatus';
import quotationTemplates from './data/quotation-templates.json' with { type: 'json' };

const YEAR = 2026;
const YY = '26';
/** "Today" for the generated data. Defaults to the real date so statuses look live. */
const TODAY = process.env.SEED_TODAY ?? new Date().toISOString().slice(0, 10);
const rng = createRng(20260101);

const log = (msg: string) => console.log(`  • ${msg}`);

async function wipe() {
  const res = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const tables = res.rows.map((r) => `"${r.tablename}"`).join(', ');
  if (tables) await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  if (isProd && !process.argv.includes('--force')) {
    throw new Error(
      'Refusing to seed with NODE_ENV=production (pass --force if you really mean it).',
    );
  }
  const password = env.SEED_DEFAULT_PASSWORD;
  if (!password)
    throw new Error('Set SEED_DEFAULT_PASSWORD in .env (min 10 characters) before seeding.');

  console.log(`Seeding database (data "today" = ${TODAY})…`);
  await wipe();

  /* ---------- Roles & users ---------- */
  const roleRows = await db
    .insert(s.roles)
    .values(
      ROLE_CODES.map((code) => ({
        code,
        name: ROLE_LABEL[code],
        permissions: [...ROLE_DEFAULT_PERMISSIONS[code]],
      })),
    )
    .returning();
  const roleId = (code: string) => roleRows.find((r) => r.code === code)!.id;

  const passwordHash = await bcrypt.hash(password, 12);
  const people = [
    {
      email: 'admin@gs.local',
      fullName: 'System Administrator',
      role: 'ADMIN',
      jobTitle: 'IT Administrator',
      dept: 'Management',
      avatar: null,
    },
    {
      email: 'aden.whitfield@gs.local',
      fullName: 'Aden Whitfield',
      role: 'MANAGER',
      jobTitle: 'Customer Service Manager',
      dept: 'Operations',
      avatar: '/avatar.png',
    },
    {
      email: 'marcus.ellery@gs.local',
      fullName: 'Marcus Ellery',
      role: 'ACCOUNTANT',
      jobTitle: 'Financial Analyst',
      dept: 'Accounting',
      avatar: null,
    },
    {
      email: 'sokha.chan@gs.local',
      fullName: 'Sokha Chan',
      role: 'OPERATOR',
      jobTitle: 'Logistics Operator',
      dept: 'Operations',
      avatar: null,
    },
    {
      email: 'dara.kim@gs.local',
      fullName: 'Dara Kim',
      role: 'VIEWER',
      jobTitle: 'Sales Coordinator',
      dept: 'Customer Service',
      avatar: null,
    },
    {
      email: 'ceo@gs.local',
      fullName: 'Vichea Lim',
      role: 'CEO',
      jobTitle: 'Chief Executive Officer',
      dept: 'Management',
      avatar: null,
    },
    {
      email: 'ops.manager@gs.local',
      fullName: 'Sreyneang Ouk',
      role: 'OPERATION_MANAGER',
      jobTitle: 'Operation Manager',
      dept: 'Operations',
      avatar: null,
    },
    {
      email: 'broker@gs.local',
      fullName: 'Sokchea Sea',
      role: 'CUSTOMS_BROKER',
      jobTitle: 'Customs Broker',
      dept: 'Customs',
      avatar: null,
    },
  ] as const;
  const userRows = await db
    .insert(s.users)
    .values(
      people.map((p) => ({
        email: p.email,
        fullName: p.fullName,
        passwordHash,
        roleId: roleId(p.role),
        avatarUrl: p.avatar,
      })),
    )
    .returning();
  await db.insert(s.staffProfiles).values(
    people.map((p, i) => ({
      userId: userRows[i]!.id,
      jobTitle: p.jobTitle,
      department: p.dept,
      status: 'ACTIVE' as const,
      joinedOn: '2024-03-01',
    })),
  );
  const operatorId = userRows[3]!.id;
  const managerId = userRows[1]!.id;
  const accountantId = userRows[2]!.id;
  log(`${roleRows.length} roles, ${userRows.length} users`);

  /* ---------- Reference data ---------- */
  // Migration 0041 already lists every country: these add the map coordinates.
  await db
    .insert(s.countries)
    .values(COUNTRIES)
    .onConflictDoUpdate({
      target: s.countries.iso2,
      set: { name: sql`excluded.name`, lat: sql`excluded.lat`, lng: sql`excluded.lng` },
    });
  const portRows = await db
    .insert(s.ports)
    .values(PORTS.map((p) => ({ ...p, countryIso2: 'KH' })))
    .returning();
  const port = (code: string) => portRows.find((p) => p.code === code)!;
  const fwdRows = await db
    .insert(s.forwarders)
    .values(FORWARDERS.map((f) => ({ code: f.code, name: f.name })))
    .returning();
  const clientRows = await db
    .insert(s.clients)
    .values(CLIENTS.map(({ weight: _w, ...c }) => c))
    .returning();
  const clientByCode = (code: string) => clientRows.find((c) => c.code === code)!;
  const consigneeRows = await db
    .insert(s.consignees)
    .values(
      CONSIGNEES.map((c) => ({
        name: c.name,
        countryIso2: c.country,
        clientId: c.client ? clientByCode(c.client).id : null,
      })),
    )
    .returning();
  await db.insert(s.lookupValues).values(
    Object.entries(LOOKUPS).flatMap(([type, values]) =>
      values.map((v, i) => ({
        type: type as (typeof s.lookupTypeEnum.enumValues)[number],
        value: v,
        label: type === 'CO_FORM' ? (v === 'CRF' ? 'CO Reference Form' : `Form ${v}`) : v,
        sortOrder: i,
      })),
    ),
  );
  await db.insert(s.settings).values([
    { key: 'company', value: COMPANY },
    { key: 'defaultClearancePortCode', value: 'SHV11' },
    { key: 'baseExchangeRate', value: 4026 },
  ]);
  const monthlyRate = (m: number) => 4010 + ((m * 7) % 30); // 4017…4039, varies by month
  await db.insert(s.exchangeRates).values(
    Array.from({ length: 12 }, (_, i) => ({
      effectiveDate: isoDate(YEAR, i + 1, 1),
      usdToKhr: String(monthlyRate(i + 1)),
      createdById: accountantId,
    })),
  );
  await db
    .insert(s.quotationTemplates)
    .values(quotationTemplates as (typeof s.quotationTemplates.$inferInsert)[]);
  log(
    `${COUNTRIES.length} countries, ${portRows.length} ports, ${fwdRows.length} forwarders, ${clientRows.length} clients, ${quotationTemplates.length} quotation templates`,
  );

  /* ---------- Cut stock (JR CDC master list) ---------- */
  const master = await readMasterList(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'jr-cdc-master-list.xlsx'),
  );
  const jr = clientByCode('JR');
  const cutRows: (typeof s.cutStockItems.$inferSelect)[] = [];
  for (const part of chunk(master, 100)) {
    cutRows.push(
      ...(await db
        .insert(s.cutStockItems)
        .values(
          part.map((r) => ({
            clientId: jr.id,
            lineNo: r.lineNo,
            declareRef: r.declareRef,
            category: r.category,
            name: r.name,
            newOrUsed: r.newOrUsed,
            unit: r.unit,
            qty: String(r.qty),
            unitPrice: String(r.unitPrice),
            remarks: r.remarks,
            openingImportedQty: String(r.importedQty),
            openingImportedValue: toMoneyString(r.importedValue),
            openingImportedNw: String(r.importedNw),
          })),
        )
        .returning()),
    );
  }
  const mismatch = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM cut_stock_items i JOIN cut_stock_balances b ON b.item_id = i.id
    WHERE b.balance <> i.qty - i.opening_imported_qty`);
  log(
    `${cutRows.length} cut-stock items from JR CDC MASTER LIST.xlsx (${master.filter((r) => r.sheetBalance < 0).length} already over-imported; view check: ${mismatch.rows[0]?.n} mismatches)`,
  );

  /* ---------- Shipments ---------- */
  const perMonth = [16, 19, 17, 21, 24, 33, 29, 24, 21, 20, 18, 20]; // peaks in June like the prototype curve
  const origins = [
    ['CN', 45],
    ['TW', 15],
    ['VN', 10],
    ['KR', 8],
    ['JP', 8],
    ['HK', 6],
    ['TH', 5],
    ['AT', 3],
  ] as const;
  const destinations = [
    ['US', 45],
    ['DE', 15],
    ['JP', 12],
    ['GB', 8],
    ['CA', 6],
    ['AU', 5],
    ['FR', 5],
    ['NL', 4],
  ] as const;
  const exportConsignees = consigneeRows.filter((c) => !c.clientId);

  type NewShipment = typeof s.shipments.$inferInsert;
  interface Plan {
    row: NewShipment;
    containers: {
      containerNo: string;
      size: ContainerSize;
      linerSeal: string;
      customsSeal: string | null;
    }[];
    invoices: {
      invoiceNo: string;
      invoiceDate: string;
      description: string;
      lines: (typeof s.cargoInvoiceLines.$inferInsert)[];
    }[];
    clientCode: string;
    forwarderCode: string;
  }
  const plans: Plan[] = [];
  let seqShipment = 0;
  let seqExportInv = 40;
  let seqImportInv = 30;

  for (let m = 1; m <= 12; m++) {
    for (let k = 0; k < perMonth[m - 1]!; k++) {
      const client = rng.weighted(CLIENTS, (c) => c.weight);
      const direction: Direction = rng.chance(0.55) ? 'IMPORT' : 'EXPORT';
      const modeRoll = rng.next();
      const transportMode: TransportMode =
        modeRoll < 0.78 ? 'SEA' : modeRoll < 0.95 ? 'AIR' : 'ROAD';
      const loadType: LoadType =
        transportMode === 'SEA' ? (rng.chance(0.7) ? 'FCL' : 'LCL') : 'NONE';
      const fwd = rng.weighted(FORWARDERS, (f) => f.weight);
      const clearancePort =
        transportMode === 'AIR'
          ? port('PNH01')
          : transportMode === 'ROAD'
            ? port(rng.chance(0.8) ? 'SVR11' : 'SVR12')
            : port(
                rng.weighted(
                  [
                    ['SHV11', 60],
                    ['PNH04', 15],
                    ['PNH21', 12],
                    ['PNH19', 8],
                    ['PNH16', 5],
                  ] as const,
                  (p) => p[1],
                )[0],
              );
      const eta = isoDate(YEAR, m, rng.int(1, daysInMonth(YEAR, m)));
      const transit =
        transportMode === 'AIR'
          ? rng.int(2, 4)
          : transportMode === 'ROAD'
            ? rng.int(2, 5)
            : rng.int(14, 30);
      const etd = addDays(eta, -transit);
      const daysFromToday = (Date.parse(eta) - Date.parse(TODAY)) / 86_400_000;

      let status: ShipmentStatus;
      if (daysFromToday < -10)
        status = rng.weighted(
          [
            ['COMPLETED', 95],
            ['IN_PROGRESS', 5],
          ] as const,
          (x) => x[1],
        )[0];
      else if (daysFromToday <= 7)
        status = rng.weighted(
          [
            ['IN_PROGRESS', 65],
            ['PENDING', 27],
            ['COMPLETED', 8],
          ] as const,
          (x) => x[1],
        )[0];
      else status = 'PENDING';
      const clearanceStatus: ClearanceStatus =
        status === 'COMPLETED'
          ? 'CLEARED'
          : status === 'IN_PROGRESS'
            ? rng.weighted(
                [
                  ['IN_PROGRESS', 55],
                  ['PENDING', 35],
                  ['EXCEPTION', 10],
                ] as const,
                (x) => x[1],
              )[0]
            : 'PENDING';

      const arrived = status === 'COMPLETED' || (status !== 'PENDING' && daysFromToday < 0);
      // Punctual forwarders arrive on/before ETA more often (drives the on-time % ranking).
      const ata = arrived
        ? addDays(eta, rng.chance(fwd.punctuality) ? rng.int(-2, 0) : rng.int(1, 6))
        : null;
      const atd =
        Date.parse(etd) <= Date.parse(TODAY) ? addDays(etd, rng.chance(0.85) ? 0 : 1) : null;

      const material =
        direction === 'EXPORT'
          ? 'Garments'
          : rng.weighted(
              [
                ['Fabric', 55],
                ['Trims & Accessories', 30],
                ['Machinery', 10],
                ['Packing Material', 5],
              ] as const,
              (x) => x[1],
            )[0];
      const unit = direction === 'EXPORT' ? 'CTNS' : material === 'Fabric' ? 'ROLLS' : 'PKGS';

      const ctnCount =
        loadType === 'FCL'
          ? rng.weighted(
              [
                [1, 70],
                [2, 22],
                [3, 8],
              ] as const,
              (x) => x[1],
            )[0]
          : 0;
      const containers = Array.from({ length: ctnCount }, () => ({
        containerNo: containerNumber(rng, rng.pick(fwd.ctnPrefixes)),
        size: rng.weighted(
          [
            ['40HQ', 55],
            ['20GP', 30],
            ['40GP', 15],
          ] as const,
          (x) => x[1],
        )[0] as ContainerSize,
        linerSeal: `LS-${rng.int(1000, 9999)}`,
        customsSeal: direction === 'EXPORT' ? `CS-${rng.int(1000, 9999)}` : null,
      }));

      // Cargo invoices + lines
      const invCount = rng.weighted(
        [
          [1, 60],
          [2, 30],
          [3, 10],
        ] as const,
        (x) => x[1],
      )[0];
      const invoiceDate = addDays(etd, -rng.int(3, 9));
      const invoices: Plan['invoices'] = [];
      let totalQty = 0;
      for (let iv = 0; iv < invCount; iv++) {
        const invoiceNo =
          direction === 'EXPORT'
            ? `${client.code}A${YY}${String(++seqExportInv).padStart(3, '0')}`
            : `${rng.pick(['CNG', 'TWS', 'VNT', 'KRS', 'HKG'])}${YY}${String(++seqImportInv).padStart(3, '0')}`;
        const lineCount = rng.int(2, 5);
        const po = String(rng.int(100000, 999999));
        const lines: Plan['invoices'][number]['lines'] = [];
        const desc =
          direction === 'EXPORT'
            ? rng.pick([
                'LADIES PANT KNITTED 100 POLYESTER',
                'MENS T-SHIRT KNITTED 100 COTTON',
                'GIRLS HOODIE KNITTED 60 COTTON 40 POLYESTER',
                'MENS WOVEN SHORTS 100 NYLON',
              ])
            : material === 'Fabric'
              ? rng.pick([
                  'KNIT FABRIC 100 POLYESTER',
                  'COTTON JERSEY ROLLS',
                  'NYLON SPANDEX FABRIC',
                ])
              : material === 'Machinery'
                ? 'SEWING MACHINE PARTS'
                : rng.pick(['ZIPPERS AND BUTTONS', 'ELASTIC BAND', 'WOVEN LABELS', 'POLY BAGS']);
        for (let ln = 1; ln <= lineCount; ln++) {
          const ctns = direction === 'EXPORT' ? rng.int(20, 140) : rng.int(8, 90);
          const pcs =
            direction === 'EXPORT' ? ctns * rng.pick([12, 24, 36, 48, 60]) : ctns * rng.int(1, 6);
          const nw = rng.float(ctns * 7, ctns * 14, 2);
          totalQty += direction === 'EXPORT' ? ctns : pcs;
          lines.push({
            lineNo: ln,
            invoiceId: '00000000-0000-0000-0000-000000000000', // replaced on insert
            poNo: po,
            styleNo: String(rng.int(600000, 699999)),
            htsCode:
              direction === 'EXPORT'
                ? rng.pick(['6104.62', '6109.10', '6110.20', '6105.10', '6203.42', '6204.62'])
                : material === 'Fabric'
                  ? rng.pick(['6006.32', '5208.52', '5407.61'])
                  : material === 'Machinery'
                    ? '8452.90'
                    : rng.pick(['9607.11', '5807.10', '3923.21']),
            pcs: String(pcs),
            ctns: String(ctns),
            cbm: String(rng.float(ctns * 0.06, ctns * 0.11, 3)),
            netWeightKg: String(nw),
            grossWeightKg: String(Number((nw * rng.float(1.04, 1.1, 3)).toFixed(2))),
            fobUnitPrice: String(
              direction === 'EXPORT' ? rng.float(1.2, 9.5, 2) : rng.float(0.15, 3.8, 3),
            ),
            description: desc,
          });
        }
        invoices.push({ invoiceNo, invoiceDate, description: desc, lines });
      }

      const consignee =
        direction === 'IMPORT'
          ? consigneeRows.find((c) => c.clientId === clientByCode(client.code).id)!
          : rng.pick(exportConsignees);
      const destinationIso2 =
        direction === 'EXPORT'
          ? (consignee.countryIso2 ?? rng.weighted(destinations, (d) => d[1])[0])
          : 'KH';
      seqShipment++;
      plans.push({
        clientCode: client.code,
        forwarderCode: fwd.code,
        containers,
        invoices,
        row: {
          reference: `SHP-${YY}-${String(seqShipment).padStart(4, '0')}`,
          clientId: clientByCode(client.code).id,
          direction,
          transportMode,
          loadType,
          status,
          clearanceStatus,
          shipperName:
            direction === 'EXPORT'
              ? CLIENTS.find((c) => c.code === client.code)!.legalName
              : `${rng.pick(['Ningbo', 'Shaoxing', 'Taichung', 'Busan', 'Ho Chi Minh'])} ${rng.pick(['Textile', 'Trims', 'Knitting', 'Industrial'])} Co., Ltd.`,
          consigneeId: consignee.id,
          forwarderId: fwdRows.find((f) => f.code === fwd.code)!.id,
          broker: 'Grateful Solutions (in-house)',
          clearancePortId: clearancePort.id,
          originCountryIso2: direction === 'IMPORT' ? rng.weighted(origins, (o) => o[1])[0] : 'KH',
          destinationCountryIso2: destinationIso2,
          etdPort: direction === 'EXPORT' ? clearancePort.name : null,
          quantity: String(totalQty),
          quantityUnit: unit,
          material,
          bookingNo: direction === 'EXPORT' ? `BKG-${rng.int(80000, 99999)}` : null,
          hblNo: `${fwd.code.slice(0, 3)}${YY}${String(rng.int(100000, 999999))}`,
          vesselName: transportMode === 'SEA' ? rng.pick(VESSELS) : null,
          voyageNo:
            transportMode === 'SEA'
              ? `V.${rng.int(100, 399)}${rng.pick(['E', 'W', 'N', 'S'])}`
              : null,
          crd: direction === 'EXPORT' ? addDays(etd, -rng.int(3, 6)) : null,
          etd,
          atd,
          eta,
          ata,
          arriveFty: direction === 'IMPORT' && ata ? addDays(ata, rng.int(1, 3)) : null,
          thcHblNo:
            transportMode === 'SEA' ? `THC-${YY}${String(seqShipment).padStart(3, '0')}` : null,
          thcHblDate: transportMode === 'SEA' && ata ? ata : null,
          thcHblAmount:
            transportMode === 'SEA'
              ? loadType === 'FCL'
                ? toMoneyString(
                    containers.reduce((sum, c) => sum + (c.size === '20GP' ? 180 : 355), 0),
                  )
                : toMoneyString(rng.int(60, 120))
              : null,
          coForm: direction === 'EXPORT' ? rng.pick(['AB', 'CRF', 'A']) : null,
          coNumber:
            direction === 'EXPORT' ? `CO-${YY}${String(seqShipment).padStart(4, '0')}` : null,
          coStatus: direction === 'EXPORT' ? (status === 'COMPLETED' ? 'Active' : 'Pending') : null,
          remark:
            clearanceStatus === 'EXCEPTION'
              ? rng.pick([
                  'Customs physical inspection',
                  'Document mismatch on invoice value',
                  'Container held for scan',
                  'Late CO form',
                ])
              : null,
          createdById: operatorId,
          updatedById: operatorId,
        },
      });
    }
  }

  const shipmentRows: (typeof s.shipments.$inferSelect)[] = [];
  for (const part of chunk(plans, 100))
    shipmentRows.push(
      ...(await db
        .insert(s.shipments)
        .values(part.map((p) => p.row))
        .returning()),
    );

  const containerValues = plans.flatMap((p, i) =>
    p.containers.map((c, j) => ({ ...c, shipmentId: shipmentRows[i]!.id, sortOrder: j })),
  );
  for (const part of chunk(containerValues, 300)) await db.insert(s.containers).values(part);

  let invoiceCount = 0;
  let lineCount = 0;
  for (const [i, p] of plans.entries()) {
    for (const [j, inv] of p.invoices.entries()) {
      const [invRow] = await db
        .insert(s.cargoInvoices)
        .values({
          shipmentId: shipmentRows[i]!.id,
          invoiceNo: inv.invoiceNo,
          invoiceDate: inv.invoiceDate,
          description: inv.description,
          sortOrder: j,
        })
        .returning({ id: s.cargoInvoices.id });
      await db
        .insert(s.cargoInvoiceLines)
        .values(inv.lines.map((l) => ({ ...l, invoiceId: invRow!.id })));
      invoiceCount++;
      lineCount += inv.lines.length;
    }
  }
  log(
    `${shipmentRows.length} shipments, ${containerValues.length} containers, ${invoiceCount} cargo invoices, ${lineCount} invoice lines`,
  );

  /* ---------- Customs declarations, CDC lines, accounting ledger ---------- */
  let seqImportDecl = 95000;
  let seqExportDecl = 41000;
  let seqTaxInv = 150;
  let seqDis = 180;
  const dnSeq = new Map<string, number>();
  const cutBalance = new Map(
    cutRows.map((r) => [r.id, Number(r.qty) - Number(r.openingImportedQty)]),
  );
  const machineryItems = cutRows.filter(
    (r) => r.category === 'MACHINERY_EQUIPMENT' || r.category === 'ACCESSORY',
  );
  let declCount = 0;
  let ledgerCount = 0;
  let cdcCount = 0;

  for (const [i, p] of plans.entries()) {
    const sh = shipmentRows[i]!;
    if (sh.status === 'PENDING') continue;
    const baseDate =
      sh.direction === 'IMPORT' ? (sh.ata ?? sh.eta!) : addDays(sh.etd!, -rng.int(1, 2));
    if (Date.parse(baseDate) > Date.parse(TODAY)) continue;
    const declCountForShipment = rng.chance(0.08) ? 2 : 1;
    for (let d = 0; d < declCountForShipment; d++) {
      const declareDate = addDays(baseDate, d);
      if (Date.parse(declareDate) > Date.parse(TODAY)) continue;
      const declareNo = sh.direction === 'IMPORT' ? `I ${++seqImportDecl}` : `E ${++seqExportDecl}`;
      const [decl] = await db
        .insert(s.customsDeclarations)
        .values({
          shipmentId: sh.id,
          declareNo,
          declareDate,
          portId: sh.clearancePortId,
          createdById: operatorId,
        })
        .returning();
      declCount++;

      // JR imports of machinery/trims draw down the CDC master list.
      if (
        p.clientCode === 'JR' &&
        sh.direction === 'IMPORT' &&
        (sh.material === 'Machinery' || sh.material === 'Trims & Accessories') &&
        d === 0
      ) {
        const picks = new Set<string>();
        for (let t = 0; t < rng.int(1, 3); t++) {
          const item = rng.pick(machineryItems);
          const bal = cutBalance.get(item.id) ?? 0;
          if (picks.has(item.id) || bal < 1) continue;
          const want = Math.max(
            1,
            Math.min(Math.floor(bal * rng.float(0.05, 0.25, 3)), item.unit === 'SET' ? 5 : 500),
          );
          picks.add(item.id);
          cutBalance.set(item.id, bal - want);
          await db.insert(s.cdcLines).values({
            declarationId: decl!.id,
            cutStockItemId: item.id,
            qty: String(want),
            unitPrice: item.unitPrice,
            netWeightKg: String(rng.float(want * 0.5, want * 40, 2)),
            createdById: operatorId,
          });
          cdcCount++;
        }
      }

      // Ledger row once the invoice date has passed.
      const inv = nextBusinessDay(declareDate);
      if (Date.parse(inv.date) > Date.parse(TODAY)) continue;
      const ctns = p.containers;
      const clearFee =
        sh.loadType === 'FCL'
          ? rng.float(240, 420) * Math.max(1, ctns.length)
          : sh.loadType === 'LCL'
            ? rng.float(120, 300)
            : sh.transportMode === 'AIR'
              ? rng.float(150, 320)
              : rng.float(180, 400);
      const thc =
        sh.loadType === 'FCL'
          ? ctns.reduce((sum, c) => sum + (c.size === '20GP' ? 180 : 355), 0)
          : sh.loadType === 'LCL'
            ? rng.int(60, 120)
            : 0;
      const otherPay = rng.chance(0.1) ? rng.float(10, 60) : 0;
      const client = clientRows.find((c) => c.id === sh.clientId)!;
      const commission = Number(client.commissionUsd);
      const invRevenue =
        sh.direction === 'EXPORT'
          ? 185
          : sh.loadType === 'FCL'
            ? 180 * Math.max(1, ctns.length)
            : sh.transportMode === 'AIR'
              ? rng.pick([150, 185])
              : 150;
      const disTotal = rng.float(18.75, 220);
      // ~5% of jobs lose money (e.g. unrecovered trucking), so loss styling has real data.
      const margin = rng.chance(0.05) ? rng.float(-420, -260) : rng.float(40, 320);
      const dnTotal = Math.round(clearFee + thc + otherPay + margin);
      const totals = computeLedger({
        clearFee,
        thc,
        otherPay,
        commission,
        invRevenue,
        disTotal,
        dnTotal,
      });
      const yymm = inv.date.slice(2, 4) + inv.date.slice(5, 7);
      const dnKey = `${client.code}:${yymm}`;
      dnSeq.set(dnKey, (dnSeq.get(dnKey) ?? 0) + 1);
      const month = Number(inv.date.slice(5, 7));
      await db.insert(s.accountingRecords).values({
        declarationId: decl!.id,
        clientId: client.id,
        portId: sh.clearancePortId,
        invNo: `GS${YY}-${String(++seqTaxInv).padStart(3, '0')}`,
        disNo: `DIS${String(++seqDis).padStart(3, '0')}`,
        dnNo: `${client.code}${yymm}${String(dnSeq.get(dnKey)).padStart(3, '0')}`,
        invDate: inv.date,
        exchangeRate: String(monthlyRate(month)),
        clearFee: toMoneyString(clearFee),
        thc: toMoneyString(thc),
        otherPay: toMoneyString(otherPay),
        commission: toMoneyString(commission),
        invRevenue: toMoneyString(invRevenue),
        disTotal: toMoneyString(disTotal),
        vat: toMoneyString(totals.vat),
        dnTotal: toMoneyString(dnTotal),
        netProfit: toMoneyString(totals.netProfit),
        cheaStatus:
          Date.parse(inv.date) < Date.parse(addDays(TODAY, -20)) || rng.chance(0.3)
            ? 'PAID'
            : 'UNPAID',
        mark: rng.chance(0.08) ? 'Use 40H Truck' : null,
        createdById: accountantId,
        updatedById: accountantId,
      });
      ledgerCount++;
    }
  }

  // Continue numbering after the seeded documents.
  await db
    .insert(s.numberSequences)
    .values([
      { key: `SHIPMENT:${YEAR}`, nextValue: seqShipment + 1 },
      { key: `TAX_INVOICE:${YEAR}`, nextValue: seqTaxInv + 1 },
      { key: 'DISBURSEMENT', nextValue: seqDis + 1 },
      { key: 'DECLARATION:IMPORT', nextValue: seqImportDecl + 1 },
      { key: 'DECLARATION:EXPORT', nextValue: seqExportDecl + 1 },
      ...[...dnSeq.entries()].map(([k, v]) => ({ key: `DEBIT_NOTE:${k}`, nextValue: v + 1 })),
    ]);
  log(`${declCount} customs declarations, ${cdcCount} CDC lines, ${ledgerCount} ledger rows`);

  /* ---------- Follow-ups ---------- */
  const recent = shipmentRows.filter(
    (sh) =>
      sh.status !== 'COMPLETED' &&
      Math.abs(Date.parse(sh.eta!) - Date.parse(TODAY)) < 30 * 86_400_000,
  );
  const subjects = [
    ['Customs Duty Verification', 'HIGH', 'AWAITING_REPLY', 0],
    ['Export Permit Amendment', 'MEDIUM', 'IN_REVIEW', -4],
    ['CO Form D correction request', 'HIGH', 'OPEN', 1],
    ['THC receipt missing from forwarder', 'MEDIUM', 'AWAITING_REPLY', -2],
    ['Confirm ATA with forwarder', 'LOW', 'OPEN', 3],
    ['Debit note amount confirmation', 'MEDIUM', 'OPEN', 5],
    ['Cut-stock balance check before next declaration', 'HIGH', 'IN_REVIEW', 2],
    ['Container demurrage risk', 'HIGH', 'OPEN', -1],
    ['Update packing list for invoice', 'LOW', 'DONE', -9],
    ['Collect signed vendor agreement', 'LOW', 'DONE', -15],
  ] as const;
  await db.insert(s.followUps).values(
    subjects.map(([subject, priority, status, dueOffset], i) => {
      const sh = recent[i % Math.max(1, recent.length)] ?? shipmentRows[i]!;
      return {
        reference: `FLW-${String(91 + i).padStart(4, '0')}`,
        subject,
        priority,
        status,
        clientId: sh.clientId,
        shipmentId: sh.id,
        assigneeId: i % 3 === 0 ? managerId : i % 3 === 1 ? operatorId : accountantId,
        dueAt: new Date(`${addDays(TODAY, dueOffset)}T10:00:00Z`), // 17:00 in Phnom Penh
        completedAt: status === 'DONE' ? new Date(`${addDays(TODAY, dueOffset)}T09:00:00Z`) : null,
        createdById: managerId,
      };
    }),
  );
  await db.insert(s.numberSequences).values({ key: 'FOLLOW_UP', nextValue: 91 + subjects.length });
  log(`${subjects.length} follow-ups`);

  // Shipment statuses follow from the dates and declarations, as they do when saved in the app.
  await recomputeShipmentStatuses(db);

  /* ---------- Job workflow: stages, permits, vendor invoices, standing papers ---------- */
  await seedWorkflow({
    today: TODAY,
    jrId: clientByCode('JR').id,
    operatorId,
    managerId,
    accountantId,
    opsManagerId: userRows[6]!.id,
    brokerId: userRows[7]!.id,
  });
  log('workflow stages, customs permits, vendor invoices, broker and client papers');

  /* ---------- Summary ---------- */
  const summary = await db.execute<{ month: string; imports: string; exports: string }>(sql`
    SELECT to_char(date_trunc('month', eta), 'Mon') AS month,
           count(*) FILTER (WHERE direction = 'IMPORT') AS imports,
           count(*) FILTER (WHERE direction = 'EXPORT') AS exports
    FROM shipments WHERE deleted_at IS NULL GROUP BY date_trunc('month', eta) ORDER BY date_trunc('month', eta)`);
  log(
    `Monthly volume: ${summary.rows.map((r) => `${r.month} ${Number(r.imports) + Number(r.exports)}`).join(', ')}`,
  );
  console.log(
    `\n✔ Seed complete. Sign in with any of:\n${people.map((p) => `    ${p.email.padEnd(26)} ${p.role}`).join('\n')}\n  Password: the SEED_DEFAULT_PASSWORD value from .env\n`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
