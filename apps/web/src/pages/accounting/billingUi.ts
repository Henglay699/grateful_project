import type { BillingPackType, BillingStage, StatementKind } from '@gs/shared';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** This month in Phnom Penh, "2026-10". */
export const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()).slice(0, 7);

/** "2026-09" → "September 2026". */
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** "2026-09" → "SEP-2026", as printed on statements and receipts. */
export const periodCode = (m: string) =>
  `${MONTHS[Number(m.slice(5, 7)) - 1]!.slice(0, 3).toUpperCase()}-${m.slice(0, 4)}`;

/** "2026-09", +1 → "2026-10". */
export function shiftMonth(m: string, by: number): string {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** First and last day: "01-09-2026 ~ 30-09-2026", as on the Excel statements. */
export function periodRange(m: string): string {
  const [y, mo] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `01-${m.slice(5, 7)}-${y} ~ ${last}-${m.slice(5, 7)}-${y}`;
}

/** Last day of the month, or today when today is in it (the date for a new month-end document). */
export function monthDocDate(m: string): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(
    new Date(),
  );
  if (today.startsWith(m)) return today;
  const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0));
  return last.toISOString().slice(0, 10);
}

export const isMonth = (v: string | null): v is string => !!v && /^\d{4}-\d{2}$/.test(v);

export const STAGE: Record<
  BillingStage,
  {
    label: string;
    tone: 'completed' | 'progress' | 'pending' | 'exception' | 'neutral';
    hint: string;
  }
> = {
  EMPTY: { label: 'Nothing billed', tone: 'neutral', hint: 'No issued documents this month' },
  NOT_INVOICED: {
    label: 'Not invoiced',
    tone: 'exception',
    hint: 'Some shipments have no tax invoice yet',
  },
  DRAFTS: { label: 'Drafts to issue', tone: 'pending', hint: 'Drafts are not on the statements' },
  AWAITING_PAYMENT: {
    label: 'Awaiting payment',
    tone: 'progress',
    hint: 'Statements are ready; no payment recorded',
  },
  PARTLY_PAID: { label: 'Partly paid', tone: 'pending', hint: 'Part of the balance is received' },
  PAID: { label: 'Paid', tone: 'completed', hint: 'Every statement is paid in full' },
};

export const PACK_LABEL: Record<BillingPackType, string> = {
  'tax-invoices': 'Tax invoice',
  disbursements: 'Disbursement',
  'debit-notes': 'Debit note',
};

export const STATEMENT_TITLE: Record<StatementKind, string> = {
  INVOICE: 'Invoices & disbursements',
  DEBIT_NOTE: 'Debit notes',
};

/** What a month pack can print (kept in the print page's ?parts=). */
export const PACK_PARTS = [
  ['docs', 'Invoices, disbursements & debit notes'],
  ['st-INVOICE', 'Statement: invoices'],
  ['st-DEBIT_NOTE', 'Statement: debit notes'],
  ['receipts', 'Official receipts'],
  ['checklist', 'Handover checklist'],
] as const;
export type PackPart = (typeof PACK_PARTS)[number][0];
