import { and, eq, sql } from 'drizzle-orm';
import {
  mihExportTotal,
  mihMarketOf,
  mihMaterialKey,
  mihMaterialSchema,
  mihMonthDataSchema,
  mihOriginOf,
  mihProductKey,
  mihProductSchema,
  mihUtilitySchema,
  productExport,
  productionLineOf,
  type mihMonthInputSchema,
  type MihDraft,
  type MihMonth,
  type MihMonthRow,
  type MihPayrollSummary,
  type MihProduct,
  type MihUtility,
  type MihYear,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { db } from '../../db/client';
import { mihMonths } from '../../db/schema';
import { audit } from '../../lib/audit';
import { clientCondition } from '../../lib/clientScope';
import { conflict, notFound } from '../../lib/errors';
import { isoTs, queryRows } from '../../lib/listing';
import { monthRange } from './service';

/* Reports → MIH: the monthly report to the Ministry of Industry, one saved month per client. */

const COLUMNS = sql`mm.id, mm.period, mm.client_id AS "clientId", c.name AS "clientName",
  mm.employees, mm.female, mm.salary, mm.export_qty AS "exportQty",
  mm.export_value AS "exportValue", mm.source, mm.file_name AS "fileName",
  u.full_name AS "savedByName", ${isoTs('mm.updated_at')} AS "savedAt"`;
const FROM = sql`mih_months mm JOIN clients c ON c.id = mm.client_id
  LEFT JOIN users u ON u.id = mm.saved_by_id`;

/** Parsed again so a month saved before a field was added still gets its default. */
const withData = (m: MihMonth): MihMonth => ({ ...m, data: mihMonthDataSchema.parse(m.data) });

/** Newest month first. `clientIds` (a restricted user's clients) hides other factories. */
export async function listMihMonths(clientIds: string[] | undefined): Promise<MihMonthRow[]> {
  const scope = clientCondition(sql`mm.client_id`, clientIds);
  return queryRows<MihMonthRow>(
    db,
    sql`SELECT ${COLUMNS} FROM ${FROM}
        ${scope ? sql`WHERE ${scope}` : sql``}
        ORDER BY mm.period DESC, c.name`,
  );
}

export async function getMihMonth(id: string): Promise<MihMonth> {
  const [row] = await queryRows<MihMonth>(
    db,
    sql`SELECT ${COLUMNS}, mm.data, mm.issues FROM ${FROM} WHERE mm.id = ${id}::uuid`,
  );
  if (!row) throw notFound('MIH month');
  return withData(row);
}

/**
 * A client's saved months of the year in order (the year-to-date is added up from them), and
 * the payroll months saved for it: by client, else by a company name starting with the client's.
 */
export async function mihYear(clientId: string, year: number): Promise<MihYear> {
  const months = await queryRows<MihMonth>(
    db,
    sql`SELECT ${COLUMNS}, mm.data, mm.issues FROM ${FROM}
        WHERE mm.client_id = ${clientId}::uuid AND mm.period LIKE ${`${year}-%`}
        ORDER BY mm.period`,
  );
  const payroll = await queryRows<MihPayrollSummary>(
    db,
    sql`SELECT DISTINCT ON (pm.period) pm.period, pm.staff_count AS "staffCount", pm.female,
          pm.gross
        FROM payroll_months pm
        WHERE pm.period LIKE ${`${year}-%`}
          AND (pm.client_id = ${clientId}::uuid OR upper(pm.company) LIKE
            (SELECT upper(name) || '%' FROM clients WHERE id = ${clientId}::uuid))
        ORDER BY pm.period, (pm.client_id IS NOT DISTINCT FROM ${clientId}::uuid) DESC,
          pm.updated_at DESC`,
  );
  return { clientId, year, months: months.map(withData), payroll };
}

const WASTE = ['សំណល់រឹង', 'សំណល់រាវ', 'សំណល់(ឧស្ម័ន)'];
const MATERIAL_GROUPS = [
  { name: 'MACHINERIES & EQUIPMENTS', unit: 'SET' },
  { name: 'RAW MATERIAL', unit: 'MTR' },
  { name: 'ACCESSORY', unit: '' },
];

/** An import invoice line → the sheet's group: machines, fabric, or everything else. */
export function materialGroupOf(description: string | null, unit: string | null): string {
  const d = (description ?? '').toUpperCase();
  if (
    /\b(MACHINES?|MACHINERY|MACHINERIES|EQUIPMENTS?|GENERATOR)\b/.test(d) ||
    /^SETS?$/i.test(unit ?? '')
  )
    return 'MACHINERIES & EQUIPMENTS';
  if (/\bFABRICS?\b/.test(d)) return 'RAW MATERIAL';
  return 'ACCESSORY';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface InvoiceRow {
  description: string | null;
  htsCode: string | null;
  unit: string | null;
  pcs: string;
  amount: string;
  country: string | null;
  reference: string;
}

/** The client's invoice lines of the month, by invoice date (the shipment's ETD without one). */
function invoiceLines(clientId: string, month: string, direction: 'EXPORT' | 'IMPORT') {
  const [from, to] = monthRange(month);
  const country =
    direction === 'EXPORT' ? sql`s.destination_country_iso2` : sql`s.origin_country_iso2`;
  return queryRows<InvoiceRow>(
    db,
    sql`SELECT l.description, l.hts_code AS "htsCode", l.unit, l.pcs, l.fob_amount AS amount,
          ${country} AS country, s.reference
        FROM cargo_invoice_lines l
        JOIN cargo_invoices i ON i.id = l.invoice_id
        JOIN shipments s ON s.id = i.shipment_id
        WHERE s.client_id = ${clientId}::uuid AND s.direction = ${direction}
          AND s.deleted_at IS NULL
          AND COALESCE(i.invoice_date, s.etd) BETWEEN ${from}::date AND ${to}::date
        ORDER BY COALESCE(i.invoice_date, s.etd), s.reference, l.line_no`,
  );
}

/**
 * A new month, filled in from the app: staff and salary from the saved payroll, products and
 * markets from the export invoices, materials from the import invoices. Factory details, unit
 * prices and row names carry over from the last saved month; meter readings start empty so
 * last month's aren't sent again by mistake.
 */
export async function mihDraft(clientId: string, month: string): Promise<MihDraft> {
  const [client] = await queryRows<{ name: string; legalName: string | null }>(
    db,
    sql`SELECT name, legal_name AS "legalName" FROM clients WHERE id = ${clientId}::uuid`,
  );
  if (!client) throw notFound('Client');

  const [prev] = await queryRows<{ period: string; data: unknown }>(
    db,
    sql`SELECT period, data FROM mih_months
        WHERE client_id = ${clientId}::uuid AND period < ${month}
        ORDER BY period DESC LIMIT 1`,
  );
  const before = prev ? mihMonthDataSchema.parse(prev.data) : null;
  const year = await mihYear(clientId, Number(month.slice(0, 4)));
  const payroll = year.payroll.find((p) => p.period === month) ?? null;

  // The wording the year's earlier months used ("PANTS"), so a line reads the same each month.
  const labels = new Map<string, MihProduct>();
  for (const m of year.months)
    if (m.period < month) for (const p of m.data.products) labels.set(mihProductKey(p), p);

  const exportRows = await invoiceLines(clientId, month, 'EXPORT');
  const products = new Map<string, MihProduct>();
  for (const r of exportRows) {
    const head = productionLineOf(r.description, r.htsCode);
    const key = `${head.kind}|${head.product}`;
    const known = labels.get(key);
    const p =
      products.get(key) ??
      mihProductSchema.parse({
        kind: known?.kind ?? head.kind,
        product: known?.product ?? head.product,
        unit: known?.unit || 'PCS',
      });
    const cell = p.markets[mihMarketOf(r.country)];
    cell.qty = round2(cell.qty + Number(r.pcs));
    cell.value = round2(cell.value + Number(r.amount));
    products.set(key, p);
  }
  const sold = [...products.values()].sort((a, b) => productExport(b).qty - productExport(a).qty);
  // Lines sold earlier in the year stay on the sheet with nothing this month, as the Excel did.
  for (const [key, p] of labels)
    if (!products.has(key))
      sold.push(mihProductSchema.parse({ kind: p.kind, product: p.product, unit: p.unit }));

  const importRows = await invoiceLines(clientId, month, 'IMPORT');
  const materials = (before?.materials.length ? before.materials : MATERIAL_GROUPS).map((m) =>
    mihMaterialSchema.parse({ name: m.name, unit: m.unit }),
  );
  for (const r of importRows) {
    const group = materialGroupOf(r.description, r.unit);
    let m = materials.find((x) => mihMaterialKey(x.name) === group);
    if (!m) materials.push((m = mihMaterialSchema.parse({ name: group })));
    const cell = m.origins[mihOriginOf(r.country)];
    cell.qty = round2(cell.qty + Number(r.pcs));
    cell.value = round2(cell.value + Number(r.amount));
  }

  const utilities = (rows: MihUtility[] | undefined, name: string, unit: string) =>
    (rows?.length ? rows : [{ name, unit, unitPrice: 0 }]).map((u) =>
      mihUtilitySchema.parse({ name: u.name, unit: u.unit, unitPrice: u.unitPrice }),
    );
  const refs = (rows: InvoiceRow[]) => [...new Set(rows.map((r) => r.reference))];

  return {
    clientId,
    month,
    data: mihMonthDataSchema.parse({
      companyName: before?.companyName || client.legalName || client.name,
      employees: payroll?.staffCount ?? 0,
      female: payroll?.female ?? 0,
      salary: payroll ? Number(payroll.gross) : 0,
      totalAsset: before?.totalAsset ?? 0,
      fixedAsset: before?.fixedAsset ?? 0,
      products: sold,
      materials,
      energy: utilities(before?.energy, 'EDC', 'KW'),
      water: utilities(before?.water, 'PPWSA', 'M3'),
      waste: (before?.waste.length ? before.waste : WASTE.map((name) => ({ name, unit: '' }))).map(
        (w) => ({ name: w.name, unit: w.unit, qty: 0 }),
      ),
      directorName: before?.directorName ?? '',
      reporterName: before?.reporterName ?? '',
    }),
    sources: {
      payrollPeriod: payroll?.period ?? null,
      exportLines: exportRows.length,
      exportShipments: refs(exportRows),
      importLines: importRows.length,
      importShipments: refs(importRows),
      carriedFrom: prev?.period ?? null,
    },
  };
}

/**
 * Saves a month. A month already saved for the client is replaced only when the request says
 * so; otherwise 409 with the saved month's id, so the page can ask first.
 */
export async function saveMihMonth(
  v: z.output<typeof mihMonthInputSchema>,
  req: Request,
): Promise<MihMonth> {
  const total = mihExportTotal(v.data);
  const values = {
    period: v.period,
    clientId: v.clientId,
    employees: v.data.employees,
    female: v.data.female,
    salary: v.data.salary.toFixed(2),
    exportQty: total.qty.toFixed(2),
    exportValue: total.value.toFixed(2),
    data: v.data,
    source: v.source,
    fileName: v.fileName,
    issues: v.issues,
    savedById: req.auth!.userId,
  };
  // The audit keeps the month's totals, not the whole report a second time.
  const summary = (x: typeof values | undefined) =>
    x && {
      period: x.period,
      employees: x.employees,
      salary: x.salary,
      exportQty: x.exportQty,
      exportValue: x.exportValue,
      source: x.source,
    };
  const id = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(mihMonths)
      .where(and(eq(mihMonths.clientId, v.clientId), eq(mihMonths.period, v.period)));
    if (existing && !v.replace)
      throw conflict(`${v.period} is already saved for this factory`, { id: existing.id });
    let savedId: string;
    if (existing) {
      await tx
        .update(mihMonths)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(mihMonths.id, existing.id));
      savedId = existing.id;
    } else {
      const [row] = await tx.insert(mihMonths).values(values).returning({ id: mihMonths.id });
      savedId = row!.id;
    }
    await audit(
      tx,
      {
        action: existing ? 'UPDATE' : 'CREATE',
        entity: 'mih_month',
        entityId: savedId,
        before: summary(existing as typeof values | undefined),
        after: summary(values),
      },
      req,
    );
    return savedId;
  });
  return getMihMonth(id);
}

export async function deleteMihMonth(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(mihMonths).where(eq(mihMonths.id, id)).returning();
    if (!row) throw notFound('MIH month');
    await audit(
      tx,
      {
        action: 'DELETE',
        entity: 'mih_month',
        entityId: id,
        before: { period: row.period, clientId: row.clientId, exportQty: row.exportQty },
      },
      req,
    );
  });
}
