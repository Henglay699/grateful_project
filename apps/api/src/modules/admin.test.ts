import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../app';
import { pool } from '../db/client';
import { createUser, refreshCookieFrom, resetDb, seedBasics, TEST_PASSWORD } from '../test/helpers';

const app = createApp();
let b: Awaited<ReturnType<typeof seedBasics>>;
let tokens: Partial<Record<RoleCode, string>> = {};
let ids: Partial<Record<RoleCode, string>> = {};
async function as(role: RoleCode) {
  if (!tokens[role]) {
    const u = await createUser(role);
    ids[role] = u.id;
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: TEST_PASSWORD });
    tokens[role] = res.body.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[role]}` };
}
const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
  request(app)[m](`/api/v1${path}`);

beforeEach(async () => {
  await resetDb();
  tokens = {};
  ids = {};
  b = await seedBasics();
});
afterAll(async () => {
  await pool.end();
});

describe('staff & roles', () => {
  const newStaff = {
    email: 'Sreyneang@GS.local',
    fullName: 'Sreyneang Phal',
    role: 'OPERATOR',
    jobTitle: 'Clearance Officer',
    department: 'Operations',
    password: 'Welcome-2026',
  };

  it('admin adds a staff member who can then sign in; weak passwords and duplicates are refused', async () => {
    const h = await as('ADMIN');
    expect(
      (
        await api('post', '/staff')
          .set(h)
          .send({ ...newStaff, password: 'short' })
      ).status,
    ).toBe(400);
    const res = await api('post', '/staff').set(h).send(newStaff);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'sreyneang@gs.local',
      role: 'OPERATOR',
      jobTitle: 'Clearance Officer',
      isActive: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect((await api('post', '/staff').set(h).send(newStaff)).status).toBe(409);
    const login = await api('post', '/auth/login').send({
      email: 'sreyneang@gs.local',
      password: 'Welcome-2026',
    });
    expect(login.body.user.role).toBe('OPERATOR');
  });

  it('managers can view staff but not manage it', async () => {
    expect((await api('get', '/staff').set(await as('MANAGER'))).status).toBe(200);
    expect(
      (
        await api('post', '/staff')
          .set(await as('MANAGER'))
          .send(newStaff)
      ).status,
    ).toBe(403);
    expect((await api('get', '/staff').set(await as('VIEWER'))).status).toBe(403); // Viewers don't see the staff list
  });

  it('deactivating signs the person out everywhere', async () => {
    const h = await as('ADMIN');
    const s = (await api('post', '/staff').set(h).send(newStaff)).body;
    const login = await api('post', '/auth/login').send({
      email: 'sreyneang@gs.local',
      password: 'Welcome-2026',
    });
    const cookie = refreshCookieFrom(login.headers['set-cookie']);
    await api('patch', `/staff/${s.id}`).set(h).send({ status: 'INACTIVE' });
    expect((await api('post', '/auth/refresh').set('Cookie', cookie!)).status).toBe(401);
    expect(
      (
        await api('post', '/auth/login').send({
          email: 'sreyneang@gs.local',
          password: 'Welcome-2026',
        })
      ).status,
    ).toBe(401);
  });

  it('protects against lock-out: own role, own account, last admin', async () => {
    const h = await as('ADMIN');
    expect((await api('patch', `/staff/${ids.ADMIN}`).set(h).send({ role: 'VIEWER' })).status).toBe(
      422,
    );
    expect(
      (await api('patch', `/staff/${ids.ADMIN}`).set(h).send({ status: 'INACTIVE' })).status,
    ).toBe(422);
    expect((await api('delete', `/staff/${ids.ADMIN}`).set(h)).status).toBe(422);
    const other = (
      await api('post', '/staff')
        .set(h)
        .send({ ...newStaff, role: 'ADMIN' })
    ).body;
    expect((await api('patch', `/staff/${other.id}`).set(h).send({ role: 'MANAGER' })).status).toBe(
      200,
    ); // another admin still exists
  });

  it('admin resets a password; role permissions can be edited (not Admin)', async () => {
    const h = await as('ADMIN');
    const s = (await api('post', '/staff').set(h).send(newStaff)).body;
    expect(
      (await api('post', `/staff/${s.id}/reset-password`).set(h).send({ password: 'Another-2026' }))
        .status,
    ).toBe(204);
    expect(
      (
        await api('post', '/auth/login').send({
          email: 'sreyneang@gs.local',
          password: 'Another-2026',
        })
      ).status,
    ).toBe(200);
    expect((await api('put', '/staff/roles/ADMIN').set(h).send({ permissions: [] })).status).toBe(
      422,
    );
    const roles = await api('put', '/staff/roles/VIEWER')
      .set(h)
      .send({ permissions: ['dashboard:read', 'shipments:read', 'not:real'] });
    expect(roles.status).toBe(400);
    const ok = await api('put', '/staff/roles/VIEWER')
      .set(h)
      .send({ permissions: ['dashboard:read', 'shipments:read'] });
    expect(ok.body.find((r: { code: string }) => r.code === 'VIEWER').permissions).toEqual([
      'dashboard:read',
      'shipments:read',
    ]);
  });

  it('everyone can change their own password', async () => {
    const h = await as('VIEWER');
    expect(
      (
        await api('post', '/auth/change-password')
          .set(h)
          .send({ currentPassword: 'wrong', newPassword: 'NewPass-2026' })
      ).status,
    ).toBe(401);
    expect(
      (
        await api('post', '/auth/change-password')
          .set(h)
          .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPass-2026' })
      ).status,
    ).toBe(204);
    expect(
      (
        await api('post', '/auth/login').send({
          email: 'viewer@test.local',
          password: 'NewPass-2026',
        })
      ).status,
    ).toBe(200);
  });
});

describe('settings', () => {
  it('company details, exchange rates (used by new ledger rows) and lists', async () => {
    const h = await as('ADMIN');
    expect(
      (
        await api('put', '/settings/company')
          .set(h)
          .send({ nameEn: 'GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.', phone: '098 484 414' })
      ).status,
    ).toBe(200);
    expect((await api('get', '/meta/company').set(await as('VIEWER'))).body.phone).toBe(
      '098 484 414',
    );
    await api('post', '/settings/exchange-rates')
      .set(h)
      .send({ effectiveDate: '2026-10-01', usdToKhr: '4019' });
    await api('post', '/settings/exchange-rates')
      .set(h)
      .send({ effectiveDate: '2026-10-01', usdToKhr: '4021' }); // same date → updates
    const all = await api('get', '/settings').set(h);
    expect(all.body.exchangeRates).toEqual([
      expect.objectContaining({ effectiveDate: '2026-10-01', usdToKhr: '4021.0000' }),
    ]);
    expect(
      (
        await api('post', '/settings/ports').set(h).send({
          code: 'pnh19',
          customsPortNo: '19',
          name: 'Tecsrun Dry Port',
          shortName: 'tecsrun',
          kind: 'DRY',
        })
      ).body,
    ).toMatchObject({ code: 'PNH19', shortName: 'TECSRUN' });
    // Edit every field of a port, then delete it (nothing uses it yet).
    const port = (await api('get', '/settings').set(h)).body.ports.find(
      (p: { code: string }) => p.code === 'PNH19',
    );
    expect(
      (
        await api('patch', `/settings/ports/${port.id}`).set(h).send({
          code: 'PNH20',
          customsPortNo: '20',
          name: 'Tecsrun Dry Port 2',
          shortName: 'tecsrun 2',
          kind: 'SEA',
        })
      ).body,
    ).toMatchObject({ code: 'PNH20', customsPortNo: '20', shortName: 'TECSRUN 2', kind: 'SEA' });
    expect((await api('delete', `/settings/ports/${port.id}`).set(h)).status).toBe(204);
    expect((await api('delete', `/settings/ports/${port.id}`).set(h)).status).toBe(404);
    const fw = (await api('post', '/settings/forwarders').set(h).send({ name: 'Hippo Logistics' }))
      .body;
    expect(
      (await api('patch', `/settings/forwarders/${fw.id}`).set(h).send({ isActive: false })).body
        .isActive,
    ).toBe(false);
    const lv = (
      await api('post', '/settings/lookups').set(h).send({ type: 'QUANTITY_UNIT', value: 'DRUMS' })
    ).body;
    expect(lv).toMatchObject({ value: 'DRUMS', label: 'DRUMS' });
    expect((await api('get', '/lookups').set(h)).body.values.QUANTITY_UNIT).toEqual([
      { value: 'DRUMS', label: 'DRUMS' },
    ]);
    expect(
      (await api('get', '/lookups').set(h)).body.forwarders.map((f: { name: string }) => f.name),
    ).not.toContain('Hippo Logistics');
    // Edit a forwarder's name, then delete it (nothing uses it yet).
    expect(
      (
        await api('patch', `/settings/forwarders/${fw.id}`)
          .set(h)
          .send({ name: 'Hippo Logistics Co', contactEmail: 'ops@hippo.test' })
      ).body,
    ).toMatchObject({ name: 'Hippo Logistics Co', contactEmail: 'ops@hippo.test' });
    expect((await api('delete', `/settings/forwarders/${fw.id}`).set(h)).status).toBe(204);
    expect((await api('delete', `/settings/forwarders/${fw.id}`).set(h)).status).toBe(404);
  });

  it('only admins manage settings', async () => {
    expect((await api('get', '/settings').set(await as('MANAGER'))).status).toBe(200);
    expect(
      (
        await api('put', '/settings/company')
          .set(await as('MANAGER'))
          .send({ nameEn: 'X Co' })
      ).status,
    ).toBe(403);
  });
});

describe('exchange rates: edit and Excel import', () => {
  /** Laid out like the NBC "Exchange Rate 2026" sheet: title, header, text dates, rates as text. */
  async function nbcSheet(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sep');
    ws.addRow(['Exchange Rate 2026']);
    ws.addRow(['Release Date', 'Currency', 'Rate']);
    ws.addRow(['September 30, 2026', 'USD/KHR', '4055']);
    ws.addRow(['September 29, 2026', 'USD/KHR', '4,056']);
    ws.addRow([new Date(Date.UTC(2026, 8, 1)), 'USD/KHR', 4047]); // a real Excel date
    ws.addRow(['September 2, 2026', 'USD/KHR', '']); // no rate → skipped
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('previews, then imports; same dates are updated, not duplicated', async () => {
    const h = await as('ADMIN');
    await api('post', '/settings/exchange-rates')
      .set(h)
      .send({ effectiveDate: '2026-09-30', usdToKhr: '4000' });
    const file = await nbcSheet();

    const preview = await api('post', '/settings/exchange-rates/import')
      .query({ dryRun: 'true' })
      .set(h)
      .attach('file', file, 'Exchange Rate 2026.xlsx');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ dryRun: true, created: 2, updated: 1, unchanged: 0 });
    expect(preview.body.skipped).toEqual([
      expect.objectContaining({ row: 6, message: 'No rate found for 2026-09-02' }),
    ]);
    expect((await api('get', '/settings').set(h)).body.exchangeRates).toHaveLength(1); // nothing saved

    const done = await api('post', '/settings/exchange-rates/import')
      .set(h)
      .attach('file', file, 'Exchange Rate 2026.xlsx');
    expect(done.body).toMatchObject({ dryRun: false, created: 2, updated: 1 });
    const rates = (await api('get', '/settings').set(h)).body.exchangeRates;
    expect(
      rates.map((r: { effectiveDate: string; usdToKhr: string }) => [r.effectiveDate, r.usdToKhr]),
    ).toEqual([
      ['2026-09-30', '4055.0000'],
      ['2026-09-29', '4056.0000'],
      ['2026-09-01', '4047.0000'],
    ]);

    // Importing the same file again changes nothing.
    const again = await api('post', '/settings/exchange-rates/import')
      .set(h)
      .attach('file', file, 'Exchange Rate 2026.xlsx');
    expect(again.body).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
  });

  it('edits a rate; refuses a date that already has one', async () => {
    const h = await as('ADMIN');
    const a = (
      await api('post', '/settings/exchange-rates')
        .set(h)
        .send({ effectiveDate: '2026-10-01', usdToKhr: '4020' })
    ).body;
    await api('post', '/settings/exchange-rates')
      .set(h)
      .send({ effectiveDate: '2026-11-01', usdToKhr: '4027' });

    const edited = await api('patch', `/settings/exchange-rates/${a.id}`)
      .set(h)
      .send({ effectiveDate: '2026-10-02', usdToKhr: '4022.5' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ effectiveDate: '2026-10-02', usdToKhr: '4022.5000' });

    const clash = await api('patch', `/settings/exchange-rates/${a.id}`)
      .set(h)
      .send({ effectiveDate: '2026-11-01' });
    expect(clash.status).toBe(409);
    expect(
      (
        await api('patch', `/settings/exchange-rates/${a.id}`)
          .set(await as('VIEWER'))
          .send({ usdToKhr: '1' })
      ).status,
    ).toBe(403);
  });
});

describe('exchange rates: MEF official-rate sync', () => {
  const mef = (validDate: string, average: number) =>
    new Response(
      JSON.stringify({
        data: {
          id: 11030,
          valid_date: validDate,
          currency_id: 'USD',
          symbol: 'USD/KHR',
          unit: 1,
          bid: average,
          ask: average,
          average,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  afterEach(() => vi.restoreAllMocks());

  it('"Update now" saves the rate under its own date; repeats change nothing', async () => {
    const h = await as('ADMIN');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mef('2026-10-09', 4069))
      .mockResolvedValueOnce(mef('2026-10-09', 4069))
      .mockResolvedValueOnce(mef('2026-10-09', 4070));

    const first = await api('post', '/settings/exchange-rates/sync').set(h);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      ok: true,
      trigger: 'manual',
      effectiveDate: '2026-10-09',
      usdToKhr: '4069',
      result: 'new',
    });
    expect(fetchSpy.mock.calls[0]![0]).toContain('data.mef.gov.kh');
    expect((await api('post', '/settings/exchange-rates/sync').set(h)).body.result).toBe('same');
    expect((await api('post', '/settings/exchange-rates/sync').set(h)).body.result).toBe('changed');

    const s = (await api('get', '/settings').set(h)).body;
    expect(s.exchangeRates).toEqual([
      expect.objectContaining({ effectiveDate: '2026-10-09', usdToKhr: '4070.0000' }),
    ]);
    expect(s.exchangeRateSync).toMatchObject({ ok: true, result: 'changed' });
  });

  it('reports a MEF outage clearly and records it; Viewers cannot trigger it', async () => {
    const h = await as('ADMIN');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('oops', { status: 503 }));
    const res = await api('post', '/settings/exchange-rates/sync').set(h);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(res.body.error.message).toContain('503');
    expect((await api('get', '/settings').set(h)).body.exchangeRateSync).toMatchObject({
      ok: false,
      error: 'MEF API answered 503',
    });
    expect((await api('get', '/settings').set(h)).body.exchangeRates).toEqual([]);

    expect(
      (await api('post', '/settings/exchange-rates/sync').set(await as('VIEWER'))).status,
    ).toBe(403);
  });

  it('refuses an implausible rate', async () => {
    const h = await as('ADMIN');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mef('2026-10-09', 4.069));
    const res = await api('post', '/settings/exchange-rates/sync').set(h);
    expect(res.status).toBe(502);
    expect((await api('get', '/settings').set(h)).body.exchangeRates).toEqual([]);
  });
});

describe('follow-ups', () => {
  it('creates with a reference, flags overdue, completes and filters', async () => {
    const h = await as('OPERATOR');
    const late = (
      await api('post', '/follow-ups').set(h).send({
        subject: 'Customs duty verification',
        clientId: b.jr.id,
        dueAt: '2026-01-05T17:00',
        priority: 'HIGH',
      })
    ).body;
    const soon = (
      await api('post', '/follow-ups').set(h).send({ subject: 'Confirm ATA', dueAt: '2099-01-01' })
    ).body;
    expect(late).toMatchObject({
      reference: 'FLW-0001',
      clientName: 'JR Apparel Corp',
      overdue: true,
      status: 'OPEN',
      dueAt: '2026-01-05T10:00:00.000Z',
    });
    expect(soon).toMatchObject({ reference: 'FLW-0002', overdue: false });
    expect(
      (await api('get', '/follow-ups').query({ overdue: 'true' }).set(h)).body.data.map(
        (f: { reference: string }) => f.reference,
      ),
    ).toEqual(['FLW-0001']);
    expect((await api('get', '/meta/nav-counts').set(h)).body).toMatchObject({
      openFollowUps: 2,
      overdueFollowUps: 1,
    });
    const done = (await api('patch', `/follow-ups/${late.id}`).set(h).send({ status: 'DONE' }))
      .body;
    expect(done).toMatchObject({ status: 'DONE', overdue: false, completedAt: expect.any(String) });
    expect(
      (await api('get', '/follow-ups').query({ status: 'ACTIVE' }).set(h)).body.meta.total,
    ).toBe(1);
    expect(
      (
        await api('post', '/follow-ups')
          .set(await as('VIEWER'))
          .send({ subject: 'x x x', dueAt: '2026-01-01' })
      ).status,
    ).toBe(403);
  });
});

describe('documents', () => {
  it('uploads, lists, downloads and soft-deletes; rejects unsafe files', async () => {
    const h = await as('OPERATOR');
    const pdf = Buffer.from('%PDF-1.4\n% test document\n');
    const up = await api('post', '/documents')
      .set(h)
      .field('title', 'BL — SHP test')
      .field('category', 'BILL_OF_LADING')
      .field('clientId', b.jr.id)
      .attach('file', pdf, { filename: 'bill of lading.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      title: 'BL — SHP test',
      category: 'BILL_OF_LADING',
      clientName: 'JR Apparel Corp',
      sizeBytes: pdf.length,
      uploadedBy: 'Test OPERATOR',
    });
    const bad = await api('post', '/documents').set(h).attach('file', Buffer.from('MZ...'), {
      filename: 'invoice.exe',
      contentType: 'application/octet-stream',
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await api('get', '/documents')
          .query({ category: 'BILL_OF_LADING' })
          .set(await as('VIEWER'))
      ).body.meta.total,
    ).toBe(1);
    const dl = await api('get', `/documents/${up.body.id}/download`)
      .set(await as('VIEWER'))
      .buffer(true)
      .parse((r, cb) => {
        const c: Buffer[] = [];
        r.on('data', (x: Buffer) => c.push(x));
        r.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''bill%20of%20lading.pdf",
    );
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect((dl.body as Buffer).equals(pdf)).toBe(true);
    expect((await api('delete', `/documents/${up.body.id}`).set(await as('VIEWER'))).status).toBe(
      403,
    );
    expect((await api('delete', `/documents/${up.body.id}`).set(h)).status).toBe(204);
    expect((await api('get', `/documents/${up.body.id}/download`).set(h)).status).toBe(404);
  });

  it("keeps a shipment's support documents to 10 MB each", async () => {
    const h = await as('OPERATOR');
    const shipment = await api('post', '/shipments')
      .set(h)
      .send({ clientId: b.jr.id, direction: 'IMPORT', transportMode: 'SEA', loadType: 'LCL' });
    const pdf = (bytes: number) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes)]);
    const attach = (file: Buffer, shipmentId?: string) => {
      const req = api('post', '/documents').set(h);
      if (shipmentId) void req.field('shipmentId', shipmentId);
      return req.attach('file', file, { filename: 'support.pdf', contentType: 'application/pdf' });
    };
    const ok = await attach(pdf(1024), shipment.body.id);
    expect(ok.status).toBe(201);
    expect(ok.body.shipmentReference).toBe(shipment.body.reference);
    const big = pdf(10 * 1024 * 1024);
    expect((await attach(big, shipment.body.id)).status).toBe(400);
    // The library's own limit (20 MB) still applies to files not linked to a shipment.
    expect((await attach(big)).status).toBe(201);
  });
});

describe('quotations', () => {
  const body = (templateKey: string) => ({
    templateKey,
    clientId: null,
    toName: 'Sportline Apparel (Cambodia)',
    attn: 'Ms. Dara',
    quoteDate: '2026-10-06',
    paymentTermDays: 7,
    latePenaltyPctPerDay: '0.5',
    lines: [
      { c0: 'IMPORT PROCESSING FEE', c1: 'USD', c2: '180', c3: '200', c4: '150', c5: '' },
      { c0: 'LOLO AT PORT', c1: 'USD', c2: 'As per receipt', c3: '', c4: '', c5: '' },
    ],
  });

  it('templates come from quotation-system.html; drafts → sent → revise → v2, v1 superseded', async () => {
    const h = await as('ACCOUNTANT');
    const { db } = await import('../db/client');
    const { quotationTemplates } = await import('../db/schema');
    await db.insert(quotationTemplates).values({
      key: 'import_sih',
      label: 'Import SIH port & dry port',
      docTitle: 'QUOTATION — IMPORT',
      sortOrder: 0,
      notes: null,
      defaultRows: [],
      columns: [
        { key: 'c0', label: 'Description', type: 'wide' },
        { key: 'c1', label: 'Cur', type: 'text' },
        { key: 'c2', label: "20'GP", type: 'num' },
        { key: 'c3', label: "40'H", type: 'num' },
        { key: 'c4', label: 'LCL', type: 'num' },
        { key: 'c5', label: 'Remark', type: 'remark' },
      ],
    });
    expect((await api('get', '/quotations/templates').set(h)).body[0].columns).toHaveLength(6);
    const q = (await api('post', '/quotations').set(h).send(body('import_sih'))).body;
    expect(q).toMatchObject({
      quoteNo: 'Q26-001',
      version: 1,
      status: 'DRAFT',
      docTitle: 'QUOTATION — IMPORT',
    });
    expect(q.lines[1].c2).toBe('As per receipt');
    expect((await api('post', `/quotations/${q.id}/revise`).set(h)).status).toBe(409); // drafts are edited, not revised
    await api('post', `/quotations/${q.id}/status`).set(h).send({ status: 'SENT' });
    expect((await api('put', `/quotations/${q.id}`).set(h).send(body('import_sih'))).status).toBe(
      409,
    );
    const v2 = (await api('post', `/quotations/${q.id}/revise`).set(h)).body;
    expect(v2).toMatchObject({ quoteNo: 'Q26-001', version: 2, status: 'DRAFT' });
    expect(
      v2.versions.map((v: { version: number; status: string }) => [v.version, v.status]),
    ).toEqual([
      [2, 'DRAFT'],
      [1, 'SUPERSEDED'],
    ]);
    const latest = (await api('get', '/quotations').query({ latestOnly: 'true' }).set(h)).body.data;
    expect(latest.map((r: { version: number }) => r.version)).toEqual([2]);
    expect(
      (
        await api('post', '/quotations')
          .set(await as('OPERATOR'))
          .send(body('import_sih'))
      ).status,
    ).toBe(403);
    expect((await api('post', '/quotations').set(h).send(body('nope'))).status).toBe(422);
  });
});

describe('operations', () => {
  it('declaration register with ledger status', async () => {
    const h = await as('ADMIN');
    await api('post', '/shipments')
      .set(h)
      .send({
        clientId: b.jr.id,
        direction: 'IMPORT',
        transportMode: 'SEA',
        loadType: 'LCL',
        eta: '2026-09-01',
        clearancePortId: b.port.id,
        declarations: [{ declareNo: 'I 1001', declareDate: '2026-09-02', portId: b.port.id }],
      });
    const res = await api('get', '/operations/declarations')
      .query({ ledger: 'without' })
      .set(await as('OPERATOR'));
    expect(res.body.data[0]).toMatchObject({
      declareNo: 'I 1001',
      portCode: 'SHV11',
      clientCode: 'JR',
      ledgerId: null,
      documents: 0,
      cdcLines: 0,
    });
    expect(
      (await api('get', '/operations/declarations').query({ ledger: 'with' }).set(h)).body.meta
        .total,
    ).toBe(0);
  });
});

describe('fuel & metal prices', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fuel = (...items: [string, string, number, number][]) =>
    json({
      items: items.map(([start, end, g, o]) => ({
        start_date: start,
        end_date: end,
        gasoline_92_unit_price: g,
        gasoline_92_unit_price_change: 0,
        gasoil_50ppm_unit_price: o,
        gasoil_50ppm_unit_price_change: 0,
        source_link: 'https://www.moc.gov.kh/kh/news/4621',
      })),
      total_items: items.length,
    });
  const metal = (price: number, updatedAt = '2026-10-12T05:17:39Z') =>
    json({ name: 'Gold', price, symbol: 'XAU', updatedAt });
  afterEach(() => vi.restoreAllMocks());

  it('syncs fuel periods from MEF by start date; repeats change nothing', async () => {
    const h = await as('ADMIN');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        fuel(['2026-10-01', '2026-10-11', 5150, 5650], ['2026-09-21', '2026-10-01', 5250, 6100]),
      )
      .mockResolvedValueOnce(fuel(['2026-10-01', '2026-10-11', 5150, 5650]))
      .mockResolvedValueOnce(fuel(['2026-10-01', '2026-10-11', 5100, 5650]));

    const first = await api('post', '/settings/fuel-prices/sync').set(h);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, trigger: 'manual', added: 2, updated: 0 });
    expect(fetchSpy.mock.calls[0]![0]).toContain('pd_681d89b4dbc953000126f5e7');
    expect((await api('post', '/settings/fuel-prices/sync').set(h)).body).toMatchObject({
      added: 0,
      updated: 0,
    });
    expect((await api('post', '/settings/fuel-prices/sync').set(h)).body.updated).toBe(1);

    const m = (await api('get', '/settings/market-prices').set(h)).body;
    expect(m.fuel).toEqual([
      expect.objectContaining({
        startDate: '2026-10-01',
        endDate: '2026-10-11',
        gasoline92: '5100',
        gasoil: '5650',
        source: 'MEF',
      }),
      expect.objectContaining({ startDate: '2026-09-21', gasoline92: '5250' }),
    ]);
    expect(m.fuelSync).toMatchObject({ ok: true, updated: 1 });
  });

  it('adds and deletes a fuel period by hand; Viewers can read but not change', async () => {
    const h = await as('ADMIN');
    const add = await api('post', '/settings/fuel-prices')
      .set(h)
      .send({ startDate: '2026-10-11', endDate: '', gasoline92: '5,050', gasoil: 5600 });
    expect(add.status).toBe(201);
    expect(
      (
        await api('post', '/settings/fuel-prices')
          .set(h)
          .send({ startDate: '2026-10-11', endDate: '2026-10-01', gasoline92: 1, gasoil: 1 })
      ).status,
    ).toBe(400);

    const v = await as('VIEWER');
    const m = (await api('get', '/settings/market-prices').set(v)).body;
    expect(m.fuel).toEqual([
      expect.objectContaining({ gasoline92: '5050', gasoil: '5600', source: 'manual' }),
    ]);
    expect((await api('delete', `/settings/fuel-prices/${add.body.id}`).set(v)).status).toBe(403);
    expect((await api('delete', `/settings/fuel-prices/${add.body.id}`).set(h)).status).toBe(204);
    expect((await api('get', '/settings/market-prices').set(h)).body.fuel).toEqual([]);
  });

  it('stores one price per metal per day and compares with the day before', async () => {
    const h = await as('ADMIN');
    vi.spyOn(globalThis, 'fetch')
      // Day 1: gold, silver, platinum.
      .mockResolvedValueOnce(metal(4100, '2026-10-11T05:00:00Z'))
      .mockResolvedValueOnce(metal(60, '2026-10-11T05:00:00Z'))
      .mockResolvedValueOnce(metal(1700, '2026-10-11T05:00:00Z'))
      // Day 2.
      .mockResolvedValueOnce(metal(4189))
      .mockResolvedValueOnce(metal(60.994))
      .mockResolvedValueOnce(metal(1701));
    expect((await api('post', '/settings/metal-prices/sync').set(h)).body.added).toBe(3);
    expect((await api('post', '/settings/metal-prices/sync').set(h)).body.added).toBe(3);

    const m = (await api('get', '/settings/market-prices').set(h)).body;
    expect(m.metals.map((x: { symbol: string }) => x.symbol)).toEqual(['XAU', 'XAG', 'XPT']);
    expect(m.metals[0]).toMatchObject({
      latest: { usdPerOz: '4189.0000', priceDate: '2026-10-12' },
      previous: { usdPerOz: '4100.0000', priceDate: '2026-10-11' },
    });
  });

  it('reports an outage or a broken price without saving anything', async () => {
    const h = await as('ADMIN');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(fuel(['2026-10-01', '2026-10-11', 5.15, 5.65]));
    const down = await api('post', '/settings/fuel-prices/sync').set(h);
    expect(down.status).toBe(502);
    expect(down.body.error.message).toContain('503');
    expect((await api('post', '/settings/fuel-prices/sync').set(h)).status).toBe(502);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(metal(-1));
    expect((await api('post', '/settings/metal-prices/sync').set(h)).status).toBe(502);

    const m = (await api('get', '/settings/market-prices').set(h)).body;
    expect(m.fuel).toEqual([]);
    expect(m.metals[0].latest).toBeNull();
    expect(m.fuelSync).toMatchObject({ ok: false });
    expect((await api('post', '/settings/metal-prices/sync').set(await as('VIEWER'))).status).toBe(
      403,
    );
  });
});
