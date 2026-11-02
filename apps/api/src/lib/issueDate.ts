import { sql } from 'drizzle-orm';
import { nextBusinessDay } from '@gs/shared';
import type { DbOrTx } from '../db/client';
import { queryRows } from './listing';

/**
 * Document issue date (tax invoice, DIS, debit note) for a customs declaration (clearance)
 * date: the next working day, skipping weekends and the public holidays in Settings →
 * Public holidays. Run on the server only, from the holiday calendar in the database.
 */
export async function issueDateFor(tx: DbOrTx, clearanceDate: string): Promise<string> {
  // Holidays from the clearance date on; 60 days covers any run of weekends and holidays.
  const rows = await queryRows<{ d: string }>(
    tx,
    sql`SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d FROM public_holidays
        WHERE holiday_date > ${clearanceDate}::date AND holiday_date <= ${clearanceDate}::date + 60`,
  );
  return nextBusinessDay(clearanceDate, new Set(rows.map((r) => r.d))).date;
}
