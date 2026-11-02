import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import {
  CUT_STOCK_CATEGORY_LABEL,
  cutStockItemInputSchema,
  type CutStockCategory,
  type CutStockImportResult,
  type CutStockMovement,
  type CutStockOption,
  type CutStockRow,
  type CutStockSummary,
  type Paginated,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { db } from '../../db/client';
import { clients, cutStockItems } from '../../db/schema';
import { audit } from '../../lib/audit';
import { businessRule, conflict, notFound } from '../../lib/errors';
import {
  likePattern,
  orderBy,
  paginate,
  queryRows,
  toPaginated,
  whereAll,
  isoTs,
} from '../../lib/listing';
import { readMasterList } from '../../lib/masterList';

const rowSelect = (extra: SQL = sql``) => sql`
  SELECT i.id, i.client_id AS "clientId", i.line_no AS "lineNo", i.declare_ref AS "declareRef", i.category, i.name,
         i.new_or_used AS "newOrUsed", i.unit, i.qty::text AS qty, i.unit_price::text AS "unitPrice",
         round(i.qty * i.unit_price, 2)::text AS "totalPrice", i.remarks,
         b.imported_qty::text AS "importedQty", b.imported_value::text AS "importedValue", b.imported_nw::text AS "importedNw",
         b.balance::text AS balance, b.balance_pct::text AS "balancePct", b.condition
         ${extra}
  FROM cut_stock_items i JOIN cut_stock_balances b ON b.item_id = i.id`;

interface ListParams {
  clientId: string;
  q?: string | undefined;
  category?: CutStockCategory | undefined;
  condition?: 'OK' | 'CHECK' | 'OVER' | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

function where(p: Omit<ListParams, 'page' | 'pageSize' | 'sort'>) {
  const conds = [sql`i.deleted_at IS NULL`, sql`i.client_id = ${p.clientId}`];
  if (p.category) conds.push(sql`i.category = ${p.category}`);
  if (p.condition === 'OVER') conds.push(sql`b.balance < 0`);
  else if (p.condition) conds.push(sql`b.condition = ${p.condition}`);
  if (p.q) {
    const like = likePattern(p.q);
    conds.push(
      sql`(i.name ILIKE ${like} OR i.declare_ref ILIKE ${like} OR i.remarks ILIKE ${like})`,
    );
  }
  return whereAll(conds);
}

export async function listCutStock(
  p: ListParams,
): Promise<Paginated<CutStockRow> & { summary: CutStockSummary }> {
  const rows = await queryRows<CutStockRow & { total_count: string }>(
    db,
    sql`
    ${rowSelect(sql`, count(*) OVER () AS total_count`)} ${where(p)}
    ${orderBy(p.sort, { lineNo: sql`i.category, i.line_no`, name: sql`i.name`, balance: sql`b.balance`, balancePct: sql`b.balance_pct`, qty: sql`i.qty` }, sql`i.category, i.line_no`)}
    ${paginate(p.page, p.pageSize)}`,
  );
  const [s] = await queryRows<CutStockSummary>(
    db,
    sql`
    SELECT count(*)::int AS items, (count(*) FILTER (WHERE b.condition = 'CHECK'))::int AS "checkCount",
           (count(*) FILTER (WHERE b.balance < 0))::int AS "overImported",
           coalesce(sum(round(i.qty * i.unit_price, 2)), 0)::text AS "totalValue",
           coalesce(sum(b.imported_value), 0)::text AS "importedValue"
    FROM cut_stock_items i JOIN cut_stock_balances b ON b.item_id = i.id
    WHERE i.deleted_at IS NULL AND i.client_id = ${p.clientId}`,
  );
  return { ...toPaginated(rows, p.page, p.pageSize), summary: s! };
}

export async function cutStockOptions(
  clientId: string,
  q: string | undefined,
  limit = 20,
): Promise<CutStockOption[]> {
  return queryRows<CutStockOption>(
    db,
    sql`
    SELECT i.id, i.declare_ref AS "declareRef", i.name, i.unit, i.unit_price::text AS "unitPrice", b.balance::text AS balance
    FROM cut_stock_items i JOIN cut_stock_balances b ON b.item_id = i.id
    ${where({ clientId, q })}
    ORDER BY (CASE WHEN ${q ?? ''} <> '' AND i.name ILIKE ${`${q ?? ''}%`} THEN 0 ELSE 1 END), i.category, i.line_no
    LIMIT ${limit}`,
  );
}

export async function getCutStockItem(
  id: string,
): Promise<CutStockRow & { movements: CutStockMovement[]; openingImportedQty: string }> {
  const [row] = await queryRows<CutStockRow & { openingImportedQty: string }>(
    db,
    sql`
    ${rowSelect(sql`, i.opening_imported_qty::text AS "openingImportedQty"`)} WHERE i.id = ${id} AND i.deleted_at IS NULL`,
  );
  if (!row) throw notFound('Cut-stock item');
  const movements = await queryRows<CutStockMovement>(
    db,
    sql`
    SELECT l.id, ci.invoice_no AS "invoiceNo", to_char(ci.invoice_date, 'YYYY-MM-DD') AS "invoiceDate", s.id AS "shipmentId",
           s.reference AS "shipmentReference", l.pcs::text AS qty, l.fob_unit_price::text AS "unitPrice", l.net_weight_kg::text AS "netWeightKg",
           l.override_reason AS "overrideReason", u.full_name AS "overrideBy", ${isoTs('l.created_at')} AS "createdAt"
    FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id
    JOIN shipments s ON s.id = ci.shipment_id AND s.deleted_at IS NULL
    LEFT JOIN users u ON u.id = l.override_by_id
    WHERE l.cut_stock_item_id = ${id} ORDER BY ci.invoice_date DESC NULLS LAST, l.created_at DESC`,
  );
  return { ...row, movements };
}

type ItemInput = z.output<typeof cutStockItemInputSchema>;

async function nextLineNo(clientId: string, category: CutStockCategory): Promise<number> {
  const [r] = await queryRows<{ n: number }>(
    db,
    sql`
    SELECT coalesce(max(line_no), 0)::int + 1 AS n FROM cut_stock_items WHERE client_id = ${clientId} AND category = ${category}`,
  );
  return r?.n ?? 1;
}

export async function createCutStockItem(input: ItemInput, req: Request): Promise<string> {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)));
  if (!client) throw businessRule('The selected client does not exist');
  const lineNo = await nextLineNo(input.clientId, input.category);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(cutStockItems)
      .values({ ...input, qty: input.qty!, lineNo, openingImportedQty: input.openingImportedQty })
      .returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'cut_stock_item', entityId: row!.id, after: row },
      req,
    );
    return row!.id;
  });
}

export async function updateCutStockItem(
  id: string,
  patch: Partial<Omit<ItemInput, 'clientId'>>,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(cutStockItems)
      .where(and(eq(cutStockItems.id, id), isNull(cutStockItems.deletedAt)))
      .for('update');
    if (!before) throw notFound('Cut-stock item');
    const values = Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => v !== undefined && !(k === 'qty' && v === null)),
    );
    const [after] = await tx
      .update(cutStockItems)
      .set(values)
      .where(eq(cutStockItems.id, id))
      .returning();
    await audit(
      tx,
      { action: 'UPDATE', entity: 'cut_stock_item', entityId: id, before, after },
      req,
    );
  });
}

export async function deleteCutStockItem(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(cutStockItems)
      .where(and(eq(cutStockItems.id, id), isNull(cutStockItems.deletedAt)))
      .for('update');
    if (!before) throw notFound('Cut-stock item');
    const [used] = await queryRows<{ n: number }>(
      tx,
      sql`SELECT count(*)::int AS n FROM cargo_invoice_lines WHERE cut_stock_item_id = ${id}`,
    );
    if (used!.n)
      throw conflict(`${before.name} is on ${used!.n} invoice item(s) and cannot be deleted`);
    await tx.update(cutStockItems).set({ deletedAt: new Date() }).where(eq(cutStockItems.id, id));
    await audit(tx, { action: 'DELETE', entity: 'cut_stock_item', entityId: id, before }, req);
  });
}

/**
 * Import a master list workbook (same layout as JR CDC MASTER LIST.xlsx), matched on the
 * Declare column. New items take the sheet's IMPORTED figures as their opening balance;
 * existing items only get their master fields updated (declarations recorded here are kept)
 * unless updateOpening is set.
 */
export async function importMasterList(
  clientId: string,
  buffer: Buffer,
  opts: { dryRun: boolean; updateOpening: boolean },
  req: Request,
): Promise<CutStockImportResult> {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)));
  if (!client) throw businessRule('The selected client does not exist');
  let rows;
  try {
    rows = await readMasterList(buffer);
  } catch {
    throw businessRule('The file could not be read as a master list workbook (.xlsx)');
  }
  if (!rows.length)
    throw businessRule(
      'No items found. The sheet needs category heading rows (e.g. "I. MACHINERIES & EQUIPMENTS") followed by item rows.',
    );

  const result: CutStockImportResult = {
    dryRun: opts.dryRun,
    created: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };
  const existing = await db
    .select()
    .from(cutStockItems)
    .where(and(eq(cutStockItems.clientId, clientId), isNull(cutStockItems.deletedAt)));
  const byRef = new Map(existing.map((e) => [e.declareRef.toUpperCase(), e]));

  await db.transaction(async (tx) => {
    for (const r of rows) {
      const parsed = cutStockItemInputSchema.safeParse({
        clientId,
        declareRef: r.declareRef,
        category: r.category,
        name: r.name,
        newOrUsed: r.newOrUsed,
        unit: r.unit,
        qty: r.qty,
        unitPrice: r.unitPrice,
        remarks: r.remarks,
        openingImportedQty: r.importedQty,
      });
      if (!parsed.success) {
        result.errors.push({
          row: r.sheetRow,
          message: `${r.declareRef || r.name}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        });
        continue;
      }
      const v = parsed.data;
      const prev = byRef.get(v.declareRef);
      if (!prev) {
        result.created++;
        if (!opts.dryRun)
          await tx.insert(cutStockItems).values({
            ...v,
            qty: v.qty!,
            lineNo: r.lineNo,
            openingImportedValue: r.importedValue.toFixed(2),
            openingImportedNw: String(r.importedNw),
          });
        continue;
      }
      const patch: Partial<typeof cutStockItems.$inferInsert> = {};
      if (prev.name !== v.name) patch.name = v.name;
      if (prev.unit !== v.unit) patch.unit = v.unit;
      if (Number(prev.qty) !== Number(v.qty)) patch.qty = v.qty!;
      if (Number(prev.unitPrice) !== Number(v.unitPrice)) patch.unitPrice = v.unitPrice;
      if (prev.category !== v.category) patch.category = v.category;
      if ((prev.remarks ?? null) !== v.remarks) patch.remarks = v.remarks;
      if ((prev.newOrUsed ?? null) !== v.newOrUsed) patch.newOrUsed = v.newOrUsed;
      if (opts.updateOpening && Number(prev.openingImportedQty) !== r.importedQty) {
        patch.openingImportedQty = String(r.importedQty);
        patch.openingImportedValue = r.importedValue.toFixed(2);
        patch.openingImportedNw = String(r.importedNw);
      }
      if (!Object.keys(patch).length) {
        result.unchanged++;
        continue;
      }
      result.updated++;
      if (!opts.dryRun)
        await tx.update(cutStockItems).set(patch).where(eq(cutStockItems.id, prev.id));
    }
    if (!opts.dryRun)
      await audit(
        tx,
        {
          action: 'IMPORT',
          entity: 'cut_stock_item',
          entityId: clientId,
          after: { created: result.created, updated: result.updated, errors: result.errors.length },
        },
        req,
      );
  });
  return result;
}

/** Master list workbook in the original layout, with live imported/balance figures. */
export async function exportMasterList(clientId: string): Promise<ExcelJS.Workbook> {
  const rows = await queryRows<CutStockRow>(
    db,
    sql`${rowSelect()} ${where({ clientId })} ORDER BY i.category, i.line_no`,
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CDC', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.mergeCells('I1:K1');
  ws.getCell('I1').value = 'IMPORTED';
  ws.getCell('I1').alignment = { horizontal: 'center' };
  const widths = [6, 42, 9, 7, 11, 12, 14, 12, 10, 12, 10, 11, 8, 10, 10];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const header = [
    'No',
    'Item',
    'New/ Used',
    'Unit',
    'Quantity',
    'Unit Price\nUSD',
    'Total Price\nUSD',
    'Remarks',
    "Q'TY",
    'PRICE',
    'N.W',
    'BALANCE',
    '<50%',
    'Condition',
    'Declare',
  ];
  let category: string | null = null;
  for (const r of rows) {
    if (r.category !== category) {
      category = r.category;
      const label = {
        MACHINERY_EQUIPMENT: 'I. MACHINERIES & EQUIPMENTS',
        RAW_MATERIAL: 'II. RAW MATERIAL',
        ACCESSORY: 'III. ACCESSORY',
      }[r.category];
      const h = ws.addRow([label, ...header.slice(1)]);
      h.font = { bold: true };
      h.alignment = { wrapText: true, vertical: 'middle' };
    }
    ws.addRow([
      r.lineNo,
      r.name,
      r.newOrUsed,
      r.unit,
      Number(r.qty),
      Number(r.unitPrice),
      Number(r.totalPrice),
      r.remarks,
      Number(r.importedQty),
      Number(r.importedValue),
      Number(r.importedNw),
      Number(r.balance),
      r.balancePct === null ? null : Number(r.balancePct),
      r.condition,
      r.declareRef,
    ]);
  }
  ws.getColumn(13).numFmt = '0%';
  [6, 7, 10].forEach((c) => (ws.getColumn(c).numFmt = '#,##0.00'));
  void CUT_STOCK_CATEGORY_LABEL;
  return wb;
}
