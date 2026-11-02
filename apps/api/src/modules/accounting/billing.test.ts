import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { exchangeRates } from '../../db/schema';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

/*
 * Client Billing, checked against the September JR pack (09-JR-INV): shipment GS26-360 is
 * a $242 export processing fee (+10% VAT = $266.20) and disbursement DIS403 $637.25, so its
 * line on the account statement is $903.45.
 */

const app = createApp();
let b: Awaited<ReturnType<typeof seedBasics>>;
let tokens: Partial<Record<RoleCode, string>> = {};
async function as(role: RoleCode) {
  if (!tokens[role]) {
    await createUser(role);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `${role.toLowerCase()}@test.local`, password: TEST_PASSWORD });
    tokens[role] = res.body.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[role]}` };
}

/** An accounting API call (as the accountant unless another role is given). */
async function acc(
  m: 'get' | 'post' | 'put' | 'patch',
  path: string,
  o: { body?: object; query?: Record<string, string>; role?: RoleCode } = {},
) {
  const req = request(app)
    [m](`/api/v1/accounting${path}`)
    .set(await as(o.role ?? 'ACCOUNTANT'));
  if (o.query) void req.query(o.query);
  return o.body ? req.send(o.body) : req;
}

/** A shipment with one declaration and its Monthly Ledger row; returns the ledger row id. */
async function shipment(
  clientId: string,
  declareNo: string,
  declareDate: string,
  o: {
    direction?: 'IMPORT' | 'EXPORT';
    size?: '20GP' | '40HQ' | '45HQ';
    hbl?: string;
    ledger?: Record<string, string>;
  } = {},
) {
  const direction = o.direction ?? 'EXPORT';
  const digits = declareNo.replace(/\D/g, '');
  const ship = await request(app)
    .post('/api/v1/shipments')
    .set(await as('ADMIN'))
    .send({
      clientId,
      direction,
      transportMode: 'SEA',
      loadType: 'FCL',
      clearancePortId: b.port.id,
      originCountryIso2: direction === 'EXPORT' ? 'KH' : 'CN',
      destinationCountryIso2: direction === 'EXPORT' ? 'US' : 'KH',
      hblNo: o.hbl ?? 'NON',
      eta: declareDate,
      containers: [{ containerNo: `CXDU${digits.padStart(7, '0')}`, size: o.size ?? '45HQ' }],
      invoices: [
        {
          invoiceNo: `JRA-${digits}`,
          lines: [
            { pcs: 1000, ctns: '1150', cbm: '60', grossWeightKg: '16864.8', fobUnitPrice: 2 },
          ],
        },
      ],
      declarations: [{ declareNo, declareDate, portId: b.port.id }],
    });
  if (ship.status !== 201) throw new Error(JSON.stringify(ship.body));
  const rec = await acc('post', '/ledger', {
    body: { declarationId: ship.body.declarations[0].id, ...o.ledger },
  });
  if (rec.status !== 201) throw new Error(JSON.stringify(rec.body));
  // Unless its numbers were typed (the Excel history), accounting approves its Chea payment,
  // which gives it its INV / DIS / DN numbers.
  if (!o.ledger?.invNo) {
    const declarationId = ship.body.declarations[0].id as string;
    const pre = (await acc('get', '/docs/credit-notes/prefill', { query: { declarationId } })).body;
    const cn = await acc('post', '/docs/credit-notes', {
      body: { ...pre, lines: [{ ...pre.lines[0], unitPrice: '100' }] },
    });
    await acc('post', `/docs/credit-notes/${cn.body.id}/issue`);
    const ok = await acc('patch', `/docs/credit-notes/${cn.body.id}/review`, {
      body: { reviewStatus: 'CHECKED' },
    });
    if (ok.status !== 200) throw new Error(JSON.stringify(ok.body));
  }
  return rec.body.id as string;
}

const line = (description: string, unitPrice: string, unit = '45H', qty = '1') => ({
  description,
  qty,
  unit,
  unitPrice,
  mark: '',
});
/** Sheet 360 (tax invoice + disbursement) and D001 (debit note) of the workbook. */
const EXPORT_LINES = {
  'tax-invoices': [line('កំរៃសេវាបំពេញបែបបទនាំចេញ / EXPORT PROCESSING FEE', '242')],
  disbursements: [
    line('LOLO AT PORT', '77'),
    line('CUSTOM PROCESSING FEE', '21.25'),
    line('HBL FEE', '539'),
  ],
  'debit-notes': [
    line('TRUCKING FEE', '260'),
    line('HANDLING FEE', '35'),
    line('INCREASE TRUCKING FEE(65%)', '169', 'TRUCK'),
    line('DOCUMENT FEE', '25', 'SET'),
    line('SERVICE TAXATION', '20', 'SHIP'),
    line('PETROLL ALLOWANCE FEE', '69', 'TIME'),
    line('FUEL SURCHARGE', '40'),
    line('APPLY CO FOR INV: JRA26051', '40', 'INV'),
    line('LOLO EMPTY CONTAINER', '49.5'),
  ],
};

/** Creates a document from the ledger row with the given lines and issues it. */
async function issued(type: keyof typeof EXPORT_LINES, recordId: string) {
  const pre = (await acc('get', `/docs/${type}/prefill`, { query: { recordId } })).body;
  const doc = (await acc('post', `/docs/${type}`, { body: { ...pre, lines: EXPORT_LINES[type] } }))
    .body;
  expect((await acc('post', `/docs/${type}/${doc.id}/issue`)).status).toBe(200);
  return doc as { id: string; number: string };
}

const month = (clientId: string, m = '2026-09', role: RoleCode = 'ACCOUNTANT') =>
  acc('get', `/billing/${clientId}`, { query: { month: m }, role });

beforeEach(async () => {
  await resetDb();
  tokens = {};
  b = await seedBasics();
  await db.insert(exchangeRates).values({ effectiveDate: '2026-08-01', usdToKhr: '4047' });
});
afterAll(async () => {
  await pool.end();
});

describe('client billing: a client month', () => {
  it('reads numbers typed in the ledger as documents made outside the system', async () => {
    // 2 Sep (Wed) → invoice date 3 Sep, as GS26-360 in the workbook.
    await shipment(b.jr.id, 'E 264562', '2026-09-02', {
      hbl: 'COSU6464276980',
      ledger: {
        invNo: 'GS26-360',
        disNo: 'DIS403',
        dnNo: 'JR2609001',
        invRevenue: '242',
        disTotal: '637.25',
        dnTotal: '707.5',
      },
    });
    await shipment(b.jr.id, 'E 272714', '2026-09-09');
    await shipment(b.jyx.id, 'I 5', '2026-09-09', { direction: 'IMPORT' });

    const res = await month(b.jr.id);
    expect(res.status).toBe(200);
    const m = res.body;
    expect(m.client).toMatchObject({ code: 'JR' });
    expect(m.rows.map((r: { declareNo: string }) => r.declareNo)).toEqual(['E 264562', 'E 272714']);
    expect(m.rows[0].manual).toEqual({
      'tax-invoices': { number: 'GS26-360', total: '266.20' },
      disbursements: { number: 'DIS403', total: '637.25' },
      'debit-notes': { number: 'JR2609001', total: '707.50' },
    });
    expect(m.statements.INVOICE.lines).toEqual([
      {
        date: '2026-09-03',
        invNo: 'GS26-360',
        disNo: 'DIS403',
        dnNo: null,
        ref: 'COSU6464276980',
        amount: '903.45',
        manual: true,
        draft: false,
      },
    ]);
    expect(m.statements.DEBIT_NOTE).toMatchObject({ total: '707.50', balance: '707.50' });
    // The second shipment has nothing yet: the month is not invoiced.
    expect(m.summary).toMatchObject({
      shipments: 2,
      issued: 0,
      drafts: 0,
      manual: 3,
      missing: { 'tax-invoices': 1, disbursements: 1, 'debit-notes': 1 },
      billed: '1610.95',
      received: '0.00',
      stage: 'NOT_INVOICED',
    });

    // The month pack prints those three from the ledger (numbers, date, amounts), as the
    // statements count them; the shipment with nothing yet has no sheets.
    const pack = (await acc('get', `/billing/${b.jr.id}/pack`, { query: { month: '2026-09' } }))
      .body;
    expect(
      pack.docs.map((d: { type: string; number: string; date: string }) => [
        d.type,
        d.number,
        d.date,
      ]),
    ).toEqual([
      ['tax-invoices', 'GS26-360', '2026-09-03'],
      ['disbursements', 'DIS403', '2026-09-03'],
      ['debit-notes', 'JR2609001', '2026-09-03'],
    ]);
    expect(pack.docs.map((d: { totals: { total: string } }) => d.totals.total)).toEqual([
      '266.20',
      '637.25',
      '707.50',
    ]);
    expect(pack.docs[0].header).toMatchObject({ invoiceNo: 'GS26-360', hbl: 'COSU6464276980' });

    const all = (await acc('get', '/billing', { query: { month: '2026-09' } })).body;
    expect(all.rows.map((r: { clientCode: string }) => r.clientCode)).toEqual(['JR', 'JYX']);
    expect(all.totals).toMatchObject({ clients: 2, shipments: 3, notInvoiced: 2 });
    expect((await acc('get', '/billing', { query: { month: '2026-10' } })).body.rows).toEqual([]);
  });

  it('drafts copy the last issued document of the same direction; issuing fills the statements', async () => {
    // August: one export shipment billed in full, as sheet 360 / D001.
    const aug = await shipment(b.jr.id, 'E 250001', '2026-08-12', { hbl: 'COSU6464000001' });
    const inv = await issued('tax-invoices', aug);
    const dis = await issued('disbursements', aug);
    const dn = await issued('debit-notes', aug);
    expect([inv.number, dis.number, dn.number]).toEqual(['GS26-001', 'DIS001', 'JR2608001']);

    // September: an export (copies August) and an import (nothing to copy: ledger amount).
    const exp = await shipment(b.jr.id, 'E 266001', '2026-09-09', { hbl: 'COSU6464270110' });
    const imp = await shipment(b.jr.id, 'I 136252', '2026-09-16', {
      direction: 'IMPORT',
      size: '40HQ',
      ledger: { invRevenue: '200' },
    });
    const created = await acc('post', `/billing/${b.jr.id}/drafts`, {
      body: {
        month: '2026-09',
        types: ['tax-invoices', 'disbursements', 'debit-notes'],
        lines: 'previous',
      },
    });
    expect(created.status).toBe(201);
    expect(
      created.body.created.map((c: { number: string; copiedFrom: string | null }) => [
        c.number,
        c.copiedFrom,
      ]),
    ).toEqual([
      ['GS26-002', 'GS26-001'],
      ['DIS002', 'DIS001'],
      ['JR2609001', 'JR2608001'],
      ['GS26-003', null],
      ['DIS003', null],
      ['JR2609002', null],
    ]);

    let m = (await month(b.jr.id)).body;
    const cell = (recordId: string, t: string) =>
      m.rows.find((r: { recordId: string }) => r.recordId === recordId).docs[t][0];
    expect(cell(exp, 'tax-invoices')).toMatchObject({ status: 'DRAFT', total: '266.20' });
    expect(cell(exp, 'disbursements').total).toBe('637.25');
    expect(cell(exp, 'debit-notes').total).toBe('707.50');
    expect(cell(imp, 'tax-invoices').total).toBe('220.00'); // the ledger's $200 + VAT
    expect(m.summary).toMatchObject({ drafts: 6, stage: 'DRAFTS' });
    // Drafts are on the statements already, marked DRAFT, so the month can be checked.
    expect(m.statements.INVOICE.lines.map((l: { draft: boolean }) => l.draft)).toEqual([
      true,
      true,
    ]);
    expect(m.statements.INVOICE.drafts).toBe(2);
    // One row's Print: that shipment's three documents, drafts included.
    const rowPack = (
      await acc('get', `/billing/${b.jr.id}/pack`, {
        query: { month: '2026-09', recordId: exp },
      })
    ).body;
    expect(rowPack.docs.map((d: { type: string; status: string }) => [d.type, d.status])).toEqual([
      ['tax-invoices', 'DRAFT'],
      ['disbursements', 'DRAFT'],
      ['debit-notes', 'DRAFT'],
    ]);

    // Nothing is created twice.
    const again = await acc('post', `/billing/${b.jr.id}/drafts`, {
      body: { month: '2026-09', types: ['tax-invoices'] },
    });
    expect(again.body.created).toEqual([]);

    // Issue all: the import's disbursement and debit note are still $0.00 and stay drafts.
    const res = await acc('post', `/billing/${b.jr.id}/issue`, { body: { month: '2026-09' } });
    expect(res.body.issued.map((d: { number: string }) => d.number)).toEqual([
      'GS26-002',
      'DIS002',
      'JR2609001',
      'GS26-003',
    ]);
    expect(res.body.skipped).toEqual([
      expect.objectContaining({ number: 'DIS003', reason: 'The total is $0.00' }),
      expect.objectContaining({ number: 'JR2609002', reason: 'The total is $0.00' }),
    ]);

    m = (await month(b.jr.id)).body;
    expect(m.statements.INVOICE).toMatchObject({ total: '1123.45', balance: '1123.45' });
    expect(m.statements.INVOICE.lines).toEqual([
      expect.objectContaining({ invNo: 'GS26-002', disNo: 'DIS002', amount: '903.45' }),
      expect.objectContaining({ invNo: 'GS26-003', disNo: null, amount: '220.00' }),
    ]);
    expect(m.statements.DEBIT_NOTE.lines).toEqual([
      expect.objectContaining({ dnNo: 'JR2609001', ref: 'COSU6464270110', amount: '707.50' }),
    ]);
    expect(m.summary).toMatchObject({ issued: 4, drafts: 2, stage: 'DRAFTS' });
    // Issuing wrote the documents into the Monthly Ledger.
    expect((await acc('get', `/ledger/${exp}`)).body).toMatchObject({
      invNo: 'GS26-002',
      disNo: 'DIS002',
      dnNo: 'JR2609001',
    });

    // The pack has every document in full, drafts included, each shipment's three together.
    const pack = (await acc('get', `/billing/${b.jr.id}/pack`, { query: { month: '2026-09' } }))
      .body;
    expect(
      pack.docs.map((d: { number: string; status: string }) => `${d.number} ${d.status}`),
    ).toEqual([
      'GS26-002 ISSUED',
      'DIS002 ISSUED',
      'JR2609001 ISSUED',
      'GS26-003 ISSUED',
      'DIS003 DRAFT',
      'JR2609002 DRAFT',
    ]);
    expect(pack.docs[2].lines).toHaveLength(9);
  });

  it('automatic numbers continue after numbers typed in the ledger', async () => {
    await shipment(b.jr.id, 'E 264562', '2026-09-02', {
      ledger: { invNo: 'GS26-360', disNo: 'DIS403', dnNo: 'JR2609001' },
    });
    await shipment(b.jr.id, 'E 266002', '2026-09-09');
    const created = await acc('post', `/billing/${b.jr.id}/drafts`, {
      body: { month: '2026-09', types: ['tax-invoices', 'disbursements', 'debit-notes'] },
    });
    expect(created.body.created.map((c: { number: string }) => c.number)).toEqual([
      'GS26-361',
      'DIS404',
      'JR2609002',
    ]);
  });

  it('a monthly-fee debit note starts from the client and bills under its own reference', async () => {
    await shipment(b.jr.id, 'E 266003', '2026-09-09');
    const pre = (
      await acc('get', '/docs/debit-notes/prefill', {
        query: { clientId: b.jr.id, date: '2026-09-30' },
      })
    ).body;
    expect(pre).toMatchObject({ clientId: b.jr.id, dnDate: '2026-09-30', lines: [] });
    expect(pre.billTo).toBe('JR APPAREL CORP');
    const dn = (
      await acc('post', '/docs/debit-notes', {
        body: {
          ...pre,
          reference: 'MIH CHARGE AND PAYROLL FEE',
          lines: [
            line('MIH FEE FOR SEP', '30', 'MONTH'),
            line('PAYROLL FEE FROM AUG TO SEP', '25', 'MONTH', '2'),
          ],
        },
      })
    ).body;
    // After the shipment's JR2609001, as D011 (JR2609011) followed the shipments in the pack.
    await acc('post', `/docs/debit-notes/${dn.id}/issue`);
    const m = (await month(b.jr.id)).body;
    expect(m.others).toEqual([
      expect.objectContaining({
        number: 'JR2609002',
        type: 'debit-notes',
        reference: 'MIH CHARGE AND PAYROLL FEE',
        total: '80.00',
      }),
    ]);
    expect(m.statements.DEBIT_NOTE.lines).toEqual([
      expect.objectContaining({
        dnNo: 'JR2609002',
        ref: 'MIH CHARGE AND PAYROLL FEE',
        amount: '80.00',
      }),
    ]);
  });
});

describe('official receipts', () => {
  it('records payments up to the balance, numbers them, and voids them', async () => {
    await shipment(b.jr.id, 'E 264562', '2026-09-02', {
      ledger: { invNo: 'GS26-360', disNo: 'DIS403', invRevenue: '242', disTotal: '637.25' },
    });
    const pay = (body: Record<string, unknown>) =>
      acc('post', '/receipts', {
        body: {
          clientId: b.jr.id,
          month: '2026-09',
          kind: 'INVOICE',
          receiptDate: '2026-10-03',
          paymentMethod: 'BANK_TRANSFER',
          ...body,
        },
      });

    const first = await pay({ amount: '500', paymentRef: 'TT 88213' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      receiptNo: 'OR26-001',
      receivedFrom: 'JR APPAREL CORP',
      month: '2026-09',
      kind: 'INVOICE',
      amount: '500.00',
      status: 'ISSUED',
      paymentRef: 'TT 88213',
      createdByName: 'Test ACCOUNTANT',
    });
    let m = (await month(b.jr.id)).body;
    expect(m.statements.INVOICE).toMatchObject({ received: '500.00', balance: '403.45' });
    expect(m.summary.stage).toBe('PARTLY_PAID');

    const over = await pay({ amount: '403.46' });
    expect(over.status).toBe(422);
    expect(over.body.error.message).toContain('$403.45 still due');
    expect((await pay({ amount: '403.45', paymentMethod: 'CHEQUE' })).body.receiptNo).toBe(
      'OR26-002',
    );
    m = (await month(b.jr.id)).body;
    expect(m.summary).toMatchObject({ balance: '0.00', stage: 'PAID' });
    expect((await pay({ amount: '1' })).body.error.message).toContain('already paid in full');
    // No debit note this month: nothing to pay on that statement.
    expect((await pay({ amount: '1', kind: 'DEBIT_NOTE' })).status).toBe(422);

    // Void: the receipt stays (number kept) and its amount is due again.
    const voidIt = (reason: string) =>
      acc('post', `/receipts/${first.body.id}/void`, { body: { reason } });
    expect((await voidIt('x')).status).toBe(400);
    expect((await voidIt('Bounced transfer')).body.status).toBe('VOID');
    expect((await voidIt('again')).status).toBe(409);
    m = (await month(b.jr.id)).body;
    expect(m.statements.INVOICE).toMatchObject({ received: '403.45', balance: '500.00' });
    expect(m.statements.INVOICE.receipts).toHaveLength(2);
    expect(m.summary.stage).toBe('PARTLY_PAID');

    const list = (await acc('get', '/receipts', { query: { month: '2026-10' } })).body;
    expect(list.meta.total).toBe(2);
    expect(list.data.map((r: { receiptNo: string }) => r.receiptNo)).toEqual([
      'OR26-002',
      'OR26-001',
    ]);
    expect(
      (await acc('get', '/receipts', { query: { status: 'VOID', q: 'or26' } })).body.data,
    ).toHaveLength(1);
    expect((await acc('get', `/receipts/${first.body.id}`)).body.status).toBe('VOID');
  });

  it('validates amounts and dates', async () => {
    const res = await acc('post', '/receipts', {
      body: {
        clientId: b.jr.id,
        month: '2026-9',
        kind: 'INVOICE',
        receiptDate: '',
        amount: '0',
        paymentMethod: 'BITCOIN',
      },
    });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { path: string }) => d.path);
    expect(fields).toEqual(
      expect.arrayContaining(['month', 'receiptDate', 'amount', 'paymentMethod']),
    );
  });
});

describe('client billing access', () => {
  const receipt = (clientId: string) => ({
    clientId,
    month: '2026-09',
    kind: 'INVOICE',
    receiptDate: '2026-10-03',
    amount: '1',
    paymentMethod: 'CASH',
  });

  it('viewers read, operators see nothing, writes need accounting:write', async () => {
    await shipment(b.jr.id, 'E 264562', '2026-09-02', {
      ledger: { invNo: 'GS26-360', invRevenue: '242' },
    });
    expect((await month(b.jr.id, '2026-09', 'VIEWER')).status).toBe(200);
    expect((await month(b.jr.id, '2026-09', 'OPERATOR')).status).toBe(403);
    const drafts = await acc('post', `/billing/${b.jr.id}/drafts`, {
      body: { month: '2026-09', types: ['tax-invoices'] },
      role: 'VIEWER',
    });
    expect(drafts.status).toBe(403);
    expect(
      (await acc('post', '/receipts', { body: receipt(b.jr.id), role: 'VIEWER' })).status,
    ).toBe(403);
    expect((await month('not-a-uuid')).status).toBe(400);
    expect((await month(b.jr.id, '09-2026')).status).toBe(400);
  });

  it('a user limited to some clients only sees and pays those clients', async () => {
    await shipment(b.jr.id, 'E 264562', '2026-09-02', {
      ledger: { invNo: 'GS26-360', invRevenue: '242' },
    });
    await shipment(b.jyx.id, 'I 5', '2026-09-09', {
      direction: 'IMPORT',
      ledger: { invNo: 'GS26-361', invRevenue: '150' },
    });
    const staff = await request(app)
      .post('/api/v1/staff')
      .set(await as('ADMIN'))
      .send({
        email: 'jyx.accounts@gs.local',
        fullName: 'JYX accounts',
        role: 'ACCOUNTANT',
        password: 'Temp-Pass-2026',
        clientIds: [b.jyx.id],
      });
    expect(staff.status).toBe(201);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jyx.accounts@gs.local', password: 'Temp-Pass-2026' });
    const h = { Authorization: `Bearer ${login.body.accessToken as string}` };
    const get = (path: string) =>
      request(app).get(`/api/v1/accounting${path}`).query({ month: '2026-09' }).set(h);
    expect(
      (await get('/billing')).body.rows.map((r: { clientCode: string }) => r.clientCode),
    ).toEqual(['JYX']);
    expect((await get(`/billing/${b.jr.id}`)).status).toBe(404);
    expect((await get(`/billing/${b.jr.id}/pack`)).status).toBe(404);
    const pay = await request(app)
      .post('/api/v1/accounting/receipts')
      .set(h)
      .send(receipt(b.jr.id));
    expect(pay.status).toBe(403);
  });
});
