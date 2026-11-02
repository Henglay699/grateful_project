import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { exchangeRates } from '../../db/schema';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

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

/** Creates a shipment with one declaration and returns the declaration id. */
async function declaration(
  clientId: string,
  declareNo: string,
  declareDate: string,
  direction = 'EXPORT',
) {
  const res = await request(app)
    .post('/api/v1/shipments')
    .set(await as('ADMIN'))
    .send({
      clientId,
      direction,
      transportMode: 'SEA',
      loadType: 'FCL',
      clearancePortId: b.port.id,
      destinationCountryIso2: 'US',
      originCountryIso2: 'KH',
      hblNo: 'NON',
      eta: declareDate,
      containers: [{ containerNo: 'MRKU8974303', size: '40HQ' }],
      invoices: [
        {
          invoiceNo: `INV-${declareNo.replace(/\D/g, '')}`,
          lines: [{ pcs: 1000, ctns: '978', cbm: '45.5', grossWeightKg: '8800', fobUnitPrice: 2 }],
        },
      ],
      declarations: [{ declareNo, declareDate, portId: b.port.id }],
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.declarations[0].id as string;
}

// The accounting engine's own example row (I 122050, JR Apparel).
const I122050 = {
  clearFee: '982.45',
  thc: '355',
  otherPay: '0',
  invRevenue: '185',
  disTotal: '21.25',
  dnTotal: '1334',
};

beforeEach(async () => {
  await resetDb();
  tokens = {};
  b = await seedBasics();
  await db.insert(exchangeRates).values([
    { effectiveDate: '2026-08-01', usdToKhr: '4030' },
    { effectiveDate: '2026-09-01', usdToKhr: '4041' },
  ]);
});
afterAll(async () => {
  await pool.end();
});

describe('monthly ledger', () => {
  it('computes invoice date, rate, commission, VAT and net profit on the server', async () => {
    const declId = await declaration(b.jr.id, 'I 122050', '2026-08-21'); // a Friday
    const res = await request(app)
      .post('/api/v1/accounting/ledger')
      .set(await as('ACCOUNTANT'))
      .send({ declarationId: declId, ...I122050 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      declareNo: 'I 122050',
      clientCode: 'JR',
      invDate: '2026-08-24',
      exchangeRate: '4030.0000',
      commission: '0.00',
      vat: '18.50',
      netProfit: '202.80',
      cheaStatus: 'UNPAID',
      documents: [],
    });
  });

  it('uses the client commission (JYX $50) and recalculates on edit', async () => {
    const declId = await declaration(b.jyx.id, 'I 95925', '2026-09-02');
    const h = await as('ACCOUNTANT');
    const created = (
      await request(app).post('/api/v1/accounting/ledger').set(h).send({
        declarationId: declId,
        clearFee: '285.53',
        invRevenue: '150',
        disTotal: '190.53',
        dnTotal: '347.11',
      })
    ).body;
    expect(created).toMatchObject({
      commission: '50.00',
      netProfit: '352.11',
      exchangeRate: '4041.0000',
      invDate: '2026-09-03',
    });
    const upd = await request(app)
      .patch(`/api/v1/accounting/ledger/${created.id}`)
      .set(h)
      .send({ otherPay: '12.50', commission: '0', cheaStatus: 'PAID' });
    expect(upd.body).toMatchObject({
      otherPay: '12.50',
      commission: '0.00',
      netProfit: '389.61',
      cheaStatus: 'PAID',
    });
    const reset = await request(app)
      .patch(`/api/v1/accounting/ledger/${created.id}`)
      .set(h)
      .send({ commission: null });
    expect(reset.body).toMatchObject({ commission: '50.00', netProfit: '339.61' });
  });

  it('one ledger row per declaration; the picker hides used declarations', async () => {
    const h = await as('ACCOUNTANT');
    const declId = await declaration(b.jr.id, 'I 1', '2026-08-03');
    await declaration(b.jr.id, 'I 2', '2026-08-04');
    await request(app).post('/api/v1/accounting/ledger').set(h).send({ declarationId: declId });
    const dup = await request(app)
      .post('/api/v1/accounting/ledger')
      .set(h)
      .send({ declarationId: declId });
    expect(dup.status).toBe(409);
    const opts = await request(app).get('/api/v1/accounting/declarations').set(h);
    expect(opts.body.map((o: { declareNo: string }) => o.declareNo)).toEqual(['I 2']);
  });

  it('lists a month with totals and exports it', async () => {
    const h = await as('ACCOUNTANT');
    await request(app)
      .post('/api/v1/accounting/ledger')
      .set(h)
      .send({ declarationId: await declaration(b.jr.id, 'I 122050', '2026-08-21'), ...I122050 });
    await request(app)
      .post('/api/v1/accounting/ledger')
      .set(h)
      .send({ declarationId: await declaration(b.jyx.id, 'I 7', '2026-09-10'), invRevenue: '100' });
    const aug = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ month: '2026-08' })
      .set(h);
    expect(aug.body.meta.total).toBe(1);
    expect(aug.body.totals).toMatchObject({
      rows: 1,
      netProfit: '202.80',
      invRevenue: '185.00',
      unpaid: 1,
    });
    const xlsx = await request(app)
      .get('/api/v1/accounting/ledger/export.xlsx')
      .query({ month: '2026-08' })
      .set(h);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-disposition']).toContain('monthly-ledger-2026-08');

    // Whole year: both months together; another year has nothing.
    const y2026 = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ year: '2026' })
      .set(h);
    expect(y2026.body.meta.total).toBe(2);
    expect(y2026.body.totals.rows).toBe(2);
    const y2025 = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ year: '2025' })
      .set(h);
    expect(y2025.body.meta.total).toBe(0);
    // A month wins over a year when both are sent.
    const both = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ year: '2026', month: '2026-08' })
      .set(h);
    expect(both.body.meta.total).toBe(1);
    const yx = await request(app)
      .get('/api/v1/accounting/ledger/export.xlsx')
      .query({ year: '2026' })
      .set(h);
    expect(yx.headers['content-disposition']).toContain('yearly-ledger-2026');
  });

  it('roles: operators cannot see accounting; viewers can read but not write', async () => {
    expect(
      (
        await request(app)
          .get('/api/v1/accounting/ledger')
          .set(await as('OPERATOR'))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/accounting/ledger')
          .set(await as('VIEWER'))
      ).status,
    ).toBe(200);
    const declId = await declaration(b.jr.id, 'I 3', '2026-08-05');
    expect(
      (
        await request(app)
          .post('/api/v1/accounting/ledger')
          .set(await as('VIEWER'))
          .send({ declarationId: declId })
      ).status,
    ).toBe(403);
  });
});

describe('clear fee payments to Chea', () => {
  const URL = '/api/v1/accounting/clear-fee-payments';

  it("pays a month's clear fee in parts and shows the balance (negative = overpaid)", async () => {
    const h = await as('ACCOUNTANT');
    for (const [no, date, fee] of [
      ['I 1', '2026-09-02', '600.25'],
      ['I 2', '2026-09-03', '400'],
    ] as const)
      await request(app)
        .post('/api/v1/accounting/ledger')
        .set(h)
        .send({ declarationId: await declaration(b.jr.id, no, date), clearFee: fee });

    const empty = await request(app).get(URL).query({ month: '2026-09' }).set(h);
    expect(empty.body).toMatchObject({ clearFee: '1000.25', paid: '0.00', balance: '1000.25' });
    expect(empty.body.payments).toEqual([]);

    // Entered out of order: listed by pay date.
    await request(app).post(URL).set(h).send({
      month: '2026-09',
      paidOn: '2026-10-08',
      amount: '600',
      remark: 'Paid for next month',
    });
    const res = await request(app)
      .post(URL)
      .set(h)
      .send({ month: '2026-09', paidOn: '2026-09-20', amount: '1,000.25' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ clearFee: '1000.25', paid: '1600.25', balance: '-600.00' });
    expect(res.body.payments.map((p: { paidOn: string }) => p.paidOn)).toEqual([
      '2026-09-20',
      '2026-10-08',
    ]);
    expect(res.body.payments[1]).toMatchObject({ amount: '600.00', remark: 'Paid for next month' });

    // Another month is untouched.
    const oct = await request(app).get(URL).query({ month: '2026-10' }).set(h);
    expect(oct.body).toMatchObject({ clearFee: '0.00', paid: '0.00', payments: [] });

    const id = res.body.payments[1].id as string;
    expect(
      (await request(app).patch(`${URL}/${id}`).set(h).send({ amount: '0', remark: null })).status,
    ).toBe(400);
    await request(app).patch(`${URL}/${id}`).set(h).send({ amount: '500', remark: null });
    await request(app).delete(`${URL}/${res.body.payments[0].id}`).set(h);
    const after = await request(app).get(URL).query({ month: '2026-09' }).set(h);
    expect(after.body).toMatchObject({ paid: '500.00', balance: '500.25' });
    expect(after.body.payments).toEqual([
      expect.objectContaining({ paidOn: '2026-10-08', amount: '500.00', remark: null }),
    ]);
  });

  it('carries an overpayment forward from months before payment tracking', async () => {
    const h = await as('ACCOUNTANT');
    for (const [no, date, fee] of [
      ['I 21', '2026-08-04', '900'],
      ['I 22', '2026-09-07', '1200'],
    ] as const)
      await request(app)
        .post('/api/v1/accounting/ledger')
        .set(h)
        .send({ declarationId: await declaration(b.jr.id, no, date), clearFee: fee });
    for (const month of ['2026-08', '2026-09'])
      await request(app)
        .post(URL)
        .set(h)
        .send({ month, paidOn: `${month}-28`, amount: '1000' });

    const aug = await request(app).get(URL).query({ month: '2026-08' }).set(h);
    expect(aug.body).toMatchObject({ carriedIn: '0.00', balance: '-100.00' });
    const sep = await request(app).get(URL).query({ month: '2026-09' }).set(h);
    expect(sep.body).toMatchObject({ carriedIn: '100.00', balance: '100.00' });

    // Payments settle an older month (Paid) but leave an uncovered one as imported.
    const status = async (month: string) =>
      (await request(app).get('/api/v1/accounting/ledger').query({ month }).set(h)).body.data.map(
        (r: { cheaStatus: string }) => r.cheaStatus,
      );
    expect(await status('2026-08')).toEqual(['PAID']);
    expect(await status('2026-09')).toEqual(['UNPAID']);
    await request(app)
      .post(URL)
      .set(h)
      .send({ month: '2026-09', paidOn: '2026-10-30', amount: '100' });
    expect(await status('2026-09')).toEqual(['PAID']);
  });

  it('never counts a row with no clear fee as unpaid', async () => {
    const h = await as('ACCOUNTANT');
    for (const [no, fee] of [
      ['I 31', '0'],
      ['I 32', '250'],
    ] as const)
      await request(app)
        .post('/api/v1/accounting/ledger')
        .set(h)
        .send({ declarationId: await declaration(b.jr.id, no, '2026-12-03'), clearFee: fee });
    const res = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ month: '2026-12', cheaStatus: 'UNPAID' })
      .set(h);
    expect(res.body.totals.unpaid).toBe(1);
    expect(res.body.data.map((r: { clearFee: string }) => Number(r.clearFee))).toEqual([250]);
    const all = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ month: '2026-12' })
      .set(h);
    expect(
      all.body.data.map((r: { clearFee: string; cheaStatus: string }) => [
        Number(r.clearFee),
        r.cheaStatus,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [0, 'NA'],
        [250, 'UNPAID'],
      ]),
    );
  });

  it('marks a month Paid once its payments (plus earlier overpayment) cover its clear fee', async () => {
    const h = await as('ACCOUNTANT');
    for (const [no, date, fee] of [
      ['I 11', '2026-10-02', '300'],
      ['I 12', '2026-10-05', '200'],
      ['I 13', '2026-11-03', '400'],
    ] as const)
      await request(app)
        .post('/api/v1/accounting/ledger')
        .set(h)
        .send({ declarationId: await declaration(b.jr.id, no, date), clearFee: fee });
    const status = async (month: string) => {
      const res = await request(app).get('/api/v1/accounting/ledger').query({ month }).set(h);
      return {
        rows: res.body.data.map((r: { cheaStatus: string }) => r.cheaStatus),
        unpaid: res.body.totals.unpaid,
      };
    };
    expect(await status('2026-10')).toEqual({ rows: ['UNPAID', 'UNPAID'], unpaid: 2 });

    // Paid in two parts; the second overpays by 150, which is deducted from November.
    await request(app)
      .post(URL)
      .set(h)
      .send({ month: '2026-10', paidOn: '2026-10-20', amount: '250' });
    expect((await status('2026-10')).unpaid).toBe(2);
    await request(app)
      .post(URL)
      .set(h)
      .send({ month: '2026-10', paidOn: '2026-11-02', amount: '400' });
    expect(await status('2026-10')).toEqual({ rows: ['PAID', 'PAID'], unpaid: 0 });

    const nov = await request(app).get(URL).query({ month: '2026-11' }).set(h);
    expect(nov.body).toMatchObject({ carriedIn: '150.00', balance: '250.00' });
    await request(app)
      .post(URL)
      .set(h)
      .send({ month: '2026-11', paidOn: '2026-12-01', amount: '250' });
    expect(await status('2026-11')).toEqual({ rows: ['PAID'], unpaid: 0 });
    const unpaidOnly = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ month: '2026-11', cheaStatus: 'UNPAID' })
      .set(h);
    expect(unpaidOnly.body.data).toEqual([]);
  });

  it('needs accounting:write to record a payment', async () => {
    const res = await request(app)
      .post(URL)
      .set(await as('VIEWER'))
      .send({ month: '2026-09', paidOn: '2026-09-20', amount: '100' });
    expect(res.status).toBe(403);
    expect(
      (
        await request(app)
          .get(URL)
          .query({ month: '2026-09' })
          .set(await as('VIEWER'))
      ).status,
    ).toBe(200);
  });
});

describe('billing documents', () => {
  /** The ledger row with the example amounts, approved in Chea Payments (so it has numbers). */
  async function ledgerRow(clientId = b.jr.id, declareNo = 'I 122050', date = '2026-08-21') {
    const h = await as('ACCOUNTANT');
    const declarationId = await declaration(clientId, declareNo, date);
    const res = await request(app)
      .post('/api/v1/accounting/ledger')
      .set(h)
      .send({ declarationId, ...I122050 });
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ declarationId })
        .set(h)
    ).body;
    const cn = await request(app)
      .post('/api/v1/accounting/docs/credit-notes')
      .set(h)
      .send({ ...pre, lines: [{ ...pre.lines[0], unitPrice: I122050.clearFee }] });
    await request(app).post(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/issue`).set(h);
    await request(app)
      .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
      .set(h)
      .send({ reviewStatus: 'CHECKED' })
      .expect(200);
    return res.body as { id: string };
  }

  it('tax invoice: prefill → create (GS26-001, VAT and KHR) → issue syncs the ledger → void reverses it', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/tax-invoices/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    expect(pre).toMatchObject({
      invoiceDate: '2026-08-24',
      exchangeRate: '4030.0000',
      containerNo: 'MRKU8974303',
      pkgs: '978',
      pkgsUnit: 'CTNS',
      grossWeightKg: '8800',
      volumeCbm: '45.5',
      pod: 'UNITED STATES',
    });
    expect(pre.lines[0]).toMatchObject({
      description: expect.stringContaining('EXPORT PROCESSING FEE'),
      unitPrice: '185',
    });

    const created = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send(pre);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      number: 'GS26-001',
      status: 'DRAFT',
      declareNo: 'I 122050',
    });
    expect(created.body.totals).toEqual({
      subtotal: '185.00',
      vat: '18.50',
      total: '203.50',
      subtotalKhr: '745550',
      vatKhr: '74555',
      totalKhr: '820105',
    });
    expect(created.body.lines[0]).toMatchObject({
      subtotal: '185.00',
      vat: '18.50',
      amount: '203.50',
    });
    // The shipment's mode rides along for printing (by air the volume prints "NON").
    expect(created.body.header.transportMode).toBe('SEA');
    const shipMode = (mode: string) =>
      pool.query(
        `UPDATE shipments SET transport_mode = $1 WHERE id = (SELECT d.shipment_id FROM accounting_records a
           JOIN customs_declarations d ON d.id = a.declaration_id WHERE a.id = $2)`,
        [mode, rec.id],
      );
    await shipMode('AIR');
    expect(
      (await request(app).get(`/api/v1/accounting/docs/tax-invoices/${created.body.id}`).set(h))
        .body.header.transportMode,
    ).toBe('AIR');
    await shipMode('SEA');

    // Change the fee while still a draft; then issue.
    const id = created.body.id;
    await request(app)
      .put(`/api/v1/accounting/docs/tax-invoices/${id}`)
      .set(h)
      .send({ ...pre, lines: [{ ...pre.lines[0], unitPrice: '200' }] });
    const issued = await request(app)
      .post(`/api/v1/accounting/docs/tax-invoices/${id}/issue`)
      .set(h);
    expect(issued.body).toMatchObject({ status: 'ISSUED', number: 'GS26-001' });
    let led = (await request(app).get(`/api/v1/accounting/ledger/${rec.id}`).set(h)).body;
    expect(led).toMatchObject({
      invNo: 'GS26-001',
      invRevenue: '200.00',
      vat: '20.00',
      netProfit: '217.80',
    });
    expect(led.documents).toContainEqual({
      type: 'tax-invoices',
      id,
      number: 'GS26-001',
      status: 'ISSUED',
    });

    // Issued, it can still be fixed: it stays issued with its number, and the ledger follows.
    const edited = await request(app)
      .put(`/api/v1/accounting/docs/tax-invoices/${id}`)
      .set(h)
      .send({ ...pre, invoiceNo: 'GS26-999', lines: [{ ...pre.lines[0], unitPrice: '210' }] });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ status: 'ISSUED', number: 'GS26-001' });
    expect(
      (await request(app).get(`/api/v1/accounting/ledger/${rec.id}`).set(h)).body,
    ).toMatchObject({ invNo: 'GS26-001', invRevenue: '210.00' });
    await request(app)
      .put(`/api/v1/accounting/docs/tax-invoices/${id}`)
      .set(h)
      .send({ ...pre, lines: [{ ...pre.lines[0], unitPrice: '200' }] });
    expect(
      (await request(app).delete(`/api/v1/accounting/docs/tax-invoices/${id}`).set(h)).status,
    ).toBe(409);
    expect((await request(app).delete(`/api/v1/accounting/ledger/${rec.id}`).set(h)).status).toBe(
      409,
    );

    const voided = await request(app)
      .post(`/api/v1/accounting/docs/tax-invoices/${id}/void`)
      .set(h)
      .send({ reason: 'Wrong customer' });
    expect(voided.body.status).toBe('VOID');
    led = (await request(app).get(`/api/v1/accounting/ledger/${rec.id}`).set(h)).body;
    // A cancelled number is never reused: the shipment takes the next one.
    expect(led).toMatchObject({ invNo: 'GS26-002', invRevenue: '0.00', netProfit: '17.80' });
    // A cancelled invoice stays on record with its number.
    expect(
      (await request(app).delete(`/api/v1/accounting/docs/tax-invoices/${id}`).set(h)).status,
    ).toBe(409);

    const next = await request(app).post('/api/v1/accounting/docs/tax-invoices').set(h).send(pre);
    expect(next.body.number).toBe('GS26-002');
  });

  it('a new VAT rate in Settings applies to documents made from then on, never to ones already made', async () => {
    const h = await as('ACCOUNTANT');
    const before = await ledgerRow(); // invoice date 2026-08-24, made at the standard 10%
    expect(
      (await request(app).get(`/api/v1/accounting/ledger/${before.id}`).set(h)).body,
    ).toMatchObject({ vatRate: '10.00', vat: '18.50' });

    // Only an admin (settings:manage) changes it; everyone signed in can read it.
    await request(app)
      .post('/api/v1/settings/vat-rates')
      .set(h)
      .send({ effectiveDate: '2026-08-01', percent: 12 })
      .expect(403);
    const added = await request(app)
      .post('/api/v1/settings/vat-rates')
      .set(await as('ADMIN'))
      .send({ effectiveDate: '2026-08-01', percent: 12, note: 'Prakas 123' });
    expect(added.status).toBe(201);
    await request(app)
      .post('/api/v1/settings/vat-rates')
      .set(await as('ADMIN'))
      .send({ effectiveDate: '2026-08-01', percent: 11 })
      .expect(409);
    expect(
      (
        await request(app)
          .get('/api/v1/meta/vat-rates')
          .set(await as('VIEWER'))
      ).body,
    ).toEqual([
      { id: added.body.id, effectiveDate: '2026-08-01', percent: '12.00', note: 'Prakas 123' },
    ]);

    // The row made before keeps its 10%, even when edited later.
    const edited = await request(app)
      .patch(`/api/v1/accounting/ledger/${before.id}`)
      .set(h)
      .send({ invRevenue: '200' });
    expect(edited.body).toMatchObject({ vatRate: '10.00', vat: '20.00' });

    // A shipment made now takes 12% everywhere: ledger, tax invoice, record summary.
    const after = await ledgerRow(b.jr.id, 'I 122051', '2026-08-21');
    expect(
      (await request(app).get(`/api/v1/accounting/ledger/${after.id}`).set(h)).body,
    ).toMatchObject({ vatRate: '12.00', vat: '22.20' });
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/tax-invoices/prefill')
        .query({ recordId: after.id })
        .set(h)
    ).body;
    expect(pre.vatRate).toBe('12.00');
    const inv = await request(app).post('/api/v1/accounting/docs/tax-invoices').set(h).send(pre);
    expect(inv.body.header.vatRate).toBe('12.00');
    expect(inv.body.totals).toMatchObject({ subtotal: '185.00', vat: '22.20', total: '207.20' });
    expect(inv.body.lines[0]).toMatchObject({ vat: '22.20', amount: '207.20' });

    const rs = (
      await request(app)
        .get('/api/v1/accounting/docs/record-summaries/prefill')
        .query({ recordId: after.id })
        .set(h)
    ).body;
    expect(rs.vatRate).toBe('12.00');
    expect(rs.lines[0]).toMatchObject({ mark: 'VAT 12%', unitPrice: '185' });
    const summary = await request(app)
      .post('/api/v1/accounting/docs/record-summaries')
      .set(h)
      // A stale "VAT 10%" Mark from the browser follows the summary's percent.
      .send({ ...rs, lines: [{ ...rs.lines[0], mark: 'VAT 10%' }] });
    expect(summary.status).toBe(201);
    expect(summary.body.lines[0]).toMatchObject({ mark: 'VAT 12%', subtotal: '207.20' });
    expect(summary.body.totals.total).toBe('207.20');

    // Removing the rate changes nothing already made.
    await request(app)
      .delete(`/api/v1/settings/vat-rates/${added.body.id}`)
      .set(await as('ADMIN'))
      .expect(204);
    expect(
      (await request(app).get(`/api/v1/accounting/docs/tax-invoices/${inv.body.id}`).set(h)).body
        .totals.vat,
    ).toBe('22.20');
  });

  it('keeps decimals the prototype dropped (18.75 is not 18)', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/disbursements/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const res = await request(app)
      .post('/api/v1/accounting/docs/disbursements')
      .set(h)
      .send({
        ...pre,
        lines: [
          { description: 'CUSTOMS PROCESSING FEE', qty: 1, unitPrice: '18.75' },
          { description: 'LOLO', qty: '2', unitPrice: '1.25' },
        ],
      });
    expect(res.body).toMatchObject({ number: 'DIS001' });
    expect(res.body.totals).toMatchObject({ total: '21.25', vat: '0.00', totalKhr: '85638' });
  });

  it('debit notes take the ledger number (one per shipment); credit notes and record summaries prefill from the ledger', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const dnPre = (
      await request(app)
        .get('/api/v1/accounting/docs/debit-notes/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    expect(
      (await request(app).post('/api/v1/accounting/docs/debit-notes').set(h).send(dnPre)).body
        .number,
    ).toBe('JR2608001');
    expect(
      (await request(app).post('/api/v1/accounting/docs/debit-notes').set(h).send(dnPre)).status,
    ).toBe(409);

    const cnPre = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    // The broker's voucher bills Grateful Solutions, with the usual charges to price.
    expect(cnPre.billTo).toMatch(/GRATEFUL SOLUTIONS/);
    expect(cnPre.lines.map((l: { description: string }) => l.description)).toEqual([
      'EXPORT-CLEARANCE',
      'TRUCKING',
      'CUSTOMS ACC',
      'CUSTOM PROCESSING FEE',
      'LOLO',
    ]);
    const prices = ['115', '280', '10', '18.75', '62.70'];
    cnPre.lines.forEach((l: { unitPrice: string }, i: number) => (l.unitPrice = prices[i]!));
    const cn = await request(app).post('/api/v1/accounting/docs/credit-notes').set(h).send(cnPre);
    expect(cn.body).toMatchObject({ number: 'CN26-002' });
    expect(cn.body.totals.total).toBe('486.45');
    // Submitted, then checked: the total becomes the declaration's Clear Fee.
    await request(app)
      .post(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/issue`)
      .set(h)
      .expect(200);
    const fee = async () =>
      (await request(app).get(`/api/v1/accounting/ledger/${rec.id}`).set(h)).body.clearFee;
    expect(await fee()).toBe('982.45');
    await request(app)
      .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
      .set(h)
      .send({ reviewStatus: 'CHECKED' })
      .expect(200);
    expect(await fee()).toBe('486.45');

    // Checked, so numbered: the shipment waits in the Record Summary picker until it has one.
    const waiting = async () =>
      (await request(app).get('/api/v1/accounting/eligible/record-summaries').set(h)).body.map(
        (r: { recordId: string }) => r.recordId,
      );
    expect(await waiting()).toContain(rec.id);
    const rsPre = (
      await request(app)
        .get('/api/v1/accounting/docs/record-summaries/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const rs = await request(app)
      .post('/api/v1/accounting/docs/record-summaries')
      .set(h)
      .send(rsPre);
    expect(rs.status).toBe(201);
    // The standard export breakdown; the processing fee is the ledger's service fee + 10% VAT.
    expect(rs.body.lines[0]).toMatchObject({
      description: 'EXPORT PROCESSING FEE',
      unitPrice: '185.0000',
      subtotal: '203.50',
      mark: 'VAT 10%',
    });
    expect(rs.body.lines[1]).toMatchObject({ description: 'HBL FEE', unit: "40'HQ" });
    // Per-set charges are billed by the SET whatever the container.
    expect(
      rs.body.lines.find((l: { description: string }) => l.description === 'DOCUMENT FEE').unit,
    ).toBe('SET');
    expect(rs.body.totals.total).toBe('203.50');
    expect(rs.body.header).toMatchObject({
      direction: 'EXPORT',
      loadType: 'FCL',
      declareNo: 'I 122050',
      containerSize: '40HQ',
    });
    expect(await waiting()).not.toContain(rec.id);
    const list = await request(app).get('/api/v1/accounting/docs/record-summaries').set(h);
    expect(list.body.data[0]).toMatchObject({
      direction: 'EXPORT',
      invNo: rs.body.header.invNo,
      dnNo: rs.body.header.dnNo,
      quantityText: rs.body.header.quantityText,
    });
    // INV / DIS / DN are the ledger's: a typed one is ignored, and a correction there shows.
    const ledgerInv = rs.body.header.invNo;
    expect(ledgerInv).toBeTruthy();
    await request(app)
      .put(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`)
      .set(h)
      .send({ ...rsPre, invNo: 'TYPED-1', disNo: 'TYPED-2', dnNo: 'TYPED-3' })
      .expect(200);
    const rsDoc = async () =>
      (await request(app).get(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`).set(h))
        .body;
    expect((await rsDoc()).header).toMatchObject({
      invNo: ledgerInv,
      disNo: rs.body.header.disNo,
      dnNo: rs.body.header.dnNo,
    });
    // By air there is no CBM: always "NON", whatever is typed.
    await request(app)
      .put(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`)
      .set(h)
      .send({ ...rsPre, transportMode: 'AIR', loadType: 'NONE', cbm: '12.5' })
      .expect(200);
    expect((await rsDoc()).header).toMatchObject({ transportMode: 'AIR', cbm: 'NON' });
    await request(app)
      .put(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`)
      .set(h)
      .send(rsPre)
      .expect(200);
    await pool.query(`UPDATE accounting_records SET inv_no = 'GS26-999' WHERE id = $1`, [rec.id]);
    expect((await rsDoc()).header.invNo).toBe('GS26-999');
    expect(
      (await request(app).get('/api/v1/accounting/docs/record-summaries').set(h)).body.data[0]
        .invNo,
    ).toBe('GS26-999');
    // Credit-Noted-style filters: shipment, year, month of any year.
    const count = async (query: Record<string, string | number>) =>
      (await request(app).get('/api/v1/accounting/docs/record-summaries').query(query).set(h)).body
        .meta.total;
    const [y, m] = rs.body.date.split('-').map(Number);
    expect(await count({ direction: 'EXPORT', year: y, monthOfYear: m })).toBe(1);
    expect(await count({ direction: 'IMPORT' })).toBe(0);
    expect(await count({ year: y - 1 })).toBe(0);
    expect(await count({ monthOfYear: (m % 12) + 1 })).toBe(0);
  });

  it('a record summary checked in Expense to Clients fills INV, THC, DIS and DN and decides them', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/record-summaries/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const line = (description: string, unitPrice: string, qty = '1', mark = '') => ({
      description,
      qty,
      unit: 'SHIP',
      unitPrice,
      mark,
    });
    const rs = await request(app)
      .post('/api/v1/accounting/docs/record-summaries')
      .set(h)
      .send({
        ...pre,
        lines: [
          line('EXPORT PROCESSING FEE', '100', '1', 'VAT 10%'),
          line('CUSTOMS PROCESSING FEE', '20', '1', 'Receipt'),
          line('WAREHOUSE / STORAGE FEE', '10', '1', 'Receipt'),
          line('HBL FEE', '30', '1', 'Receipt'),
          line('LOLO AT PORT', '15', '1', 'Receipt'),
          line('TRUCKING FEE', '100', '2'),
          // A receipt, but billed on the debit note.
          line('LOLO EMPTY CONTAINER', '5', '1', 'Receipt'),
          line('SCAN FEE', '0', '1', 'Receipt'),
        ],
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/issue`)
      .set(h)
      .expect(200);
    const led = async () =>
      (await request(app).get(`/api/v1/accounting/ledger/${rec.id}`).set(h)).body;
    const review = (reviewStatus: string, message?: string) =>
      request(app)
        .patch(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/review`)
        .set(h)
        .send({ reviewStatus, message });
    const before = await led();
    // Submitted: waiting in Expense to Clients, not in the ledger yet.
    const queue = async (review?: string) =>
      (
        await request(app)
          .get('/api/v1/accounting/record-summaries/review')
          .query(review ? { review } : {})
          .set(h)
      ).body;
    expect((await queue('UNCHECKED')).data.map((r: { id: string }) => r.id)).toContain(rs.body.id);
    expect((await led()).dnTotal).toBe(before.dnTotal);
    // Operations can't check their own summaries.
    expect(
      (
        await request(app)
          .patch(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/review`)
          .set(await as('OPERATOR'))
          .send({ reviewStatus: 'CHECKED' })
      ).status,
    ).toBe(403);
    // Opened by accounting: Reviewed, still out of the ledger.
    await review('REVIEWED').expect(200);
    expect((await queue()).counts).toMatchObject({ unchecked: 0, reviewed: 1 });
    expect((await led()).dnTotal).toBe(before.dnTotal);
    await review('CHECKED').expect(200);
    expect((await queue()).counts).toMatchObject({ checked: 1, reviewed: 0 });
    // Opening it again keeps it Approved.
    await review('REVIEWED').expect(200);
    expect((await queue()).counts).toMatchObject({ checked: 1 });
    const after = await led();
    // INV = processing fee; DIS = the receipt lines; DN = the rest; THC = the HBL fee.
    expect(after).toMatchObject({
      invRevenue: '100.00',
      vat: '10.00',
      thc: '30.00',
      disTotal: '75.00',
      dnTotal: '205.00',
    });
    // Net profit = INV + REIM + DN − (Clear Fee + THC + CM + Other Pay).
    expect(Number(after.netProfit)).toBeCloseTo(
      100 +
        75 +
        205 -
        (Number(after.clearFee) + 30 + Number(after.commission) + Number(after.otherPay)),
      2,
    );

    // A new Disbursement / Debit Note for the shipment starts with the summary's lines.
    const prefillOf = async (type: string) =>
      (
        await request(app)
          .get(`/api/v1/accounting/docs/${type}/prefill`)
          .query({ recordId: rec.id })
          .set(h)
      ).body.lines.map((l: { description: string; unitPrice: string }) => [
        l.description,
        l.unitPrice,
      ]);
    expect(await prefillOf('disbursements')).toEqual([
      ['CUSTOMS PROCESSING FEE', '20'],
      ['WAREHOUSE / STORAGE FEE', '10'],
      ['HBL FEE', '30'],
      ['LOLO AT PORT', '15'],
    ]);
    expect(await prefillOf('debit-notes')).toEqual([
      ['TRUCKING FEE', '100'],
      ['LOLO EMPTY CONTAINER', '5'],
    ]);

    // Checking also made the shipment's drafts: tax invoice (the processing fee), DIS and DN.
    const drafts = async (table: string) =>
      (
        await pool.query(
          `SELECT id, status FROM ${table} WHERE accounting_record_id = $1 AND status <> 'VOID'`,
          [rec.id],
        )
      ).rows as { id: string; status: string }[];
    const [taxDraft] = await drafts('tax_invoices');
    expect(taxDraft).toMatchObject({ status: 'DRAFT' });
    expect((await drafts('disbursements')).length).toBe(1);
    expect((await drafts('debit_notes')).length).toBe(1);
    const tax = (
      await request(app).get(`/api/v1/accounting/docs/tax-invoices/${taxDraft!.id}`).set(h)
    ).body;
    expect(tax.lines.map((l: { unitPrice: string }) => Number(l.unitPrice))).toEqual([100]);
    // Checking again doesn't make a second set.
    await review('UNCHECKED').expect(200);
    await review('CHECKED').expect(200);
    expect((await drafts('tax_invoices')).length).toBe(1);

    // Issuing the tax invoice now gives the ledger its number only; the amounts stay.
    await request(app)
      .post(`/api/v1/accounting/docs/tax-invoices/${tax.id}/issue`)
      .set(h)
      .expect(200);
    expect(await led()).toMatchObject({ invNo: tax.number, invRevenue: '100.00' });

    // Revised: back to Operations as a draft with the note; its amounts leave the ledger.
    await review('REVISED', 'THC should be 35').expect(200);
    const revised = (
      await request(app).get(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`).set(h)
    ).body;
    expect(revised.status).toBe('DRAFT');
    expect(revised.header).toMatchObject({
      reviewStatus: 'REVISED',
      reviewNote: 'THC should be 35',
    });
    expect(await led()).toMatchObject({ invRevenue: '100.00', thc: '0.00', dnTotal: '0.00' });
    await request(app)
      .post(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/issue`)
      .set(h)
      .expect(200);
    await review('CHECKED').expect(200);
    expect((await led()).invRevenue).toBe('100.00');

    // Cancelling the summary hands the amounts back to the issued documents.
    await request(app)
      .post(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/void`)
      .set(h)
      .send({ reason: 'Wrong lines' })
      .expect(200);
    expect(await led()).toMatchObject({
      invRevenue: '100.00',
      thc: '0.00',
      disTotal: '0.00',
      dnTotal: '0.00',
    });

    // A cancelled summary can then be deleted for good; the ledger stays as it is.
    await request(app)
      .delete(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`)
      .set(h)
      .expect(204);
    await request(app)
      .get(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`)
      .set(h)
      .expect(404);
    expect(await led()).toMatchObject({ invRevenue: '100.00', thc: '0.00', dnTotal: '0.00' });
  });

  it('a record summary starts from the shipping plan and joins the Monthly Ledger row later', async () => {
    const h = await as('ACCOUNTANT');
    const declarationId = await declaration(b.jr.id, 'I 149461', '2026-08-21', 'IMPORT');
    const picker = async () =>
      (await request(app).get('/api/v1/accounting/eligible/record-summaries').set(h)).body;
    // Not in the ledger yet, still listed.
    expect(await picker()).toContainEqual(
      expect.objectContaining({ declarationId, recordId: null, declareNo: 'I 149461' }),
    );
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/record-summaries/prefill')
        .query({ declarationId })
        .set(h)
    ).body;
    expect(pre).toMatchObject({
      accountingRecordId: null,
      clientId: b.jr.id,
      declareNo: 'I 149461',
      direction: 'IMPORT',
      containerNo: 'MRKU8974303',
      grossWeightKg: '8800',
    });
    expect(pre.summaryDate > '2026-08-21').toBe(true);
    const rs = await request(app)
      .post('/api/v1/accounting/docs/record-summaries')
      .set(h)
      .send(pre)
      .expect(201);
    expect(rs.body.accountingRecordId).toBeNull();
    expect((await picker()).map((r: { declarationId: string }) => r.declarationId)).not.toContain(
      declarationId,
    );

    // The shipment reaches the ledger (here through its credit note): the summary joins the row
    // and shows its numbers once the credit note is checked.
    const cnPre = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ declarationId })
        .set(h)
    ).body;
    const cn = await request(app)
      .post('/api/v1/accounting/docs/credit-notes')
      .set(h)
      .send({ ...cnPre, lines: [{ ...cnPre.lines[0], unitPrice: '100' }] });
    await request(app).post(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/issue`).set(h);
    await request(app)
      .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
      .set(h)
      .send({ reviewStatus: 'CHECKED' })
      .expect(200);
    const doc = (
      await request(app).get(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`).set(h)
    ).body;
    expect(doc.accountingRecordId).toBeTruthy();
    const led = (
      await request(app).get(`/api/v1/accounting/ledger/${doc.accountingRecordId}`).set(h)
    ).body;
    expect(led.disNo).toBeTruthy();
    expect(doc.header).toMatchObject({ invNo: led.invNo, disNo: led.disNo, dnNo: led.dnNo });
  });

  it('approving a record summary not in the ledger yet puts the shipment there', async () => {
    const h = await as('ACCOUNTANT');
    const declarationId = await declaration(b.jr.id, 'I 151809', '2026-08-21', 'IMPORT');
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/record-summaries/prefill')
        .query({ declarationId })
        .set(h)
    ).body;
    const rs = await request(app)
      .post('/api/v1/accounting/docs/record-summaries')
      .set(h)
      .send({
        ...pre,
        lines: [
          {
            description: 'IMPORT PROCESSING FEE',
            qty: '1',
            unit: 'SHIP',
            unitPrice: '100',
            mark: 'VAT 10%',
          },
        ],
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/issue`)
      .set(h)
      .expect(200);
    const checked = await request(app)
      .patch(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/review`)
      .set(h)
      .send({ reviewStatus: 'CHECKED' });
    // No INV / DIS / DN numbers yet, so no drafts yet.
    expect(checked.body).toEqual({ numbered: [], drafts: 0 });
    const summary = async () =>
      (await request(app).get(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`).set(h))
        .body;
    const recordId = (await summary()).accountingRecordId;
    expect(recordId).toBeTruthy();
    expect(
      (await request(app).get(`/api/v1/accounting/ledger/${recordId}`).set(h)).body,
    ).toMatchObject({ invRevenue: '100.00' });

    // Its Credit Noted checked later: numbers on the summary, and the tax invoice draft made.
    const cnPre = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ declarationId })
        .set(h)
    ).body;
    const cn = await request(app)
      .post('/api/v1/accounting/docs/credit-notes')
      .set(h)
      .send({ ...cnPre, lines: [{ ...cnPre.lines[0], unitPrice: '100' }] });
    await request(app).post(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/issue`).set(h);
    await request(app)
      .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
      .set(h)
      .send({ reviewStatus: 'CHECKED' })
      .expect(200);
    const invNo = (await summary()).header.invNo;
    expect(invNo).toMatch(/^GS26-/);
    const invoices = (await request(app).get('/api/v1/accounting/docs/tax-invoices').set(h)).body;
    expect(invoices.data.map((d: { number: string }) => d.number)).toEqual([invNo]);
  });

  it('a record summary revised after approval keeps its ledger amounts until approved again', async () => {
    const acc = await as('ACCOUNTANT');
    const op = await as('OPERATOR');
    const declarationId = await declaration(b.jr.id, 'I 151810', '2026-08-21', 'IMPORT');
    const docs = '/api/v1/accounting/docs/record-summaries';
    const pre = (await request(app).get(`${docs}/prefill`).query({ declarationId }).set(op)).body;
    const fee = (unitPrice: string) => [
      { description: 'IMPORT PROCESSING FEE', qty: '1', unit: 'SHIP', unitPrice, mark: 'VAT 10%' },
    ];
    const rs = await request(app)
      .post(docs)
      .set(op)
      .send({ ...pre, lines: fee('100') })
      .expect(201);
    const id = rs.body.id;
    await request(app).post(`${docs}/${id}/issue`).set(op).expect(200);
    const review = (reviewStatus: string, message?: string) =>
      request(app).patch(`${docs}/${id}/review`).set(acc).send({ reviewStatus, message });
    await review('CHECKED').expect(200);
    const recordId = (await request(app).get(`${docs}/${id}`).set(op)).body.accountingRecordId;
    const inv = async () =>
      (await request(app).get(`/api/v1/accounting/ledger/${recordId}`).set(acc)).body.invRevenue;
    expect(await inv()).toBe('100.00');

    const resubmit = async (unitPrice: string) => {
      const d = (await request(app).get(`${docs}/${id}`).set(op)).body;
      return request(app)
        .post(`${docs}/${id}/resubmit`)
        .set(op)
        .send({ ...d.header, clientId: d.clientId, lines: fee(unitPrice) });
    };
    const res = await resubmit('150');
    expect(res.status).toBe(200);
    expect(res.body.header.reviewStatus).toBe('REVISION_REQUESTED');
    // Waiting for accounting: the ledger keeps the approved amount.
    expect(await inv()).toBe('100.00');
    await review('CHECKED').expect(200);
    expect(await inv()).toBe('150.00');

    // Sent back by accounting while under revision: its amounts leave the ledger.
    await resubmit('160');
    await review('REVISED', 'Fee is 155').expect(200);
    expect(await inv()).toBe('0.00');
  });

  it('record summaries have their own access: Operations work on them, not the rest of accounting', async () => {
    const rec = await ledgerRow();
    const op = await as('OPERATOR');
    // Operations: the picker, prefill, create, list, edit, submit; never the ledger or invoices.
    const picker = await request(app).get('/api/v1/accounting/eligible/record-summaries').set(op);
    expect(picker.status).toBe(200);
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/record-summaries/prefill')
        .query({ recordId: rec.id })
        .set(op)
    ).body;
    const rs = await request(app)
      .post('/api/v1/accounting/docs/record-summaries')
      .set(op)
      .send(pre);
    expect(rs.status).toBe(201);
    expect(
      (await request(app).get('/api/v1/accounting/docs/record-summaries').set(op)).body.meta.total,
    ).toBe(1);
    await request(app)
      .post(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/issue`)
      .set(op)
      .expect(200);
    expect((await request(app).get('/api/v1/accounting/ledger').set(op)).status).toBe(403);
    expect((await request(app).get('/api/v1/accounting/docs/tax-invoices').set(op)).status).toBe(
      403,
    );
    expect(
      (await request(app).get('/api/v1/accounting/eligible/tax-invoices').set(op)).status,
    ).toBe(403);
    // Viewers can look but not write; a customs broker can't see them at all.
    const viewer = await as('VIEWER');
    expect(
      (await request(app).get('/api/v1/accounting/docs/record-summaries').set(viewer)).status,
    ).toBe(200);
    expect(
      (await request(app).post('/api/v1/accounting/docs/record-summaries').set(viewer).send(pre))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/accounting/docs/record-summaries')
          .set(await as('CUSTOMS_BROKER'))
      ).status,
    ).toBe(403);
  });

  it("accounting's Revised lands in Operations' Record Summary inbox; Approved does not", async () => {
    const rec = await ledgerRow();
    const op = await as('OPERATOR');
    const h = await as('ACCOUNTANT');
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/record-summaries/prefill')
        .query({ recordId: rec.id })
        .set(op)
    ).body;
    const rs = await request(app)
      .post('/api/v1/accounting/docs/record-summaries')
      .set(op)
      .send(pre)
      .expect(201);
    const submit = () =>
      request(app)
        .post(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/issue`)
        .set(op)
        .expect(200);
    const review = (reviewStatus: string, message?: string) =>
      request(app)
        .patch(`/api/v1/accounting/docs/record-summaries/${rs.body.id}/review`)
        .set(h)
        .send({ reviewStatus, message })
        .expect(200);
    const inbox = async () =>
      (await request(app).get('/api/v1/accounting/record-summaries/inbox').set(op).expect(200))
        .body;
    await submit();
    // Opening it (Reviewed) shows on their list but sends no message.
    await review('REVIEWED');
    expect((await inbox()).unread).toBe(0);
    const listed = (await request(app).get('/api/v1/accounting/docs/record-summaries').set(op)).body
      .data;
    expect(listed[0].reviewStatus).toBe('REVIEWED');
    await review('REVISED', 'THC should be 35.00');
    await submit();
    await review('CHECKED');
    const box = await inbox();
    expect(box.unread).toBe(1);
    expect(box.data.map((m: { kind: string }) => m.kind)).toEqual(['REVISED']);
    expect(box.data[0]).toMatchObject({ recordSummaryId: rs.body.id, body: 'THC should be 35.00' });
    expect(
      (await request(app).get('/api/v1/meta/nav-counts').set(op)).body.recordSummaryInbox,
    ).toBe(1);
    await request(app)
      .post('/api/v1/accounting/record-summaries/inbox/read')
      .set(op)
      .send({ messageId: box.data[0].id })
      .expect(204);
    expect((await inbox()).unread).toBe(0);
    // The accountant who sent it gets nothing.
    expect(
      (await request(app).get('/api/v1/accounting/record-summaries/inbox').set(h)).body.unread,
    ).toBe(0);
  });

  it('ignores a typed number, refuses a second invoice and a ledger row from another client', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/tax-invoices/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const first = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send({ ...pre, invoiceNo: 'gs26-212' });
    expect(first.body.number).toBe('GS26-001');
    const dup = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send({ ...pre, invoiceNo: 'GS26-212' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toContain('GS26-001');
    const wrong = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send({ ...pre, clientId: b.jyx.id });
    expect(wrong.status).toBe(422);
  });

  it('lists documents with filters and exports one to Excel', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/tax-invoices/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const doc = (await request(app).post('/api/v1/accounting/docs/tax-invoices').set(h).send(pre))
      .body;
    const list = await request(app)
      .get('/api/v1/accounting/docs/tax-invoices')
      .query({ month: '2026-08', q: 'GS26' })
      .set(h);
    expect(list.body.data[0]).toMatchObject({
      number: 'GS26-001',
      clientCode: 'JR',
      declareNo: 'I 122050',
      total: '203.50',
      status: 'DRAFT',
    });
    expect(
      (
        await request(app)
          .get('/api/v1/accounting/docs/tax-invoices')
          .query({ status: 'ISSUED' })
          .set(h)
      ).body.meta.total,
    ).toBe(0);
    const x = await request(app)
      .get(`/api/v1/accounting/docs/tax-invoices/${doc.id}/export.xlsx`)
      .set(h);
    expect(x.status).toBe(200);
    expect(x.headers['content-disposition']).toContain('GS26-001');
    expect((await request(app).get('/api/v1/accounting/docs/nope').set(h)).status).toBe(400);
  });
});

describe('credit note charge descriptions', () => {
  it('"+ Add New Item" adds to the Charge list once; viewers cannot', async () => {
    const h = await as('CUSTOMS_BROKER');
    const add = (label: string, who = h) =>
      request(app).post('/api/v1/lookups/charges').set(who).send({ label });
    expect((await add(' Overtime clearance ')).status).toBe(201);
    expect((await add('OVERTIME CLEARANCE')).status).toBe(200); // already there
    const charges = (await request(app).get('/api/v1/lookups').set(h)).body.values.CHARGE;
    expect(charges.filter((c: { label: string }) => c.label === 'OVERTIME CLEARANCE')).toHaveLength(
      1,
    );
    expect((await add('Something', await as('VIEWER'))).status).toBe(403);

    // Units work the same way, into the Charge units list.
    const unit = await request(app)
      .post('/api/v1/lookups/charge-units')
      .set(h)
      .send({ label: 'pallet' });
    expect(unit.status).toBe(201);
    expect(unit.body).toEqual({ value: 'PALLET', label: 'PALLET' });
    const units = (await request(app).get('/api/v1/lookups').set(h)).body.values.CHARGE_UNIT;
    expect(units.map((u: { label: string }) => u.label)).toContain('PALLET');
  });
});

describe('customs broker: Credit Noted only', () => {
  it('drafts and submits credit notes; checking puts them in the ledger; sees no other accounting', async () => {
    const declId = await declaration(b.jr.id, 'I 122050', '2026-08-21', 'IMPORT');
    const h = await as('CUSTOMS_BROKER');
    const acc = await as('ACCOUNTANT');
    const api = (m: 'get' | 'post', path: string) =>
      request(app)[m](`/api/v1/accounting${path}`).set(h);

    // The rest of accounting is closed; shipments are readable.
    expect((await api('get', '/ledger')).status).toBe(403);
    expect((await api('get', '/docs/tax-invoices')).status).toBe(403);
    expect((await request(app).get('/api/v1/shipments').set(h)).status).toBe(200);

    const decls = (await api('get', '/credit-notes/declarations')).body;
    expect(decls.map((d: { declareNo: string }) => d.declareNo)).toEqual(['I 122050']);
    const draft = (await api('get', '/docs/credit-notes/prefill').query({ declarationId: declId }))
      .body;
    expect(draft).toMatchObject({ declareNo: 'I 122050', accountingRecordId: '' });
    expect(draft.lines[0]).toMatchObject({ description: 'IMPORT-CLEARANCE', unit: "40'HQ" });
    draft.lines = [{ description: 'IMPORT-CLEARANCE', qty: '1', unit: "40'", unitPrice: '115' }];
    const cn = await api('post', '/docs/credit-notes').send(draft);
    expect(cn.status).toBe(201);

    // The broker's list shows the draft with its shipment details.
    const mine = async () => (await api('get', '/credit-notes/list')).body.data[0];
    expect(await mine()).toMatchObject({
      declareNo: 'I 122050',
      direction: 'IMPORT',
      clientCode: 'JR',
      total: '115.00',
      status: 'DRAFT',
    });

    // Submitted: it waits for accounting's check before it reaches the Monthly Ledger.
    expect((await api('post', `/docs/credit-notes/${cn.body.id}/issue`)).status).toBe(200);
    expect((await mine()).status).toBe('ISSUED');
    expect(
      (await api('get', '/credit-notes/list').query({ status: 'DRAFT' })).body.data,
    ).toHaveLength(0);
    const ledger = () =>
      request(app).get('/api/v1/accounting/ledger').query({ year: '2026' }).set(acc);

    // Voiding a submitted credit note stays with accounting.
    expect(
      (await api('post', `/docs/credit-notes/${cn.body.id}/void`).send({ reason: 'wrong' })).status,
    ).toBe(403);

    // Accounting checks it; the broker can't see or change that.
    expect((await api('get', '/credit-notes/review')).status).toBe(403);
    const review = () =>
      request(app).get('/api/v1/accounting/credit-notes/review').query({ year: 2026 }).set(acc);
    let list = (await review()).body;
    expect(list.counts).toEqual({
      total: 1,
      checked: 0,
      unchecked: 1,
      reviewed: 0,
      revised: 0,
      revisionRequested: 0,
    });
    expect(list.data[0]).toMatchObject({
      declareNo: 'I 122050',
      clientCode: 'JR',
      direction: 'IMPORT',
      total: '115.00',
      reviewStatus: 'UNCHECKED',
    });
    const mark = (who: Record<string, string>, reviewStatus = 'CHECKED') =>
      request(app)
        .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
        .set(who)
        .send({ reviewStatus });
    // Opened by accounting: Reviewed, nothing else changes and the broker isn't told.
    expect((await mark(acc, 'REVIEWED')).body.numbered).toEqual([]);
    list = (await review()).body;
    expect(list.counts).toMatchObject({ unchecked: 0, reviewed: 1 });
    expect(list.data[0].reviewStatus).toBe('REVIEWED');
    expect((await ledger()).body.data).toHaveLength(0);
    expect((await api('get', '/credit-notes/inbox')).body.unread).toBe(0);
    expect((await mark(h)).status).toBe(403);
    expect((await ledger()).body.data).toHaveLength(0);
    expect((await mark(acc)).status).toBe(200);
    // Checked: in the Monthly Ledger with the clear fee and its numbers.
    expect((await ledger()).body.data[0]).toMatchObject({
      declareNo: 'I 122050',
      clearFee: '115.00',
      invNo: 'GS26-001',
      disNo: 'DIS001',
      dnNo: 'JR2608001',
    });
    list = (await review()).body;
    expect(list.counts).toMatchObject({ checked: 1, unchecked: 0, reviewed: 0 });
    // Opening it again doesn't take it back to Reviewed.
    await mark(acc, 'REVIEWED');
    expect((await review()).body.data[0].reviewStatus).toBe('CHECKED');
    expect((await review().query({ review: 'UNCHECKED' })).body.data).toHaveLength(0);
    expect((await review().query({ q: 'I122050', direction: 'IMPORT' })).body.data).toHaveLength(1);

    // An approval needs nothing from the broker: it doesn't reach their inbox.
    const inbox = async () => (await api('get', '/credit-notes/inbox')).body;
    let box = await inbox();
    expect(box.unread).toBe(0);
    expect(box.data).toHaveLength(0);

    // "Revised" needs a message, sends the note back as a draft and takes the fee out.
    const revise = (body: object) =>
      request(app)
        .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
        .set(acc)
        .send({ reviewStatus: 'REVISED', ...body });
    expect((await revise({})).status).toBe(400);
    expect((await revise({ message: 'LOLO should be 62.70' })).status).toBe(200);
    expect((await mine()).status).toBe('DRAFT');
    const fee = async () =>
      (await request(app).get('/api/v1/accounting/ledger').query({ year: '2026' }).set(acc)).body
        .data[0].clearFee;
    expect(await fee()).toBe('0.00');
    // Accounting still sees it, as Revised.
    expect((await review()).body.counts).toMatchObject({ total: 1, revised: 1 });

    box = await inbox();
    expect(box.unread).toBe(1);
    expect(box.data[0]).toMatchObject({
      kind: 'REVISED',
      body: 'LOLO should be 62.70',
      declareNo: 'I 122050',
      readAt: null,
    });
    const msgs = (await api('get', `/docs/credit-notes/${cn.body.id}/messages`)).body;
    expect(msgs[0].kind).toBe('REVISED');

    // The broker fixes it and submits again: Unchecked for accounting, then checked again.
    const doc = (await api('get', `/docs/credit-notes/${cn.body.id}`)).body;
    const fixed = await request(app)
      .put(`/api/v1/accounting/docs/credit-notes/${cn.body.id}`)
      .set(h)
      .send({
        ...doc.header,
        clientId: doc.clientId,
        accountingRecordId: doc.accountingRecordId,
        lines: [
          { description: 'IMPORT-CLEARANCE', qty: '1', unit: "40'", unitPrice: '115' },
          { description: 'LOLO', qty: '1', unit: "40'", unitPrice: '62.70' },
        ],
      });
    expect(fixed.status).toBe(200);
    expect((await api('post', `/docs/credit-notes/${cn.body.id}/issue`)).status).toBe(200);
    expect(await fee()).toBe('0.00');
    expect((await review()).body.data[0]).toMatchObject({
      reviewStatus: 'UNCHECKED',
      total: '177.70',
    });
    expect((await mark(acc)).status).toBe(200);
    expect(await fee()).toBe('177.70');
    // Its numbers stay the same.
    expect((await ledger()).body.data[0].invNo).toBe('GS26-001');

    // Approved again: still just the one Revised message. Reading it clears the badge.
    expect((await inbox()).unread).toBe(1);
    await api('post', '/credit-notes/inbox/read').send({ messageId: box.data[0].id });
    expect((await inbox()).unread).toBe(0);
  });

  it('Revise → Resubmit: Request Revise keeps the approved fee until accounting approves', async () => {
    await declaration(b.jr.id, 'I 30001', '2026-08-21', 'IMPORT');
    const declId = await declaration(b.jr.id, 'I 30002', '2026-08-22', 'IMPORT');
    const h = await as('CUSTOMS_BROKER');
    const acc = await as('ACCOUNTANT');
    const docs = '/api/v1/accounting/docs/credit-notes';
    const draft = (
      await request(app).get(`${docs}/prefill`).query({ declarationId: declId }).set(h)
    ).body;
    const line = (unitPrice: string) => ({
      description: 'IMPORT-CLEARANCE',
      qty: '1',
      unit: "40'",
      unitPrice,
    });
    const cn = await request(app)
      .post(docs)
      .set(h)
      .send({ ...draft, lines: [line('100')] });
    const id = cn.body.id;
    const body = async (unitPrice: string, extra: object = {}) => {
      const d = (await request(app).get(`${docs}/${id}`).set(h)).body;
      return { ...d.header, clientId: d.clientId, lines: [line(unitPrice)], ...extra };
    };
    const resubmit = async (unitPrice: string, extra: object = {}) =>
      request(app)
        .post(`${docs}/${id}/resubmit`)
        .set(h)
        .send(await body(unitPrice, extra));
    const review = (reviewStatus: string, message?: string) =>
      request(app).patch(`${docs}/${id}/review`).set(acc).send({ reviewStatus, message });
    const fee = async () =>
      (await request(app).get('/api/v1/accounting/ledger').query({ year: '2026' }).set(acc)).body
        .data[0].clearFee;

    // A draft isn't revised: it is simply edited.
    expect((await resubmit('100')).status).toBe(409);
    await request(app).post(`${docs}/${id}/issue`).set(h);
    expect((await review('CHECKED')).status).toBe(200);
    expect(await fee()).toBe('100.00');

    // Resubmitted: Request Revise for accounting, same number and declaration; the ledger
    // keeps the approved fee meanwhile.
    const res = await resubmit('120', { declareNo: 'I 30001' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ISSUED',
      number: cn.body.number,
      declareNo: 'I 30002',
      totals: { total: '120.00' },
    });
    expect(res.body.header.reviewStatus).toBe('REVISION_REQUESTED');
    expect(await fee()).toBe('100.00');
    const list = (
      await request(app)
        .get('/api/v1/accounting/credit-notes/review')
        .query({ year: 2026, review: 'REVISION_REQUESTED' })
        .set(acc)
    ).body;
    expect(list.counts).toMatchObject({ checked: 0, revisionRequested: 1 });
    expect(list.data).toHaveLength(1);
    // Request Revise is the maker's; accounting approves or sends back.
    expect((await review('REVISION_REQUESTED')).status).toBe(400);

    // Approved: the Monthly Ledger takes the revised fee.
    expect((await review('CHECKED')).status).toBe(200);
    expect(await fee()).toBe('120.00');

    // Revised again and sent back by accounting: the approved fee comes out.
    await resubmit('130');
    expect(await fee()).toBe('120.00');
    expect((await review('REVISED', 'Wrong rate')).status).toBe(200);
    expect(await fee()).toBe('0.00');

    // ⋯ → Upload support documents: a file kept with this credit note.
    const up = await request(app)
      .post('/api/v1/documents')
      .set(acc)
      .field('title', 'Chea receipt')
      .field('creditNoteId', id)
      .field('clientId', b.jr.id)
      .attach('file', Buffer.from('%PDF-1.4\n'), {
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      });
    expect(up.status).toBe(201);
    const files = (await request(app).get('/api/v1/documents').query({ creditNoteId: id }).set(acc))
      .body;
    expect(files.data.map((d: { title: string }) => d.title)).toEqual(['Chea receipt']);
    expect(files.data[0].creditNoteId).toBe(id);
  });

  it("accounting's remarks reach the broker even when someone else created the note", async () => {
    const declId = await declaration(b.jr.id, 'I 95120', '2026-09-19', 'IMPORT');
    const admin = await as('ADMIN');
    const broker = await as('CUSTOMS_BROKER');
    const draft = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ declarationId: declId })
        .set(admin)
    ).body;
    draft.lines = [{ description: 'LOLO', qty: '1', unit: 'SHIP', unitPrice: '50' }];
    const cn = await request(app)
      .post('/api/v1/accounting/docs/credit-notes')
      .set(admin)
      .send(draft);
    await request(app).post(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/issue`).set(admin);
    await request(app)
      .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
      .set(admin)
      .send({ reviewStatus: 'REVISED', message: 'LOLO should be 62.70' });

    const box = (await request(app).get('/api/v1/accounting/credit-notes/inbox').set(broker)).body;
    expect(box.unread).toBe(1);
    expect(box.data[0]).toMatchObject({
      kind: 'REVISED',
      body: 'LOLO should be 62.70',
      declareNo: 'I 95120',
      direction: 'IMPORT',
      clientName: expect.any(String),
      total: '50.00',
      status: 'DRAFT',
    });
    // The sender doesn't message themselves.
    expect(
      (await request(app).get('/api/v1/accounting/credit-notes/inbox').set(admin)).body.unread,
    ).toBe(0);
  });
});
