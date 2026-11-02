import { eq, sql } from 'drizzle-orm';
import {
  fromCents,
  toCents,
  toMoneyString,
  type ClearFeePayment,
  type ClearFeePaymentMonth,
  clearFeePaymentInputSchema,
  clearFeePaymentUpdateSchema,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { db } from '../../db/client';
import { clearFeePayments } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';
import { clientCondition } from '../../lib/clientScope';

/**
 * The Chea payment status follows the payments: a month's ledger entries are all Paid once
 * its payments, plus anything overpaid in earlier months, cover its clear fee total (all
 * clients). Months before this one keep the status imported from the monthly workbooks,
 * which predate payment tracking.
 */
export const CHEA_TRACKED_FROM = '2026-10-01';

/**
 * One row per month: clear fee, paid, credit carried in, settled. It starts at
 * CHEA_TRACKED_FROM, or earlier at the first month with a payment, so an overpayment
 * recorded in an earlier month is still carried forward and deducted.
 */
const CHEA_MONTHS = sql`
  WITH RECURSIVE m AS (
    SELECT g::date AS month, row_number() OVER (ORDER BY g) AS n,
           (SELECT coalesce(sum(clear_fee), 0) FROM accounting_records
             WHERE inv_date >= g::date AND inv_date < g::date + interval '1 month') AS fee,
           (SELECT coalesce(sum(amount), 0) FROM clear_fee_payments WHERE period_month = g::date) AS paid
    FROM generate_series(
      least(${CHEA_TRACKED_FROM}::date, (SELECT min(period_month) FROM clear_fee_payments)),
      greatest(date_trunc('month', current_date), (SELECT max(inv_date) FROM accounting_records),
               (SELECT max(period_month) FROM clear_fee_payments)),
      interval '1 month') g
  ), r AS (
    SELECT n, month, fee, paid, 0::numeric AS carried FROM m WHERE n = 1
    UNION ALL
    SELECT m.n, m.month, m.fee, m.paid, greatest(r.carried + r.paid - r.fee, 0)
    FROM r JOIN m ON m.n = r.n + 1
  )
  SELECT month, carried, paid + carried >= fee AS settled FROM r`;

/** Joins each ledger row (alias a) to its month's settlement (alias cm). */
export const CHEA_JOIN = sql`LEFT JOIN (${CHEA_MONTHS}) cm ON cm.month = date_trunc('month', a.inv_date)::date`;

/**
 * A ledger row's Chea payment status; needs CHEA_JOIN. A row with no clear fee owes Chea
 * nothing: NA (not counted, not in the Unpaid filter). A month whose payments plus carried
 * credit cover its clear fee is Paid; before CHEA_TRACKED_FROM an uncovered month keeps its
 * imported status, so recorded payments can settle an old month but never unpay it.
 */
export const CHEA_STATUS = sql`(CASE WHEN coalesce(a.clear_fee, 0) = 0 THEN 'NA'
  WHEN cm.settled THEN 'PAID'
  WHEN a.inv_date < ${CHEA_TRACKED_FROM}::date THEN a.chea_status::text
  ELSE 'UNPAID' END)`;

/**
 * A ledger month's clear fee total, the payments made to Chea against it, credit carried in
 * from earlier overpayments and the balance.
 */
export async function clearFeeMonth(
  month: string,
  clientIds?: string[],
): Promise<ClearFeePaymentMonth> {
  const start = `${month}-01`;
  const scoped = clientCondition(sql`a.client_id`, clientIds);
  const [fee] = await queryRows<{ total: string }>(
    db,
    sql`
    SELECT coalesce(sum(a.clear_fee), 0)::text AS total FROM accounting_records a
    WHERE a.inv_date >= ${start}::date AND a.inv_date < (${start}::date + interval '1 month')
      ${scoped ? sql`AND ${scoped}` : sql``}`,
  );
  const [carry] = await queryRows<{ carried: string }>(
    db,
    sql`SELECT carried::text AS carried FROM (${CHEA_MONTHS}) cm WHERE month = ${start}::date`,
  );
  const carriedC = toCents(carry?.carried ?? '0');
  const payments = await queryRows<ClearFeePayment>(
    db,
    sql`
    SELECT p.id, to_char(p.paid_on, 'YYYY-MM-DD') AS "paidOn", p.amount::text AS amount, p.remark,
           u.full_name AS "createdByName"
    FROM clear_fee_payments p LEFT JOIN users u ON u.id = p.created_by_id
    WHERE p.period_month = ${start}::date
    ORDER BY p.paid_on, p.created_at`,
  );
  const paidC = payments.reduce((s, p) => s + toCents(p.amount), 0);
  return {
    month,
    clearFee: toMoneyString(fee!.total),
    paid: toMoneyString(fromCents(paidC)),
    carriedIn: toMoneyString(fromCents(carriedC)),
    balance: toMoneyString(fromCents(toCents(fee!.total) - paidC - carriedC)),
    payments,
  };
}

export async function createClearFeePayment(
  input: z.output<typeof clearFeePaymentInputSchema>,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clearFeePayments)
      .values({
        periodMonth: `${input.month}-01`,
        paidOn: input.paidOn,
        amount: input.amount!, // required by the schema (allowEmpty: false)
        remark: input.remark,
        createdById: req.auth!.userId,
        updatedById: req.auth!.userId,
      })
      .returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'clear_fee_payment', entityId: row!.id, after: row },
      req,
    );
  });
}

export async function updateClearFeePayment(
  id: string,
  patch: z.output<typeof clearFeePaymentUpdateSchema>,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(clearFeePayments)
      .where(eq(clearFeePayments.id, id))
      .for('update');
    if (!before) throw notFound('Payment');
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const [after] = await tx
      .update(clearFeePayments)
      .set({ ...values, updatedById: req.auth!.userId })
      .where(eq(clearFeePayments.id, id))
      .returning();
    await audit(
      tx,
      { action: 'UPDATE', entity: 'clear_fee_payment', entityId: id, before, after },
      req,
    );
  });
}

export async function deleteClearFeePayment(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .delete(clearFeePayments)
      .where(eq(clearFeePayments.id, id))
      .returning();
    if (!before) throw notFound('Payment');
    await audit(tx, { action: 'DELETE', entity: 'clear_fee_payment', entityId: id, before }, req);
  });
}
