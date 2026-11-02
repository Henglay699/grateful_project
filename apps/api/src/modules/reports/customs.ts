import { sql } from 'drizzle-orm';
import type { CustomsReportData, CustomsReportLine } from '@gs/shared';
import { db } from '../../db/client';
import { notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';
import { monthRange } from './service';

/**
 * Reports → Import & Export: the factory's report of goods in (or out) by customs declaration
 * ("តារាងរបាយការណ៏នាំចូល/នាំចេញ…តាមប្រតិវេទន៏គយ"), one row per commercial invoice line.
 *
 * A shipment's declaration is its numbered "I …" (imports) or "E …" (exports) one; other
 * numbers kept on it (CO forms, BL/RE references) are not customs declarations. A line's
 * period is its declaration's date; empty lines (no qty, weight or value) are left off.
 */
export async function customsReport(q: {
  clientId: string;
  direction: 'IMPORT' | 'EXPORT';
  from: string;
  to: string;
}): Promise<CustomsReportData> {
  const [start] = monthRange(q.from);
  const [, end] = monthRange(q.to);
  const letter = q.direction === 'IMPORT' ? 'I' : 'E';

  const [client] = await queryRows<{
    name: string;
    legalName: string | null;
    vattin: string | null;
  }>(
    db,
    sql`SELECT name, legal_name AS "legalName", vattin FROM clients WHERE id = ${q.clientId}::uuid`,
  );
  if (!client) throw notFound('Client');

  const rows = await queryRows<{
    declareNo: string;
    declareDate: string;
    shipmentId: string;
    reference: string;
    invoiceNo: string;
    description: string | null;
    unit: string | null;
    qty: string;
    netWeightKg: string;
    grossWeightKg: string;
    value: string;
  }>(
    db,
    sql`WITH decl AS (
          SELECT DISTINCT ON (d.shipment_id) d.shipment_id, d.declare_no, d.declare_date
          FROM customs_declarations d
          WHERE d.declare_no ~* ${`^\\s*${letter}\\s*[0-9]`}
          ORDER BY d.shipment_id, d.declare_date, d.declare_no
        )
        SELECT regexp_replace(trim(d.declare_no), '^([A-Za-z])\\s*', '\\1 ') AS "declareNo",
          to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate",
          s.id AS "shipmentId", s.reference, i.invoice_no AS "invoiceNo",
          l.description, l.unit, l.pcs AS qty, l.net_weight_kg AS "netWeightKg",
          l.gross_weight_kg AS "grossWeightKg", COALESCE(l.fob_amount, 0) AS value
        FROM decl d
        JOIN shipments s ON s.id = d.shipment_id
        JOIN cargo_invoices i ON i.shipment_id = s.id
        JOIN cargo_invoice_lines l ON l.invoice_id = i.id
        WHERE s.client_id = ${q.clientId}::uuid AND s.direction = ${q.direction}
          AND s.deleted_at IS NULL
          AND d.declare_date BETWEEN ${start}::date AND ${end}::date
          AND (l.pcs <> 0 OR l.net_weight_kg <> 0 OR COALESCE(l.fob_amount, 0) <> 0)
        ORDER BY d.declare_date, d.declare_no, i.sort_order, i.invoice_no, l.line_no`,
  );

  // Shipments of the period (by invoice date, else ETD/ETA) that are still waiting for theirs.
  const undeclared = await queryRows<CustomsReportData['undeclared'][number]>(
    db,
    sql`SELECT s.id AS "shipmentId", s.reference,
          to_char(min(COALESCE(i.invoice_date, s.etd, s.eta)), 'YYYY-MM-DD') AS date,
          count(l.id)::int AS lines
        FROM shipments s
        JOIN cargo_invoices i ON i.shipment_id = s.id
        JOIN cargo_invoice_lines l ON l.invoice_id = i.id
        WHERE s.client_id = ${q.clientId}::uuid AND s.direction = ${q.direction}
          AND s.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM customs_declarations d
                          WHERE d.shipment_id = s.id AND d.declare_no ~* ${`^\\s*${letter}\\s*[0-9]`})
        GROUP BY s.id, s.reference
        HAVING min(COALESCE(i.invoice_date, s.etd, s.eta)) BETWEEN ${start}::date AND ${end}::date
        ORDER BY 3, 2`,
  );

  return {
    ...q,
    companyName: client.legalName || client.name,
    vattin: client.vattin ?? '',
    lines: rows.map((r): CustomsReportLine => ({
      ...r,
      description: r.description ?? '',
      qty: Number(r.qty),
      netWeightKg: Number(r.netWeightKg),
      grossWeightKg: Number(r.grossWeightKg),
      value: Number(r.value),
    })),
    undeclared,
  };
}
