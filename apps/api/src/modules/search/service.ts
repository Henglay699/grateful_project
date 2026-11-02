import { sql, type SQL } from 'drizzle-orm';
import { hasPermission, type Permission, type SearchHit, type SearchHitKind } from '@gs/shared';
import { db } from '../../db/client';
import { clientCondition } from '../../lib/clientScope';
import { likePattern, queryRows } from '../../lib/listing';

/** Suggestions per kind; the dropdown stays short like a browser's. */
const PER_KIND = 5;

interface Row {
  id: string;
  title: string;
  subtitle: string | null;
}

interface Source {
  kind: SearchHitKind;
  permission: Permission;
  /** The row's client column, for users limited to some clients. */
  clientCol: string;
  url: (id: string) => string;
  /** Rows matching `like`; `starts` ranks numbers that begin with the text first. */
  query: (like: string, starts: string, scope: SQL) => SQL;
}

const DATE = (col: string) => sql.raw(`upper(to_char(${col}, 'DD-Mon-YY'))`);

/** A billing document table with a number, a date, and the shared shipment-ish fields. */
const billingDoc = (
  kind: SearchHitKind,
  table: string,
  no: string,
  date: string,
  party: string,
  path: string,
): Source => ({
  kind,
  permission: 'accounting:read',
  clientCol: 'd.client_id',
  url: (id) => `${path}/${id}`,
  query: (like, starts, scope) => sql`
    SELECT d.id, d.${sql.raw(no)} AS title,
           concat_ws(' · ', c.code, d.${sql.raw(party)}, ${DATE(`d.${date}`)}, nullif(d.hbl, ''), nullif(d.container_no, '')) AS subtitle
    FROM ${sql.raw(table)} d JOIN clients c ON c.id = d.client_id
    WHERE (d.${sql.raw(no)} ILIKE ${like} OR d.${sql.raw(party)} ILIKE ${like} OR d.hbl ILIKE ${like}
           OR d.container_no ILIKE ${like}) ${scope}
    ORDER BY (d.${sql.raw(no)} ILIKE ${starts}) DESC, d.${sql.raw(date)} DESC
    LIMIT ${PER_KIND}`,
});

const SOURCES: Source[] = [
  {
    kind: 'shipment',
    permission: 'shipments:read',
    clientCol: 's.client_id',
    url: (id) => `/plans/${id}`,
    // Invoice no. is what the team calls a shipment by; the reference when there's none.
    query: (like, starts, scope) => sql`
      SELECT s.id,
             coalesce((SELECT string_agg(x.invoice_no, ', ' ORDER BY x.sort_order) FROM cargo_invoices x WHERE x.shipment_id = s.id), s.reference) AS title,
             concat_ws(' · ', c.code, initcap(s.direction::text), nullif(s.hbl_no, ''),
                       (SELECT string_agg(x.container_no, ', ' ORDER BY x.sort_order) FROM containers x WHERE x.shipment_id = s.id),
                       (SELECT string_agg(x.declare_no, ', ' ORDER BY x.declare_date) FROM customs_declarations x WHERE x.shipment_id = s.id AND x.declare_no IS NOT NULL)) AS subtitle
      FROM shipments s JOIN clients c ON c.id = s.client_id
      WHERE s.deleted_at IS NULL ${scope}
        AND (s.reference ILIKE ${like} OR s.hbl_no ILIKE ${like} OR s.booking_no ILIKE ${like}
          OR EXISTS (SELECT 1 FROM cargo_invoices x WHERE x.shipment_id = s.id AND x.invoice_no ILIKE ${like})
          OR EXISTS (SELECT 1 FROM containers x WHERE x.shipment_id = s.id AND x.container_no ILIKE ${like})
          OR EXISTS (SELECT 1 FROM customs_declarations x WHERE x.shipment_id = s.id AND x.declare_no ILIKE ${like}))
      ORDER BY EXISTS (SELECT 1 FROM cargo_invoices x WHERE x.shipment_id = s.id AND x.invoice_no ILIKE ${starts}) DESC,
               s.created_at DESC
      LIMIT ${PER_KIND}`,
  },
  {
    kind: 'client',
    permission: 'clients:read',
    clientCol: 'c.id',
    url: (id) => `/clients/${id}`,
    query: (like, starts, scope) => sql`
      SELECT c.id, c.code AS title, concat_ws(' · ', c.name, nullif(c.legal_name, c.name)) AS subtitle
      FROM clients c
      WHERE c.deleted_at IS NULL ${scope}
        AND (c.code ILIKE ${like} OR c.name ILIKE ${like} OR c.legal_name ILIKE ${like})
      ORDER BY (c.code ILIKE ${starts}) DESC, c.code
      LIMIT ${PER_KIND}`,
  },
  billingDoc(
    'tax-invoice',
    'tax_invoices',
    'invoice_no',
    'invoice_date',
    'customer_name_en',
    '/accounting/tax-invoices',
  ),
  billingDoc(
    'disbursement',
    'disbursements',
    'dis_no',
    'dis_date',
    'customer_name_en',
    '/accounting/disbursements',
  ),
  billingDoc('debit-note', 'debit_notes', 'dn_no', 'dn_date', 'bill_to', '/accounting/debit-notes'),
  {
    kind: 'credit-note',
    permission: 'creditnotes:read',
    clientCol: 'd.client_id',
    url: (id) => `/credit-noted/${id}`,
    query: (like, starts, scope) => sql`
      SELECT d.id, d.cn_no AS title,
             concat_ws(' · ', c.code, ${DATE('d.cn_date')}, nullif(d.declare_no, ''), nullif(d.container_no, '')) AS subtitle
      FROM credit_notes d JOIN clients c ON c.id = d.client_id
      WHERE (d.cn_no ILIKE ${like} OR d.declare_no ILIKE ${like} OR d.bill_to ILIKE ${like}
             OR d.container_no ILIKE ${like} OR d.ref_no ILIKE ${like}) ${scope}
      ORDER BY (d.cn_no ILIKE ${starts}) DESC, d.cn_date DESC
      LIMIT ${PER_KIND}`,
  },
  {
    kind: 'record-summary',
    permission: 'recordsummaries:read',
    clientCol: 'd.client_id',
    url: (id) => `/record-summary/${id}`,
    query: (like, starts, scope) => sql`
      SELECT d.id, coalesce(nullif(d.declare_no, ''), d.inv_no, ${DATE('d.summary_date')}) AS title,
             concat_ws(' · ', c.code, ${DATE('d.summary_date')}, nullif(d.bl_no, ''), nullif(d.container_no, '')) AS subtitle
      FROM record_summaries d JOIN clients c ON c.id = d.client_id
      WHERE (d.declare_no ILIKE ${like} OR d.inv_no ILIKE ${like} OR d.dis_no ILIKE ${like} OR d.dn_no ILIKE ${like}
             OR d.bl_no ILIKE ${like} OR d.container_no ILIKE ${like}) ${scope}
      ORDER BY (d.declare_no ILIKE ${starts}) DESC, d.summary_date DESC
      LIMIT ${PER_KIND}`,
  },
  {
    kind: 'quotation',
    permission: 'quotations:read',
    clientCol: 'q.client_id',
    url: (id) => `/quotations/${id}`,
    query: (like, starts, scope) => sql`
      SELECT q.id, concat(q.quote_no, CASE WHEN q.version > 1 THEN concat(' v', q.version) END) AS title,
             concat_ws(' · ', q.to_name, ${DATE('q.quote_date')}) AS subtitle
      FROM quotations q LEFT JOIN clients c ON c.id = q.client_id
      WHERE q.deleted_at IS NULL ${scope}
        AND (q.quote_no ILIKE ${like} OR q.to_name ILIKE ${like} OR q.attn ILIKE ${like})
      ORDER BY (q.quote_no ILIKE ${starts}) DESC, q.quote_date DESC, q.version DESC
      LIMIT ${PER_KIND}`,
  },
];

/**
 * Top-bar search across the records the user may open: each kind only with its read
 * permission, and only the user's own clients when they are limited to some.
 */
export async function globalSearch(
  q: string,
  permissions: readonly string[],
  clientIds: string[] | undefined,
): Promise<SearchHit[]> {
  const like = likePattern(q);
  const starts = like.slice(1);
  const allowed = SOURCES.filter((s) => hasPermission(permissions, s.permission));
  const groups = await Promise.all(
    allowed.map(async (s) => {
      const cond = clientCondition(sql.raw(s.clientCol), clientIds);
      const rows = await queryRows<Row>(db, s.query(like, starts, cond ? sql`AND ${cond}` : sql``));
      return rows.map((r): SearchHit => ({
        kind: s.kind,
        id: r.id,
        title: r.title,
        subtitle: r.subtitle ?? '',
        url: s.url(r.id),
      }));
    }),
  );
  return groups.flat();
}
