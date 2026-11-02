import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';
import { crossChecks, type Facts } from './service';

const app = createApp();
let b: Awaited<ReturnType<typeof seedBasics>>;
const H: Record<string, { Authorization: string }> = {};
const api = (m: 'get' | 'post' | 'put' | 'delete', path: string) =>
  request(app)[m](`/api/v1${path}`);

async function login(email: string) {
  const res = await api('post', '/auth/login').send({ email, password: TEST_PASSWORD });
  return { Authorization: `Bearer ${res.body.accessToken as string}` };
}

async function importShipment() {
  const res = await api('post', '/shipments')
    .set(H.ADMIN!)
    .send({
      clientId: b.jr.id,
      direction: 'IMPORT',
      transportMode: 'SEA',
      loadType: 'FCL',
      forwarderId: b.fwd.id,
      clearancePortId: b.port.id,
      originCountryIso2: 'CN',
      destinationCountryIso2: 'KH',
      hblNo: 'SHSIN6090083',
      eta: '2026-09-17',
      invoices: [
        {
          invoiceNo: 'CNQ26046',
          invoiceDate: '2026-09-10',
          lines: [
            {
              description: 'KNITTED FABRIC',
              pcs: '797',
              ctns: '797',
              cbm: '68',
              grossWeightKg: '24300',
              netWeightKg: '23993.3',
              fobUnitPrice: '1',
            },
          ],
        },
      ],
      declarations: [],
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string };
}

beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
  for (const role of [
    'ADMIN',
    'OPERATOR',
    'OPERATION_MANAGER',
    'CUSTOMS_BROKER',
    'ACCOUNTANT',
    'CEO',
    'VIEWER',
  ] as const) {
    const u = await createUser(role);
    H[role] = await login(u.email);
  }
});
afterAll(async () => {
  await pool.end();
});

describe('job workflow', () => {
  it('starts at the first stage and lists what is missing', async () => {
    const s = await importShipment();
    const res = await api('get', `/workflow/shipments/${s.id}`).set(H.OPERATOR!);
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('PRE_ALERT');
    const unmet = res.body.requirements
      .filter((r: { met: boolean }) => !r.met)
      .map((r: { key: string }) => r.key);
    expect(unmet).toEqual(['DOC:COMMERCIAL_INVOICE', 'DOC:PACKING_LIST', 'DOC:BILL_OF_LADING']);
    expect(res.body.can.advance).toBe(false);
    expect(res.body.can.override).toBe(false);
  });

  it('needs a reason and workflow:approve to move on with requirements unmet', async () => {
    const s = await importShipment();
    const op = await api('post', `/workflow/shipments/${s.id}/advance`)
      .set(H.OPERATOR!)
      .send({ from: 'PRE_ALERT' });
    expect(op.status).toBe(403);
    const noReason = await api('post', `/workflow/shipments/${s.id}/advance`)
      .set(H.OPERATION_MANAGER!)
      .send({ from: 'PRE_ALERT' });
    expect(noReason.status).toBe(422);
    const ok = await api('post', `/workflow/shipments/${s.id}/advance`)
      .set(H.OPERATION_MANAGER!)
      .send({ from: 'PRE_ALERT', overrideReason: 'Scans arrive with the vessel' });
    expect(ok.status).toBe(200);
    expect(ok.body.stage).toBe('DOC_CHECK');
    expect(ok.body.history[0]).toMatchObject({
      action: 'OVERRIDE',
      overrideReason: 'Scans arrive with the vessel',
    });
  });

  it('only the Operation Manager approves the review stage, and a stale screen is refused', async () => {
    const s = await importShipment();
    await db.execute(sql`UPDATE shipments SET workflow_stage = 'REVIEW' WHERE id = ${s.id}`);
    const op = await api('post', `/workflow/shipments/${s.id}/advance`)
      .set(H.OPERATOR!)
      .send({ from: 'REVIEW' });
    expect(op.status).toBe(403);
    const stale = await api('post', `/workflow/shipments/${s.id}/advance`)
      .set(H.OPERATION_MANAGER!)
      .send({ from: 'PRE_ALERT' });
    expect(stale.status).toBe(409);
    const ok = await api('post', `/workflow/shipments/${s.id}/advance`)
      .set(H.OPERATION_MANAGER!)
      .send({ from: 'REVIEW', note: 'Package checked' });
    expect(ok.status).toBe(200);
    expect(ok.body.stage).toBe('CUSTOMER_SIGNING');
    expect(ok.body.history[0].action).toBe('APPROVE');
  });

  it('the broker records a permit; an expired one blocks the permit stage', async () => {
    const s = await importShipment();
    await db.execute(sql`UPDATE shipments SET workflow_stage = 'PERMIT' WHERE id = ${s.id}`);
    const op = await api('post', `/workflow/shipments/${s.id}/permits`)
      .set(H.OPERATOR!)
      .send({ permitNo: 'PRT1', validUntil: '2099-01-01' });
    expect(op.status).toBe(403);
    const old = await api('post', `/workflow/shipments/${s.id}/permits`)
      .set(H.CUSTOMS_BROKER!)
      .send({ permitNo: 'PRT20200101GDCE1', issueDate: '2020-01-01', validUntil: '2020-02-01' });
    expect(old.status).toBe(201);
    const permitReq = old.body.requirements.find((r: { key: string }) => r.key === 'VALID_PERMIT');
    expect(permitReq.met).toBe(false);
    expect(old.body.issues.map((i: { code: string }) => i.code)).toContain('PERMIT_EXPIRED');
    const good = await api('post', `/workflow/shipments/${s.id}/permits`)
      .set(H.CUSTOMS_BROKER!)
      .send({ permitNo: 'PRT20990101GDCE2', issueDate: '2099-01-01', validUntil: '2099-02-01' });
    expect(good.body.requirements.find((r: { key: string }) => r.key === 'VALID_PERMIT').met).toBe(
      true,
    );
  });

  it('local charges need paid vendor invoices, entered by the accountant', async () => {
    const s = await importShipment();
    await db.execute(sql`UPDATE shipments SET workflow_stage = 'LOCAL_CHARGES' WHERE id = ${s.id}`);
    const add = await api('post', `/workflow/shipments/${s.id}/vendor-invoices`)
      .set(H.ACCOUNTANT!)
      .send({ vendorName: 'FWF', invoiceNo: 'IMP202609226', amount: '510', vat: '0' });
    expect(add.status).toBe(201);
    expect(add.body.can.advance).toBe(false);
    const id = add.body.vendorInvoices.rows[0].id as string;
    const paid = await api('put', `/workflow/shipments/${s.id}/vendor-invoices/${id}`)
      .set(H.ACCOUNTANT!)
      .send({
        vendorName: 'FWF',
        invoiceNo: 'IMP202609226',
        amount: '510',
        vat: '0',
        paidOn: '2026-09-16',
      });
    expect(paid.body.can.advance).toBe(true);
    // Operations sees the count, not the amounts.
    const op = await api('get', `/workflow/shipments/${s.id}`).set(H.OPERATOR!);
    expect(op.body.vendorInvoices).toMatchObject({ count: 1, unpaid: 0, rows: null, total: '' });
  });

  it('sends back with a note and keeps it in the history', async () => {
    const s = await importShipment();
    await db.execute(sql`UPDATE shipments SET workflow_stage = 'REVIEW' WHERE id = ${s.id}`);
    const res = await api('post', `/workflow/shipments/${s.id}/return`)
      .set(H.OPERATION_MANAGER!)
      .send({ from: 'REVIEW', to: 'DOC_CHECK', note: 'Invoice 797 rolls, PL 795' });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('DOC_CHECK');
    expect(res.body.history[0]).toMatchObject({
      action: 'RETURN',
      note: 'Invoice 797 rolls, PL 795',
    });
    const viewer = await api('post', `/workflow/shipments/${s.id}/return`)
      .set(H.VIEWER!)
      .send({ from: 'DOC_CHECK', to: 'PRE_ALERT', note: 'nope' });
    expect(viewer.status).toBe(403);
  });

  it("puts jobs in each role's queue", async () => {
    const s = await importShipment();
    await db.execute(sql`UPDATE shipments SET workflow_stage = 'PERMIT' WHERE id = ${s.id}`);
    const broker = await api('get', '/workflow/queue').set(H.CUSTOMS_BROKER!);
    expect(broker.body.items.map((i: { shipmentId: string }) => i.shipmentId)).toEqual([s.id]);
    const op = await api('get', '/workflow/queue').set(H.OPERATOR!);
    expect(op.body.items).toEqual([]);
    const all = await api('get', '/workflow/queue?scope=all').set(H.OPERATOR!);
    expect(all.body.counts).toEqual({ BROKER: 1 });
  });

  it('refuses the same file twice on one shipment unless confirmed', async () => {
    const s = await importShipment();
    const send = (extra: Record<string, string> = {}) => {
      let r = api('post', '/documents')
        .set(H.OPERATOR!)
        .field('title', 'HBL')
        .field('category', 'BILL_OF_LADING')
        .field('shipmentId', s.id);
      for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
      return r.attach('file', Buffer.from('%PDF-1.4 same scan'), 'hbl.pdf');
    };
    expect((await send()).status).toBe(201);
    const dup = await send();
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toMatchObject({ duplicate: true, title: 'HBL' });
    expect((await send({ allowDuplicate: 'true' })).status).toBe(201);
    const wf = await api('get', `/workflow/shipments/${s.id}`).set(H.OPERATOR!);
    expect(wf.body.issues.map((i: { code: string }) => i.code)).toContain('DUPLICATE_DOCUMENT');
  });
});

describe('cross-checks', () => {
  const base: Facts = {
    id: 'x',
    reference: 'SHP-1',
    clientId: 'c',
    clientName: 'JR',
    direction: 'EXPORT',
    stage: 'CO',
    stageChangedAt: null,
    hblNo: null,
    bookingNo: 'PHN2600920',
    eta: null,
    etd: '2026-09-15',
    atd: '2026-09-13',
    doDate: null,
    arriveFty: null,
    coForm: 'AB',
    coNumber: null,
    coStatus: null,
    bookedQty: '6200',
    bookedGrossWeightKg: '3342',
    bookedCbm: '15.17',
    measuredCbm: '15.99',
    measuredGrossWeightKg: '3561',
    cdcNo: null,
    cdcValidUntil: null,
    lines: 2,
    invoices: 1,
    pcs: 6224,
    cbm: 15.17,
    grossWeightKg: 3577.5,
    docs: new Map(),
    duplicateDocs: [],
    permits: [],
    vendorInvoices: [],
    declared: 1,
    firstDeclareDate: '2026-09-10',
    ledger: { count: 0, revenue: 0, cost: 0, netProfit: 0 },
    coInvoices: 1,
    coApproved: 0,
    brokerCardExpiry: null,
  };

  it('flags the JR Apparel export mismatches', () => {
    const codes = crossChecks(base, '2026-09-16').map((i) => i.code);
    expect(codes).toEqual(['QTY_VS_BOOKING', 'GW_VS_BOOKING', 'CBM_MEASURED', 'SHIP_DATE']);
  });

  it('flags a CDC master list that ends before the cargo arrives', () => {
    const issues = crossChecks(
      {
        ...base,
        direction: 'IMPORT',
        cdcNo: 'QIP1',
        cdcValidUntil: '2026-09-01',
        eta: '2026-09-17',
      },
      '2026-08-20',
    );
    expect(issues.find((i) => i.code === 'CDC_EXPIRED')?.severity).toBe('ERROR');
  });
});
