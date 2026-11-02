import { Router, type RequestHandler } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  BILLING_DOC_LABEL,
  BILLING_DOC_SCHEMAS,
  BILLING_DOC_TYPES,
  billingDocListQuerySchema,
  billingDraftsInputSchema,
  billingIssueInputSchema,
  billingMonthQuerySchema,
  clearFeePaymentInputSchema,
  clearFeePaymentsQuerySchema,
  clearFeePaymentUpdateSchema,
  receiptInputSchema,
  receiptListQuerySchema,
  creditNoteListQuerySchema,
  creditNoteReviewInputSchema,
  creditNoteReviewQuerySchema,
  ledgerInputSchema,
  ledgerListQuerySchema,
  ledgerUpdateSchema,
  vatLabel,
  type BillingDocType,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { badRequest, notFound } from '../../lib/errors';
import { attachmentName } from '../../lib/http';
import * as ledger from './ledger';
import * as docs from './docs';
import * as billing from './billing';
import * as clearFee from './clearFeePayments';
import { clientPrefill, creditNotePrefill, prefill } from './prefill';
import {
  allowedClients,
  assertClientAllowed,
  assertClientVisible,
  scopeClients,
} from '../../lib/clientScope';

const idParam = z.object({ id: z.string().uuid('Invalid id') });
const clientParam = z.object({ clientId: z.string().uuid('Invalid client') });
const receiptParam = z.object({ receiptId: z.string().uuid('Invalid receipt') });
const paymentParam = z.object({ paymentId: z.string().uuid('Invalid payment') });
const typeParam = z.object({
  type: z.enum(BILLING_DOC_TYPES, { message: 'Unknown document type' }),
});

export const accountingRouter = Router();
accountingRouter.use(requireAuth);

/**
 * Credit Noted (the customs broker's vouchers) and Record Summary (worked on by Operations)
 * have their own permissions, so those users don't see the rest of accounting; everything
 * else needs accounting access.
 */
const isCreditNotes = (path: string) =>
  path.startsWith('/docs/credit-notes') || path.startsWith('/credit-notes/');
const isRecordSummaries = (path: string) =>
  path.startsWith('/docs/record-summaries') ||
  path === '/eligible/record-summaries' ||
  path.startsWith('/record-summaries/inbox');
accountingRouter.use((req, res, next) =>
  requirePermission(
    isCreditNotes(req.path)
      ? 'creditnotes:read'
      : isRecordSummaries(req.path)
        ? 'recordsummaries:read'
        : 'accounting:read',
  )(req, res, next),
);
/**
 * Writing a document: credit notes need creditnotes:write, record summaries
 * recordsummaries:write, the others accounting:write.
 */
const docWrite: RequestHandler = (req, res, next) =>
  requirePermission(
    req.params.type === 'credit-notes'
      ? 'creditnotes:write'
      : req.params.type === 'record-summaries'
        ? 'recordsummaries:write'
        : 'accounting:write',
  )(req, res, next);

// Every /:id route (ledger entries and billing documents): a record of a client this user
// can't see looks like it doesn't exist.
accountingRouter.param('id', async (req, _res, next, id: string) => {
  try {
    if (allowedClients(req) && z.string().uuid().safeParse(id).success) {
      const type = req.params.type as BillingDocType | undefined;
      const clientId =
        type && BILLING_DOC_TYPES.includes(type)
          ? (await docs.getDoc(type, id)).clientId
          : (await ledger.getLedger(id)).clientId;
      assertClientVisible(req, clientId, type ? 'Document' : 'Ledger entry');
    }
    next();
  } catch (err) {
    next(err);
  }
});

/* ---------- Monthly ledger ---------- */
accountingRouter.get('/ledger', async (req, res) =>
  res.json(
    await ledger.listLedger({
      ...parse(ledgerListQuerySchema, req.query),
      clientIds: scopeClients(req),
    }),
  ),
);
accountingRouter.get('/declarations', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), req.query);
  res.json(await ledger.declarationOptions(q, scopeClients(req)));
});

/** Shipments ready for a document of a type: the editor's Declare No. picker. */
accountingRouter.get('/eligible/:type', async (req, res) => {
  const { type } = parse(
    z.object({
      type: z.enum(['tax-invoices', 'disbursements', 'debit-notes', 'record-summaries'], {
        message: 'Unknown document type',
      }),
    }),
    req.params,
  );
  res.json(
    type === 'record-summaries'
      ? await ledger.recordSummaryShipments(scopeClients(req))
      : await ledger.eligibleRecords(type, scopeClients(req)),
  );
});

accountingRouter.get('/ledger/export.xlsx', async (req, res) => {
  const q = parse(ledgerListQuerySchema, { ...req.query, page: 1 });
  const period = q.month ?? q.year ?? 'all';
  // Every matching row (a full year can exceed one page), not just the first page.
  const { data, totals } = await ledger.listLedger({
    ...q,
    clientIds: scopeClients(req),
    pageSize: 100_000,
  });
  // "VAT 10%" when every row has the same percent; just "VAT" across a rate change.
  const vatRates = new Set(data.map((r) => Number(r.vatRate)));
  const vatHeader = vatRates.size === 1 ? vatLabel([...vatRates][0]) : 'VAT';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Ledger ${period}`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const cols: [string, number, (r: (typeof data)[number]) => string | number | null][] = [
    ['Inv Date', 12, (r) => r.invDate],
    ['Client', 8, (r) => r.clientCode],
    ['Declare No', 14, (r) => r.declareNo],
    ['Port', 8, (r) => r.portCode],
    ['INV No', 12, (r) => r.invNo],
    ['DIS No', 10, (r) => r.disNo],
    ['DN No', 13, (r) => r.dnNo],
    ['Clear Fee', 11, (r) => Number(r.clearFee)],
    ['THC', 10, (r) => Number(r.thc)],
    ['Other Pay', 10, (r) => Number(r.otherPay)],
    ['CM', 8, (r) => Number(r.commission)],
    ['INV (Revenue)', 13, (r) => Number(r.invRevenue)],
    ['DIS', 10, (r) => Number(r.disTotal)],
    [vatHeader, 10, (r) => Number(r.vat)],
    ['DN Total', 11, (r) => Number(r.dnTotal)],
    ['Net Profit', 12, (r) => Number(r.netProfit)],
    ['Chea', 9, (r) => (r.cheaStatus === 'NA' ? 'N/A' : r.cheaStatus)],
    ['Mark', 18, (r) => r.mark],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };
  data.forEach((r) => ws.addRow(cols.map(([, , f]) => f(r))));
  const t = ws.addRow([
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    '',
    Number(totals.clearFee),
    Number(totals.thc),
    Number(totals.otherPay),
    Number(totals.commission),
    Number(totals.invRevenue),
    Number(totals.disTotal),
    Number(totals.vat),
    Number(totals.dnTotal),
    Number(totals.netProfit),
  ]);
  t.font = { bold: true };
  for (let i = 8; i <= 16; i++) ws.getColumn(i).numFmt = '#,##0.00';
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    attachmentName(`${q.month ? 'monthly' : q.year ? 'yearly' : 'full'}-ledger-${period}.xlsx`),
  );
  await wb.xlsx.write(res);
  res.end();
});

accountingRouter.get('/ledger/:id', async (req, res) =>
  res.json(await ledger.getLedger(parse(idParam, req.params).id)),
);
accountingRouter.post('/ledger', requirePermission('accounting:write'), async (req, res) => {
  const input = parse(ledgerInputSchema, req.body);
  if (allowedClients(req))
    assertClientAllowed(req, await ledger.declarationClientId(input.declarationId));
  const id = await ledger.createLedger(input, req);
  res.status(201).json(await ledger.getLedger(id));
});
accountingRouter.patch('/ledger/:id', requirePermission('accounting:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  await ledger.updateLedger(id, parse(ledgerUpdateSchema, req.body), req);
  res.json(await ledger.getLedger(id));
});
/**
 * Deletes a shipment's invoice set (tax invoice, DIS, debit note) and releases its numbers to
 * the next approved shipment; the shipment is "not invoiced" again.
 */
accountingRouter.post(
  '/ledger/:id/delete-invoice',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(
      z.object({
        reason: z.string().trim().min(3, 'Give a reason for deleting the invoice').max(300),
      }),
      req.body,
    );
    res.json(await docs.releaseInvoiceSet(id, reason, req));
  },
);
accountingRouter.delete('/ledger/:id', requirePermission('accounting:write'), async (req, res) => {
  await ledger.deleteLedger(parse(idParam, req.params).id, req);
  res.status(204).end();
});

/* ---------- Clear fee payments to Chea (a month paid in one or more parts) ---------- */
accountingRouter.get('/clear-fee-payments', async (req, res) => {
  const { month } = parse(clearFeePaymentsQuerySchema, req.query);
  res.json(await clearFee.clearFeeMonth(month, scopeClients(req)));
});
accountingRouter.post(
  '/clear-fee-payments',
  requirePermission('accounting:write'),
  async (req, res) => {
    const input = parse(clearFeePaymentInputSchema, req.body);
    await clearFee.createClearFeePayment(input, req);
    res.status(201).json(await clearFee.clearFeeMonth(input.month, scopeClients(req)));
  },
);
accountingRouter.patch(
  '/clear-fee-payments/:paymentId',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { paymentId } = parse(paymentParam, req.params);
    await clearFee.updateClearFeePayment(
      paymentId,
      parse(clearFeePaymentUpdateSchema, req.body),
      req,
    );
    res.status(204).end();
  },
);
accountingRouter.delete(
  '/clear-fee-payments/:paymentId',
  requirePermission('accounting:write'),
  async (req, res) => {
    await clearFee.deleteClearFeePayment(parse(paymentParam, req.params).paymentId, req);
    res.status(204).end();
  },
);

/** Declarations to start a Credit Noted from (any declaration, ledger row or not). */
accountingRouter.get('/credit-notes/declarations', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), req.query);
  res.json(await ledger.creditNoteDeclarations(q, scopeClients(req)));
});

/** Accounting's check of submitted credit notes: an accounting page, not the broker's. */
accountingRouter.get(
  '/credit-notes/review',
  requirePermission('accounting:read'),
  async (req, res) => {
    const q = parse(creditNoteReviewQuerySchema, req.query);
    if (q.clientId) assertClientAllowed(req, q.clientId);
    res.json(await docs.listCreditNoteReview({ ...q, clientIds: scopeClients(req) }));
  },
);
/** Accounting → Expense to Clients: Operations' submitted record summaries to check. */
accountingRouter.get(
  '/record-summaries/review',
  requirePermission('accounting:read'),
  async (req, res) => {
    const q = parse(creditNoteReviewQuerySchema, req.query);
    if (q.clientId) assertClientAllowed(req, q.clientId);
    res.json(await docs.listRecordSummaryReview({ ...q, clientIds: scopeClients(req) }));
  },
);
/** Sidebar → Credit Noted: every credit note (drafts too) with shipment details. */
accountingRouter.get('/credit-notes/list', async (req, res) => {
  const q = parse(creditNoteListQuerySchema, req.query);
  if (q.clientId) assertClientAllowed(req, q.clientId);
  res.json(
    await docs.listCreditNoteReview({ ...q, allStatuses: true, clientIds: scopeClients(req) }),
  );
});
accountingRouter.patch(
  '/docs/:type/:id/review',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { type } = parse(typeParam, req.params);
    const { id } = parse(idParam, req.params);
    const { reviewStatus, message } = parse(creditNoteReviewInputSchema, req.body);
    if (type === 'record-summaries') {
      await docs.setRecordSummaryReview(id, reviewStatus, message, req);
      // Checked: the shipment's tax invoice, DIS and DN drafts are made automatically.
      const recordId =
        reviewStatus === 'CHECKED' ? (await docs.getDoc(type, id)).accountingRecordId : null;
      const drafts = recordId ? await billing.autoDraftsFor(recordId, req) : [];
      res.json({ numbered: [], drafts: drafts.length });
      return;
    }
    if (type !== 'credit-notes') throw notFound('Document');
    // The shipments numbered by this approval (none unless it was checked).
    const numbered = await docs.setCreditNoteReview(id, reviewStatus, message, req);
    // One whose record summary was approved first gets its drafts now it has its numbers.
    for (const n of numbered) await billing.autoDraftsFor(n.recordId, req);
    res.json({ numbered });
  },
);

/** Accounting's messages about one credit note (the editor shows the latest one). */
accountingRouter.get('/docs/:type/:id/messages', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  if (type !== 'credit-notes') throw notFound('Document');
  const { id } = parse(idParam, req.params);
  res.json(await docs.creditNoteMessagesFor(id));
});

/* The broker's Credit Noted inbox: messages from accounting addressed to me. */
accountingRouter.get('/credit-notes/inbox', async (req, res) => {
  res.json(await docs.creditNoteInbox(req.auth!.userId));
});
accountingRouter.post('/credit-notes/inbox/read', async (req, res) => {
  const { messageId } = parse(z.object({ messageId: z.string().uuid().optional() }), req.body);
  await docs.markCreditNoteMessagesRead(req.auth!.userId, messageId);
  res.status(204).end();
});

/* Operations' Record Summary inbox: accounting's messages from Expense to Clients. */
accountingRouter.get('/record-summaries/inbox', async (req, res) => {
  res.json(await docs.recordSummaryInbox(req.auth!.userId));
});
accountingRouter.post('/record-summaries/inbox/read', async (req, res) => {
  const { messageId } = parse(z.object({ messageId: z.string().uuid().optional() }), req.body);
  await docs.markRecordSummaryMessagesRead(req.auth!.userId, messageId);
  res.status(204).end();
});

/* ---------- Client Billing: a client's month (documents, statements, receipts) ---------- */
accountingRouter.get('/billing', async (req, res) => {
  const { month } = parse(billingMonthQuerySchema, req.query);
  res.json(await billing.overview(month, scopeClients(req)));
});
accountingRouter.get('/billing/:clientId', async (req, res) => {
  const { clientId } = parse(clientParam, req.params);
  assertClientVisible(req, clientId, 'Client');
  const { month } = parse(billingMonthQuerySchema, req.query);
  res.json(await billing.clientMonth(clientId, month));
});
/** Everything to print the month's pack: issued documents in full, statements, receipts. */
accountingRouter.get('/billing/:clientId/pack', async (req, res) => {
  const { clientId } = parse(clientParam, req.params);
  assertClientVisible(req, clientId, 'Client');
  const { month } = parse(billingMonthQuerySchema, req.query);
  const { recordId } = parse(
    z.object({ recordId: z.string().uuid().optional() }).passthrough(),
    req.query,
  );
  res.json(await billing.pack(clientId, month, recordId));
});
accountingRouter.post(
  '/billing/:clientId/drafts',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { clientId } = parse(clientParam, req.params);
    assertClientAllowed(req, clientId);
    const input = parse(billingDraftsInputSchema, req.body);
    res.status(201).json(await billing.createDrafts(clientId, input, req));
  },
);
accountingRouter.post(
  '/billing/:clientId/issue',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { clientId } = parse(clientParam, req.params);
    assertClientAllowed(req, clientId);
    const { month } = parse(billingIssueInputSchema, req.body);
    res.json(await billing.issueDrafts(clientId, month, req));
  },
);

/* ---------- Official receipts (payments against the account statements) ---------- */
accountingRouter.get('/receipts', async (req, res) => {
  const q = parse(receiptListQuerySchema, req.query);
  if (q.clientId) assertClientAllowed(req, q.clientId);
  res.json(await billing.listReceipts({ ...q, clientIds: scopeClients(req) }));
});
accountingRouter.post('/receipts', requirePermission('accounting:write'), async (req, res) => {
  const input = parse(receiptInputSchema, req.body);
  assertClientAllowed(req, input.clientId);
  const id = await billing.createReceipt(input, req);
  res.status(201).json(await billing.getReceipt(id));
});
accountingRouter.get('/receipts/:receiptId', async (req, res) => {
  const receipt = await billing.getReceipt(parse(receiptParam, req.params).receiptId);
  assertClientVisible(req, receipt.clientId, 'Official receipt');
  res.json(receipt);
});
accountingRouter.post(
  '/receipts/:receiptId/void',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { receiptId } = parse(receiptParam, req.params);
    const { reason } = parse(
      z.object({ reason: z.string().trim().min(3, 'Give a reason for voiding').max(300) }),
      req.body,
    );
    assertClientVisible(req, (await billing.getReceipt(receiptId)).clientId, 'Official receipt');
    await billing.voidReceipt(receiptId, reason, req);
    res.json(await billing.getReceipt(receiptId));
  },
);

/* ---------- Billing documents (one set of routes for all five types) ---------- */
accountingRouter.get('/docs/:type', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  res.json(
    await docs.listDocs(type, {
      ...parse(billingDocListQuerySchema, req.query),
      clientIds: scopeClients(req),
    }),
  );
});
accountingRouter.get('/docs/:type/prefill', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  // Credit notes and record summaries can start from a shipping plan's declaration.
  if (
    (type === 'credit-notes' || type === 'record-summaries') &&
    typeof req.query.declarationId === 'string'
  ) {
    const { declarationId } = parse(
      z.object({ declarationId: z.string().uuid('Choose a declaration') }),
      req.query,
    );
    const draft =
      type === 'credit-notes'
        ? await creditNotePrefill(declarationId)
        : await prefill(type, null, declarationId);
    assertClientVisible(req, draft.clientId as string, 'Declaration');
    return void res.json(draft);
  }
  // A document of no shipment (e.g. a monthly service-fee debit note): from the client.
  if (typeof req.query.clientId === 'string' && !req.query.recordId) {
    const { clientId, date } = parse(
      z.object({
        clientId: z.string().uuid('Choose a client'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
      }),
      req.query,
    );
    assertClientVisible(req, clientId, 'Client');
    return void res.json(await clientPrefill(type, clientId, date));
  }
  const { recordId } = parse(
    z.object({ recordId: z.string().uuid('Choose a ledger entry') }),
    req.query,
  );
  if (allowedClients(req))
    assertClientVisible(req, (await ledger.getLedger(recordId)).clientId, 'Ledger entry');
  res.json(await prefill(type, recordId));
});
accountingRouter.get('/docs/:type/:id', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  res.json(await docs.getDoc(type, parse(idParam, req.params).id));
});
accountingRouter.post('/docs/:type', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const input = parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, req.body) as Parameters<
    typeof docs.createDoc
  >[1];
  assertClientAllowed(req, input.clientId);
  const id = await docs.createDoc(type, input, req);
  res.status(201).json(await docs.getDoc(type, id));
});
accountingRouter.put('/docs/:type/:id', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const { id } = parse(idParam, req.params);
  const input = parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, req.body) as Parameters<
    typeof docs.updateDoc
  >[2];
  assertClientAllowed(req, input.clientId);
  await docs.updateDoc(type, id, input, req);
  res.json(await docs.getDoc(type, id));
});
/**
 * Revise → Resubmit: a submitted credit note or record summary saved with its changes and sent
 * back to accounting as Request Revise (the Monthly Ledger keeps its approved amounts until then).
 */
accountingRouter.post('/docs/:type/:id/resubmit', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const { id } = parse(idParam, req.params);
  if (!docs.isRevisable(type))
    throw badRequest('Only credit notes and record summaries can be revised');
  const input = parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, req.body) as Parameters<
    typeof docs.updateDoc
  >[2];
  await docs.updateDoc(type, id, input, req, { resubmit: true });
  res.json(await docs.getDoc(type, id));
});
accountingRouter.post('/docs/:type/:id/issue', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const { id } = parse(idParam, req.params);
  await docs.issueDoc(type, id, req);
  res.json(await docs.getDoc(type, id));
});
accountingRouter.post(
  '/docs/:type/:id/void',
  // Cancelling: accounting's call, except a record summary (its own editors may cancel it).
  (req, res, next) =>
    requirePermission(
      req.params.type === 'record-summaries' ? 'recordsummaries:write' : 'accounting:write',
    )(req, res, next),
  async (req, res) => {
    const { type } = parse(typeParam, req.params);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(
      z.object({ reason: z.string().trim().min(3, 'Give a reason for voiding').max(300) }),
      req.body,
    );
    await docs.voidDoc(type, id, reason, req);
    res.json(await docs.getDoc(type, id));
  },
);
/**
 * Authorised correction of an issued tax invoice, DIS or debit note: its number and/or issue
 * date, with a required reason kept in the audit history.
 */
accountingRouter.post(
  '/docs/:type/:id/correct',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { type } = parse(typeParam, req.params);
    const { id } = parse(idParam, req.params);
    if (!docs.isIssueDated(type))
      throw badRequest('Only tax invoices, disbursements and debit notes can be corrected');
    const body = parse(
      z.object({
        number: z.string().trim().max(30).optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date')
          .optional(),
        reason: z.string().trim().min(3, 'Give a reason for the correction').max(300),
      }),
      req.body,
    );
    await docs.correctIssuedDoc(type, id, body, req);
    res.json(await docs.getDoc(type, id));
  },
);
accountingRouter.delete('/docs/:type/:id', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  await docs.deleteDoc(type, parse(idParam, req.params).id, req);
  res.status(204).end();
});

accountingRouter.get('/docs/:type/:id/export.xlsx', async (req, res) => {
  const { type } = parse(typeParam, req.params) as { type: BillingDocType };
  const d = await docs.getDoc(type, parse(idParam, req.params).id);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(BILLING_DOC_LABEL[type]);
  ws.addRow([
    `GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD. — ${BILLING_DOC_LABEL[type].toUpperCase()}`,
  ]).font = { bold: true, size: 13 };
  ws.addRow([]);
  ws.addRow(['No.', d.number ?? '-', 'Date', d.date, 'Status', d.status]);
  ws.addRow(['Client', d.clientName, 'Declare No', d.declareNo ?? '-']);
  for (const [k, v] of Object.entries(d.header))
    if (v && !/Id$|^number$/.test(k))
      ws.addRow([k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), v]);
  ws.addRow([]);
  const tax = type === 'tax-invoices';
  const vat = vatLabel(d.header.vatRate ?? undefined);
  const head = ws.addRow([
    'No',
    'Description',
    'Qty',
    'Unit',
    'Unit Price',
    'Sub Total',
    ...(tax ? [vat, 'Amount'] : ['Mark']),
  ]);
  head.font = { bold: true };
  d.lines.forEach((l) =>
    ws.addRow([
      l.lineNo,
      l.description,
      Number(l.qty),
      l.unit,
      Number(l.unitPrice),
      Number(l.subtotal),
      ...(tax ? [Number(l.vat), Number(l.amount)] : [l.mark]),
    ]),
  );
  ws.addRow([]);
  if (tax) {
    ws.addRow([
      '',
      'SUB TOTAL',
      '',
      '',
      'USD',
      Number(d.totals.subtotal),
      'KHR',
      Number(d.totals.subtotalKhr),
    ]);
    ws.addRow(['', vat, '', '', 'USD', Number(d.totals.vat), 'KHR', Number(d.totals.vatKhr)]);
  }
  ws.addRow([
    '',
    'GRAND TOTAL',
    '',
    '',
    'USD',
    Number(d.totals.total),
    ...(d.totals.totalKhr ? ['KHR', Number(d.totals.totalKhr)] : []),
  ]).font = { bold: true };
  ws.getColumn(2).width = 52;
  [5, 6, 7, 8].forEach((c) => (ws.getColumn(c).width = 14));
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', attachmentName(`${d.number ?? type}.xlsx`));
  await wb.xlsx.write(res);
  res.end();
});
