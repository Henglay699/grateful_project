import { and, eq, sql } from 'drizzle-orm';
import {
  payrollMonthInputSchema,
  productionLineOf,
  productionProfileSchema,
  type PayrollMonthDetail,
  type PayrollMonthRow,
  type ProductionExportLine,
  type ProductionProfile,
  type ProductionReportData,
} from '@gs/shared';
import type { Request } from 'express';
import { db } from '../../db/client';
import { payrollMonths, settings } from '../../db/schema';
import { audit } from '../../lib/audit';
import { clientCondition } from '../../lib/clientScope';
import { conflict, notFound } from '../../lib/errors';
import { isoTs, queryRows } from '../../lib/listing';
import type { z } from 'zod';

/** The capacity report's saved setup, one per client, in the workspace settings. */
const profileKey = (clientId: string) => `productionReport:${clientId}`;

/** First and last day of "2026-08". */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

/**
 * Reports → Payroll → Capacity report, point 10: the client's export invoice lines of the month
 * summed by product line. A line's month is its commercial invoice's date (the shipment's ETD
 * when the invoice has none), as the report was made by hand.
 */
export async function productionReport(
  clientId: string,
  month: string,
): Promise<ProductionReportData> {
  const [from, to] = monthRange(month);
  const exportRows = await queryRows<{
    description: string | null;
    htsCode: string | null;
    pcs: string;
    reference: string;
  }>(
    db,
    sql`SELECT l.description, l.hts_code AS "htsCode", l.pcs, s.reference
        FROM cargo_invoice_lines l
        JOIN cargo_invoices i ON i.id = l.invoice_id
        JOIN shipments s ON s.id = i.shipment_id
        WHERE s.client_id = ${clientId}::uuid AND s.direction = 'EXPORT' AND s.deleted_at IS NULL
          AND COALESCE(i.invoice_date, s.etd) BETWEEN ${from}::date AND ${to}::date
        ORDER BY COALESCE(i.invoice_date, s.etd), s.reference, l.line_no`,
  );

  const byKey = new Map<string, ProductionExportLine>();
  for (const r of exportRows) {
    const head = productionLineOf(r.description, r.htsCode);
    const line = byKey.get(head.key) ?? { ...head, pcs: 0, invoiceLines: 0, shipments: [] };
    line.pcs += Number(r.pcs);
    line.invoiceLines += 1;
    if (!line.shipments.includes(r.reference)) line.shipments.push(r.reference);
    byKey.set(head.key, line);
  }
  const lines = [...byKey.values()].sort((a, b) => b.pcs - a.pcs);

  const countries = (direction: 'EXPORT' | 'IMPORT', column: 'destination' | 'origin') =>
    queryRows<{ name: string }>(
      db,
      sql`SELECT DISTINCT upper(co.name) AS name
          FROM shipments s
          JOIN countries co ON co.iso2 = ${sql.raw(
            column === 'destination' ? 's.destination_country_iso2' : 's.origin_country_iso2',
          )}
          WHERE s.client_id = ${clientId}::uuid AND s.direction = ${direction}
            AND s.deleted_at IS NULL AND s.etd BETWEEN ${from}::date AND ${to}::date
          ORDER BY 1`,
    );
  // Imports: the fabric words of the shipments' material ("KNITTED / WOVEN", "WOVEN FABRIC").
  const importMaterials = await queryRows<{ material: string }>(
    db,
    sql`SELECT DISTINCT upper(trim(m)) AS material
        FROM shipments s, regexp_split_to_table(COALESCE(s.material, ''), '\\s*[/,&]\\s*') AS m
        WHERE s.client_id = ${clientId}::uuid AND s.direction = 'IMPORT' AND s.deleted_at IS NULL
          AND s.etd BETWEEN ${from}::date AND ${to}::date AND trim(m) <> ''
        ORDER BY 1`,
  );

  return {
    clientId,
    month,
    lines,
    destinations: (await countries('EXPORT', 'destination')).map((r) => r.name),
    importOrigins: (await countries('IMPORT', 'origin')).map((r) => r.name),
    importMaterials: importMaterials.map((r) => r.material),
    profile: await getProfile(clientId),
  };
}

async function getProfile(clientId: string): Promise<ProductionProfile | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, profileKey(clientId)));
  // Parsed again so a profile saved before a field was added still gets its default.
  return row ? productionProfileSchema.parse(row.value) : null;
}

export async function saveProfile(clientId: string, profile: ProductionProfile, req: Request) {
  const key = profileKey(clientId);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(settings).where(eq(settings.key, key));
    await tx
      .insert(settings)
      .values({ key, value: profile, updatedById: req.auth!.userId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: profile, updatedById: req.auth!.userId, updatedAt: new Date() },
      });
    await audit(
      tx,
      { action: 'UPDATE', entity: 'setting', entityId: key, before: before?.value, after: profile },
      req,
    );
  });
  return profile;
}

/* ---------- Payroll: saved months ---------- */

const MONTH_COLUMNS = sql`pm.id, pm.period, pm.company, pm.client_id AS "clientId",
  pm.sheet_name AS "sheetName", pm.file_name AS "fileName", pm.staff_count AS "staffCount",
  pm.female, pm.male, pm.gross, pm.net, u.full_name AS "savedByName",
  ${isoTs('pm.updated_at')} AS "savedAt"`;

/** Newest month first. `clientIds` (a restricted user's clients) hides other companies' months. */
export async function listPayrollMonths(
  clientIds: string[] | undefined,
): Promise<PayrollMonthRow[]> {
  const scope = clientCondition(sql`pm.client_id`, clientIds);
  return queryRows<PayrollMonthRow>(
    db,
    sql`SELECT ${MONTH_COLUMNS}
        FROM payroll_months pm LEFT JOIN users u ON u.id = pm.saved_by_id
        ${scope ? sql`WHERE ${scope}` : sql``}
        ORDER BY pm.period DESC, pm.company`,
  );
}

export async function getPayrollMonth(id: string): Promise<PayrollMonthDetail> {
  const [row] = await queryRows<PayrollMonthDetail>(
    db,
    sql`SELECT ${MONTH_COLUMNS}, pm.sections, pm.staff, pm.issues
        FROM payroll_months pm LEFT JOIN users u ON u.id = pm.saved_by_id
        WHERE pm.id = ${id}::uuid`,
  );
  if (!row) throw notFound('Payroll month');
  return row;
}

/**
 * Saves a month as imported. A month already saved for the company is replaced only when the
 * request says so; otherwise 409 with the saved month's id, so the page can ask first.
 */
export async function savePayrollMonth(
  v: z.output<typeof payrollMonthInputSchema>,
  req: Request,
): Promise<PayrollMonthDetail> {
  const sum = (f: (s: (typeof v.staff)[number]) => number) =>
    Math.round(v.staff.reduce((t, s) => t + f(s), 0) * 100) / 100;
  const values = {
    period: v.period,
    company: v.company,
    clientId: v.clientId ?? null,
    sheetName: v.sheetName,
    fileName: v.fileName,
    staffCount: v.staff.length,
    female: v.staff.filter((s) => s.gender === 'F').length,
    male: v.staff.filter((s) => s.gender === 'M').length,
    gross: sum((s) => s.gross).toFixed(2),
    net: sum((s) => s.net).toFixed(2),
    sections: v.sections,
    staff: v.staff,
    issues: v.issues,
    savedById: req.auth!.userId,
  };
  // The audit keeps the month's totals, not everyone's pay a second time.
  const summary = (x: typeof values | undefined) =>
    x && {
      period: x.period,
      company: x.company,
      staffCount: x.staffCount,
      gross: x.gross,
      net: x.net,
      fileName: x.fileName,
    };
  const id = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(payrollMonths)
      .where(
        and(
          sql`upper(${payrollMonths.company}) = upper(${v.company})`,
          eq(payrollMonths.period, v.period),
        ),
      );
    if (existing && !v.replace)
      throw conflict(`${v.company} ${v.period} is already saved`, { id: existing.id });
    let savedId: string;
    if (existing) {
      await tx.update(payrollMonths).set(values).where(eq(payrollMonths.id, existing.id));
      savedId = existing.id;
    } else {
      const [row] = await tx
        .insert(payrollMonths)
        .values(values)
        .returning({ id: payrollMonths.id });
      savedId = row!.id;
    }
    await audit(
      tx,
      {
        action: existing ? 'UPDATE' : 'CREATE',
        entity: 'payroll_month',
        entityId: savedId,
        before: summary(existing as typeof values | undefined),
        after: summary(values),
      },
      req,
    );
    return savedId;
  });
  return getPayrollMonth(id);
}

export async function deletePayrollMonth(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(payrollMonths).where(eq(payrollMonths.id, id)).returning();
    if (!row) throw notFound('Payroll month');
    await audit(
      tx,
      {
        action: 'DELETE',
        entity: 'payroll_month',
        entityId: id,
        before: { period: row.period, company: row.company, staffCount: row.staffCount },
      },
      req,
    );
  });
}
