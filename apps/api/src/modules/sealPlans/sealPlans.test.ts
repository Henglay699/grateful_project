import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode, SealPlanRow } from '@gs/shared';
import { createApp } from '../../app';
import { pool } from '../../db/client';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

const app = createApp();
let basics: Awaited<ReturnType<typeof seedBasics>>;
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

function exportShipment(overrides: Record<string, unknown> = {}) {
  return {
    clientId: basics.jr.id,
    direction: 'EXPORT',
    transportMode: 'SEA',
    loadType: 'FCL',
    status: 'IN_PROGRESS',
    clearancePortId: basics.port.id,
    destinationCountryIso2: 'US',
    bookingNo: '6464270110',
    vesselName: 'GLS 07 492E',
    etd: '2026-09-13',
    containers: [{ containerNo: 'CSNU9538620', size: '45HQ', linerSeal: '34051148' }],
    ...overrides,
  };
}

const list = async (query: Record<string, string | number>) =>
  (
    await request(app)
      .get('/api/v1/seal-plans')
      .query(query)
      .set(await as('VIEWER'))
  ).body as SealPlanRow[];

beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
});
afterAll(async () => {
  await pool.end();
});

describe('seal plans', () => {
  it('lists export containers, saves a plan and keeps it when the shipment is saved again', async () => {
    const created = await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send(exportShipment());
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send(
        exportShipment({
          direction: 'IMPORT',
          originCountryIso2: 'CN',
          destinationCountryIso2: null,
          containers: [{ containerNo: 'TEMU8045497', size: '40HQ' }],
        }),
      );

    // Without a loading date the row sits in its ETD's month; imports are left out.
    const before = await list({ year: 2026, month: 9 });
    expect(before.map((r) => r.containerNo)).toEqual(['CSNU9538620']);
    expect(before[0]).toMatchObject({ month: '2026-09', bookingNo: '6464270110', truckNo: null });

    const put = await request(app)
      .put(`/api/v1/seal-plans/${id}/CSNU9538620`)
      .set(await as('OPERATOR'))
      .send({
        linerSeal: '34051148',
        customsSeal: '477278',
        carrier: 'COSCO',
        destination: 'UNITED STATES',
        tareWeightKg: '4,700',
        truckBy: 'CHEA',
        driverPhone: '0888978821',
        truckNo: '4A-8276',
        deliverTo: 'JR',
        loadingDate: '2026-08-30',
        depot: 'RETOP CONTAINER SERVICE',
      });
    expect(put.status).toBe(204);

    // The loading date moves it to August; the customs seal is now on the shipment too.
    expect(await list({ year: 2026, month: 9 })).toEqual([]);
    const [row] = await list({ year: 2026, month: 8 });
    expect(row).toMatchObject({ carrier: 'COSCO', tareWeightKg: '4700.000', truckNo: '4A-8276' });
    const ship = await request(app)
      .get(`/api/v1/shipments/${id}`)
      .set(await as('VIEWER'));
    expect(ship.body.containers[0].customsSeal).toBe('477278');

    // Saving the shipment replaces its container rows; the plan stays with the container no.
    const resaved = await request(app)
      .put(`/api/v1/shipments/${id}`)
      .set(await as('OPERATOR'))
      .send(exportShipment({ vesselName: 'GLS 07 493E' }));
    expect(resaved.status).toBe(200);
    expect(await list({ year: 2026, q: '4A-8276' })).toMatchObject([
      { containerNo: 'CSNU9538620', vesselName: 'GLS 07 493E', truckBy: 'CHEA' },
    ]);
  });

  it('offers export CY/CY shipments and adds a new container to the picked one', async () => {
    const created = await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send(exportShipment());
    const id = created.body.id as string;
    await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send(exportShipment({ loadType: 'LCL', containers: [], bookingNo: 'LCL-1' }));

    const options = await request(app)
      .get('/api/v1/seal-plans/shipments')
      .set(await as('VIEWER'));
    expect(options.body).toMatchObject([
      { id, containerNo: 'CSNU9538620', containerCount: 1, plannedCount: 0 },
    ]);

    const put = await request(app)
      .put(`/api/v1/seal-plans/${id}/csnu 632719-8`)
      .set(await as('OPERATOR'))
      .send({ size: '40HQ', linerSeal: '34046432', truckNo: '4B-4988' });
    expect(put.status).toBe(204);
    const picked = await request(app)
      .get(`/api/v1/seal-plans/shipments/${id}`)
      .set(await as('VIEWER'));
    expect(picked.body.rows).toMatchObject([
      { containerNo: 'CSNU9538620', id: null },
      { containerNo: 'CSNU6327198', size: '40HQ', linerSeal: '34046432', truckNo: '4B-4988' },
    ]);
    const ship = await request(app)
      .get(`/api/v1/shipments/${id}`)
      .set(await as('VIEWER'));
    expect(ship.body.containers).toHaveLength(2);
  });

  it('keeps a plan started blank, without a shipment', async () => {
    const body = {
      clientId: basics.jr.id,
      containerNo: 'trlu 689725-9',
      size: '40HQ',
      bookingNo: '271982555',
      portId: basics.port.id,
      vesselName: 'PHUOC LONG 32(VN)',
      etd: '2026-07-08',
      linerSeal: 'ML-KH0234717',
      customsSeal: '342741',
      carrier: 'MAERSK',
      loadingDate: '2026-07-03',
    };
    const created = await request(app)
      .post('/api/v1/seal-plans')
      .set(await as('OPERATOR'))
      .send(body);
    expect(created.status).toBe(201);
    const planId = created.body.id as string;
    expect(await list({ year: 2026, month: 7 })).toMatchObject([
      {
        id: planId,
        shipmentId: null,
        containerNo: 'TRLU6897259',
        bookingNo: '271982555',
        linerSeal: 'ML-KH0234717',
        clientCode: basics.jr.code,
      },
    ]);

    const upd = await request(app)
      .put(`/api/v1/seal-plans/${planId}`)
      .set(await as('OPERATOR'))
      .send({ ...body, loadingDate: '2026-08-01' });
    expect(upd.status).toBe(204);
    expect(await list({ year: 2026, month: 8 })).toHaveLength(1);

    const del = await request(app)
      .delete(`/api/v1/seal-plans/${planId}`)
      .set(await as('OPERATOR'));
    expect(del.status).toBe(204);
    expect(await list({ year: 2026 })).toEqual([]);
  });

  it('needs sealplans:write to save and a live export shipment', async () => {
    const created = await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send(exportShipment());
    const id = created.body.id as string;
    const viewer = await request(app)
      .put(`/api/v1/seal-plans/${id}/CSNU9538620`)
      .set(await as('VIEWER'))
      .send({ truckNo: '4A-8276' });
    expect(viewer.status).toBe(403);
    const missing = await request(app)
      .put(`/api/v1/seal-plans/${crypto.randomUUID()}/MSCU5281680`)
      .set(await as('OPERATOR'))
      .send({ truckNo: '4A-8276' });
    expect(missing.status).toBe(404);
  });

  it('exports the filtered list as the SEAL PLAN workbook', async () => {
    const created = await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send(exportShipment());
    await request(app)
      .put(`/api/v1/seal-plans/${created.body.id as string}/CSNU9538620`)
      .set(await as('OPERATOR'))
      .send({ linerSeal: '34051148', tareWeightKg: 4700, loadingDate: '2026-09-09' });

    const res = await request(app)
      .get('/api/v1/seal-plans/export.xlsx')
      .query({ year: 2026 })
      .set(await as('VIEWER'))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    const ws = wb.getWorksheet('SEAL PLAN')!;
    expect(ws.getCell('A2').value).toBe('September 2026');
    expect(['C3', 'H3', 'I3', 'J3', 'K3'].map((a) => ws.getCell(a).value)).toEqual([
      'CLIENT',
      'CONTAINER NO.',
      'SIZE',
      'CARRIER SEAL',
      'CUSTOMS SEAL',
    ]);
    expect(ws.getCell('A4').value).toBe('SEPTEMBER 2026');
    const row = ws.getRow(5);
    expect(row.getCell(8).value).toBe('CSNU9538620');
    expect(row.getCell(6).value).toBe('Sihanoukville'); // "Port" dropped
    expect(row.getCell(13).value).toBe(4700);
    expect(row.getCell(13).numFmt).toBe('#,##0" KGS"');
  });

  it("deletes a shipment container's plan but keeps the container and its seals", async () => {
    const created = await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send(exportShipment());
    const id = created.body.id as string;
    await request(app)
      .put(`/api/v1/seal-plans/${id}/CSNU9538620`)
      .set(await as('OPERATOR'))
      .send({ linerSeal: '34051148', customsSeal: '477278', truckNo: '4A-8276' });
    const [planned] = await list({ year: 2026 });
    expect(planned!.id).toBeTruthy();

    const viewer = await request(app)
      .delete(`/api/v1/seal-plans/${planned!.id}`)
      .set(await as('VIEWER'));
    expect(viewer.status).toBe(403);
    const del = await request(app)
      .delete(`/api/v1/seal-plans/${planned!.id}`)
      .set(await as('OPERATOR'));
    expect(del.status).toBe(204);

    expect(await list({ year: 2026 })).toMatchObject([
      {
        id: null,
        containerNo: 'CSNU9538620',
        linerSeal: '34051148',
        customsSeal: '477278',
        truckNo: null,
      },
    ]);
  });

  it('renames a shipment container from its seal plan', async () => {
    const created = await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send(
        exportShipment({
          containers: [
            { containerNo: 'CSNU9538620', size: '45HQ' },
            { containerNo: 'CSNU6351548', size: '40HQ' },
          ],
        }),
      );
    const id = created.body.id as string;
    await request(app)
      .put(`/api/v1/seal-plans/${id}/CSNU9538620`)
      .set(await as('OPERATOR'))
      .send({ truckNo: '4A-8276' });

    const taken = await request(app)
      .put(`/api/v1/seal-plans/${id}/CSNU9538620`)
      .set(await as('OPERATOR'))
      .send({ containerNo: 'CSNU6351548', truckNo: '4A-8276' });
    expect(taken.status).toBe(409);

    const renamed = await request(app)
      .put(`/api/v1/seal-plans/${id}/CSNU9538620`)
      .set(await as('OPERATOR'))
      .send({ containerNo: 'csnu 953862-1', size: '45HQ', truckNo: '4A-8276' });
    expect(renamed.status).toBe(204);
    const ship = await request(app)
      .get(`/api/v1/shipments/${id}`)
      .set(await as('VIEWER'));
    expect(ship.body.containers.map((c: { containerNo: string }) => c.containerNo)).toEqual([
      'CSNU9538621',
      'CSNU6351548',
    ]);
    expect(await list({ year: 2026, q: '4A-8276' })).toMatchObject([
      { containerNo: 'CSNU9538621', truckNo: '4A-8276' },
    ]);
  });
});
