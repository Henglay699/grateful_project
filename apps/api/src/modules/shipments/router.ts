import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  CLEARANCE_STATUS_LABEL,
  SHIPMENT_STATUS_LABEL,
  freightMethodLabel,
  shipmentInputSchema,
  shipmentListQuerySchema,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { attachmentName, excelUpload, requireFile } from '../../lib/http';
import * as svc from './service';
import { buildCargoTemplate, parseCargoWorkbook } from './excel';
import { buildImportCargoTemplate, parseImportCargoWorkbook } from './importCargoExcel';
import { buildPlanTemplate, importPlan } from './planImport';
import { buildInvoicePackingList } from './invoicePackingList';
import { buildImportInvoicePackingList } from './importInvoicePackingList';
import {
  allowedClients,
  assertClientAllowed,
  assertClientVisible,
  scopeClients,
} from '../../lib/clientScope';

const idParam = z.object({ id: z.string().uuid('Invalid shipment id') });
export const shipmentsRouter = Router();
shipmentsRouter.use(requireAuth);

shipmentsRouter.get('/', requirePermission('shipments:read'), async (req, res) => {
  const q = parse(shipmentListQuerySchema, req.query);
  res.json(await svc.listShipments({ ...q, clientId: scopeClients(req, q.clientId, 'shipments') }));
});

/** Same filters as the list, as an .xlsx with every "Expand All" column. */
shipmentsRouter.get('/export.xlsx', requirePermission('shipments:read'), async (req, res) => {
  const { page: _p, pageSize: _s, ...filters } = parse(shipmentListQuerySchema, req.query);
  const rows = await svc.listShipmentsForExport({
    ...filters,
    clientId: scopeClients(req, filters.clientId, 'shipments'),
  });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grateful Solutions Logistics Command Center';
  const ws = wb.addWorksheet('Shipping Plans', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }],
  });
  const allCols: [string, number, (r: (typeof rows)[number]) => string | number | null][] = [
    ['Reference', 14, (r) => r.reference],
    ['Invoice No.', 22, (r) => r.invoiceNos.join(', ')],
    ['Client', 8, (r) => r.clientCode],
    ['Transport', 9, (r) => r.direction],
    ['Quantity', 10, (r) => (r.quantity ? Number(r.quantity) : null)],
    ['Unit', 8, (r) => r.quantityUnit],
    ['ETA Port', 12, (r) => r.eta],
    ['Forwarder', 20, (r) => r.forwarderName],
    ['Clearance Port', 22, (r) => r.clearancePortName],
    ['HBL No', 16, (r) => r.hblNo],
    [
      'Ctnr No',
      26,
      (r) => r.containers.map((c) => `${c.containerNo}${c.size ? ` / ${c.size}` : ''}`).join(', '),
    ],
    ['Freight Method', 14, (r) => freightMethodLabel(r.transportMode, r.loadType)],
    ['Arrive FTY', 12, (r) => r.arriveFty],
    ['Status', 12, (r) => SHIPMENT_STATUS_LABEL[r.status]],
    ['Consignee', 24, (r) => r.consigneeName],
    ['Invoice Date', 12, (r) => r.invoiceDate],
    ['Country', 14, (r) => r.countryName],
    ['Booking / SO No.', 14, (r) => r.bookingNo],
    [
      'Liner Seal',
      12,
      (r) =>
        r.containers
          .map((c) => c.linerSeal)
          .filter(Boolean)
          .join(', '),
    ],
    [
      'Customs Seal',
      12,
      (r) =>
        r.containers
          .map((c) => c.customsSeal)
          .filter(Boolean)
          .join(', '),
    ],
    ['CRD', 12, (r) => r.crd],
    ['INVOICE / THC No.', 16, (r) => r.thcHblNo],
    ['Invoice / THC Date', 14, (r) => r.thcHblDate],
    ['Invoice / THC Amount', 14, (r) => (r.thcHblAmount ? Number(r.thcHblAmount) : null)],
    ['Clearance Status', 16, (r) => CLEARANCE_STATUS_LABEL[r.clearanceStatus]],
    ['Vessel Name', 18, (r) => r.vesselName],
    ['Voyage No.', 10, (r) => r.voyageNo],
    ['CO Form', 10, (r) => r.coForm],
    ['CO Number', 14, (r) => r.coNumber],
    ['CO Status', 10, (r) => r.coStatus],
    ['Net Weight (kg)', 14, (r) => Number(r.totals.netWeightKg)],
    ['Gross Weight (kg)', 14, (r) => Number(r.totals.grossWeightKg)],
    ['CBM', 10, (r) => Number(r.totals.cbm)],
    ['PCS', 10, (r) => Number(r.totals.pcs)],
    ['CTNS', 10, (r) => Number(r.totals.ctns)],
    ['Total FOB (USD)', 14, (r) => Number(r.totals.fob)],
    ['Declare No.', 18, (r) => r.declarations.map((d) => d.declareNo).join(', ')],
    ['Declare Date', 12, (r) => r.declarations[0]?.declareDate ?? null],
    ['ETD Port', 18, (r) => r.etdPort],
    ['ETD', 12, (r) => r.etd],
    ['ATD', 12, (r) => r.atd],
    ['Remark', 30, (r) => r.remark],
  ];
  // ETA at the port is an import detail: an Export download leaves it out.
  const cols = filters.direction === 'EXPORT' ? allCols.filter(([h]) => h !== 'ETA Port') : allCols;
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(cols.map(([, , get]) => get(r)));
  ['Total FOB (USD)', 'Invoice / THC Amount'].forEach(
    (h) => (ws.getColumn(cols.findIndex((c) => c[0] === h) + 1).numFmt = '#,##0.00'),
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    attachmentName(`shipping-plans-${new Date().toISOString().slice(0, 10)}.xlsx`),
  );
  await wb.xlsx.write(res);
  res.end();
});

/** Shipping Plan → Import Excel: the blank template, dropdowns filled from the current lists. */
shipmentsRouter.get(
  '/import-template.xlsx',
  requirePermission('shipments:write'),
  async (_req, res) => {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', attachmentName('Shipping Plan Import Template.xlsx'));
    res.send(await buildPlanTemplate());
  },
);

/**
 * Shipping Plan → Import Excel. Without ?save=1 the file is only checked: what would be created
 * and every problem by sheet and row. With ?save=1 it is saved in one go when nothing is wrong.
 */
shipmentsRouter.post(
  '/import',
  requirePermission('shipments:write'),
  excelUpload,
  async (req, res) => {
    const file = requireFile(req.file);
    const result = await importPlan(file.buffer, {
      save: req.query.save === '1',
      actor: { userId: req.auth!.userId, permissions: req.auth!.permissions },
      req,
      allowedClientIds: allowedClients(req, 'shipments') ?? undefined,
    });
    // Always 200: problems are part of the result ("saved" says whether it was saved).
    res.json(result);
  },
);

/** Reads an Export Template workbook and returns invoices for the wizard's Cargo section (nothing is saved). */
shipmentsRouter.post(
  '/parse-cargo-excel',
  requirePermission('shipments:write'),
  excelUpload,
  async (req, res) => {
    const file = requireFile(req.file);
    const result = await parseCargoWorkbook(file.buffer, file.originalname);
    const exceptId =
      typeof req.query.shipmentId === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.shipmentId)
        ? req.query.shipmentId
        : undefined;
    const used = await svc.existingInvoiceNumbers(
      result.invoices.map((i) => i.invoiceNo),
      exceptId,
    );
    for (const [no, ref] of used)
      result.warnings.push({
        row: null,
        message: `Invoice ${no} is already on shipment ${ref}; saving will be refused unless you change it.`,
      });
    res.json(result);
  },
);

const clientQuery = z.object({
  clientId: z.string().uuid('Choose a client first'),
  shipmentId: z.string().uuid().optional(),
});

/** The blank Export Template for the wizard's Cargo section. */
shipmentsRouter.get(
  '/cargo-template.xlsx',
  requirePermission('shipments:write'),
  async (_req, res) => {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', attachmentName('Export Invoice Template.xlsx'));
    res.send(await buildCargoTemplate());
  },
);

/** The import invoice template, with the client's CDC master list to pick from. */
shipmentsRouter.get(
  '/import-cargo-template.xlsx',
  requirePermission('shipments:write'),
  async (req, res) => {
    const { clientId } = parse(clientQuery, req.query);
    assertClientVisible(req, clientId, 'Client', 'shipments');
    const { buffer, fileName } = await buildImportCargoTemplate(clientId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', attachmentName(fileName));
    res.send(buffer);
  },
);

/** Reads an import invoice workbook into invoices for the wizard (nothing is saved). */
shipmentsRouter.post(
  '/parse-import-cargo-excel',
  requirePermission('shipments:write'),
  excelUpload,
  async (req, res) => {
    const file = requireFile(req.file);
    const { clientId, shipmentId } = parse(clientQuery, req.query);
    assertClientVisible(req, clientId, 'Client', 'shipments');
    const result = await parseImportCargoWorkbook(file.buffer, file.originalname, clientId);
    const used = await svc.existingInvoiceNumbers(
      result.invoices.map((i) => i.invoiceNo),
      shipmentId,
    );
    for (const [no, ref] of used)
      result.warnings.push({
        row: null,
        message: `Invoice ${no} is already on shipment ${ref}; saving will be refused unless you change it.`,
      });
    res.json(result);
  },
);

/**
 * Invoice + packing list workbook in JR's layouts: the export INV+PL (one sheet per cargo
 * invoice), or for an import the INVOICE sheets plus the customs cover and transfer letters.
 */
shipmentsRouter.get(
  '/:id/invoice-packing-list.xlsx',
  requirePermission('shipments:read'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    const detail = await svc.getShipment(id);
    assertClientVisible(req, detail.clientId, 'Shipment', 'shipments');
    const { buffer, fileName } =
      detail.direction === 'IMPORT'
        ? await buildImportInvoicePackingList(id)
        : await buildInvoicePackingList(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', attachmentName(fileName));
    res.send(buffer);
  },
);

shipmentsRouter.get('/:id', requirePermission('shipments:read'), async (req, res) => {
  const detail = await svc.getShipment(parse(idParam, req.params).id);
  assertClientVisible(req, detail.clientId, 'Shipment', 'shipments');
  res.json(detail);
});

shipmentsRouter.post('/', requirePermission('shipments:write'), async (req, res) => {
  const input = parse(shipmentInputSchema, req.body);
  assertClientAllowed(req, input.clientId, 'shipments');
  const id = await svc.createShipment(
    input,
    { userId: req.auth!.userId, permissions: req.auth!.permissions },
    req,
  );
  res.status(201).json(await svc.getShipment(id));
});

shipmentsRouter.put('/:id', requirePermission('shipments:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const input = parse(shipmentInputSchema, req.body);
  assertClientVisible(req, await svc.shipmentClientId(id), 'Shipment', 'shipments');
  assertClientAllowed(req, input.clientId, 'shipments');
  await svc.updateShipment(
    id,
    input,
    { userId: req.auth!.userId, permissions: req.auth!.permissions },
    req,
  );
  res.json(await svc.getShipment(id));
});

shipmentsRouter.delete('/:id', requirePermission('shipments:delete'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, await svc.shipmentClientId(id), 'Shipment', 'shipments');
  await svc.deleteShipment(id, req);
  res.status(204).end();
});
