import {
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { MihMonthData, PayrollMonthDetail } from '@gs/shared';
import { id, money, timestamps } from './_common';
import { users } from './auth';
import { clients } from './reference';

/**
 * Reports → Payroll: a month's imported payroll, saved so it can be listed and reopened. One
 * per company and month; saving the month again replaces it. The staff rows (with each
 * person's pay) are kept as imported; the totals are copied out for the list.
 */
export const payrollMonths = pgTable(
  'payroll_months',
  {
    id: id(),
    /** "2026-07". */
    period: char('period', { length: 7 }).notNull(),
    company: text('company').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    sheetName: text('sheet_name').notNull().default(''),
    fileName: text('file_name').notNull().default(''),
    staffCount: integer('staff_count').notNull(),
    female: integer('female').notNull(),
    male: integer('male').notNull(),
    gross: money('gross').notNull(),
    net: money('net').notNull(),
    sections: jsonb('sections').$type<string[]>().notNull().default([]),
    staff: jsonb('staff').$type<PayrollMonthDetail['staff']>().notNull(),
    issues: jsonb('issues').$type<PayrollMonthDetail['issues']>().notNull().default([]),
    savedById: uuid('saved_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payroll_months_company_period_unique').on(sql`upper(${t.company})`, t.period),
    index('payroll_months_period_idx').on(t.period),
  ],
);

/**
 * Reports → MIH: a month's report to the Ministry of Industry, one per client and month. The
 * report itself is kept whole in `data`; the head counts and export totals are copied out for
 * the list. Year-to-date figures aren't stored: they're added up from the saved months.
 */
export const mihMonths = pgTable(
  'mih_months',
  {
    id: id(),
    /** "2026-09". */
    period: char('period', { length: 7 }).notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    employees: integer('employees').notNull(),
    female: integer('female').notNull(),
    salary: money('salary').notNull(),
    exportQty: numeric('export_qty', { precision: 16, scale: 2 }).notNull(),
    exportValue: money('export_value').notNull(),
    data: jsonb('data').$type<MihMonthData>().notNull(),
    source: text('source').$type<'app' | 'excel'>().notNull().default('app'),
    fileName: text('file_name').notNull().default(''),
    issues: jsonb('issues').$type<string[]>().notNull().default([]),
    savedById: uuid('saved_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('mih_months_client_period_unique').on(t.clientId, t.period)],
);
