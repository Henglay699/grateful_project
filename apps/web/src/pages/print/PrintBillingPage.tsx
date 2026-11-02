import { useEffect, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  amountInWords,
  type BillingClient,
  type BillingPack,
  type BillingStatement,
  type OfficialReceipt,
  type PaymentMethod,
  type StatementKind,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCompany, type CompanyInfo } from '../../features/accounting';
import { useBillingPack, useReceipt } from '../../features/billing';
import {
  PACK_PARTS as PARTS,
  periodCode,
  periodRange,
  STATEMENT_TITLE,
  type PackPart as Part,
} from '../accounting/billingUi';
import { DebitNote, Masthead, sheetClass, TaxOrDisbursement } from './InvoicePrint';
import s from './print.module.css';
import p from './billingPrint.module.css';
import { useAutoPrint } from './useAutoPrint';

const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 2026-09-03 → 03-09-2026, the date style of the Excel statements and receipts. */
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-09-30 → 30-Sep-26, the official receipt's date (as on the Excel OR-INV sheet). */
const receiptDate = (iso: string) =>
  `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
/** The receipt's payment boxes, in the Excel's order and wording. */
const RECEIPT_METHOD: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'BANK',
  CASH: 'CASH',
  CHEQUE: 'CHEQUE',
};
/** 2026-09-03 → 03-Sep-2026: the account statements' dates, always a two-digit day. */
const shortDate = (iso: string) =>
  `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;
/** 903.45 → 903.450: the statements show three decimals, as on the Excel sheets. */
const money3 = (v: string | number) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());

function Toolbar({ children }: { children?: ReactNode }) {
  return (
    <div className={p.toolbar}>
      {children}
      <div className={p.buttons}>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}

/**
 * A client's month as one printable pack, replacing the Excel workbook: each shipment's tax
 * invoice, disbursement and debit note, the two account statements, the official receipts
 * and the handover checklist. Drafts are included, printed marked DRAFT; the checklist lists
 * only issued originals.
 */
export function PrintPackPage() {
  const { clientId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : '';
  // ?record=: one shipment's row (its tax invoice, DIS and DN, drafts marked DRAFT).
  const record = params.get('record') || undefined;
  const pack = useBillingPack(clientId, month, record);
  const company = useCompany();
  const { user } = useAuth();
  const asked = params.get('parts')?.split(',') ?? PARTS.map(([k]) => k);
  const on = (k: Part) => asked.includes(k);
  const toggle = (k: Part) => {
    const next = on(k) ? asked.filter((x) => x !== k) : [...asked, k];
    setParams({ month, parts: next.join(',') }, { replace: true });
  };
  useEffect(() => {
    if (pack.data)
      document.title = `${pack.data.client.code} ${periodCode(month)} — Grateful Solutions`;
  }, [pack.data, month]);
  useAutoPrint(!!pack.data && !company.isLoading);

  if (!month) return <div className={s.page}>Choose a month.</div>;
  if (pack.isLoading || company.isLoading) return <div className={s.page}>Loading…</div>;
  if (!pack.data) return <div className={s.page}>Not found.</div>;
  const d = pack.data;
  const c = company.data ?? {};
  // "receipts": every statement's receipts; "rc-INVOICE" / "rc-DEBIT_NOTE": one statement's.
  const receipts = (['INVOICE', 'DEBIT_NOTE'] as const)
    .filter((kind) => on('receipts') || asked.includes(`rc-${kind}`))
    .flatMap((kind) => statementReceipts(d, month, kind));
  const drafts = d.summary.drafts;

  const sheets: ReactNode[] = [];
  if (record) {
    const row = d.rows.find((r) => r.recordId === record);
    return (
      <div className={s.page}>
        <Toolbar />
        {d.docs.length ? (
          <div className={p.pack}>
            {d.docs.map((doc) => (
              <div className={sheetClass(doc.type)} key={doc.id}>
                {doc.status === 'DRAFT' && <div className={s.stamp}>DRAFT</div>}
                {doc.type === 'debit-notes' ? (
                  <DebitNote d={doc} c={c} />
                ) : (
                  <TaxOrDisbursement d={doc} c={c} tax={doc.type === 'tax-invoices'} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={p.hint}>
            {row ? `${row.declareNo} has no documents to print yet.` : 'Shipment not found.'}
          </div>
        )}
      </div>
    );
  }
  if (on('docs'))
    for (const doc of d.docs)
      sheets.push(
        <div className={sheetClass(doc.type)} key={doc.id}>
          {doc.status === 'DRAFT' && <div className={s.stamp}>DRAFT</div>}
          {doc.type === 'debit-notes' ? (
            <DebitNote d={doc} c={c} />
          ) : (
            <TaxOrDisbursement d={doc} c={c} tax={doc.type === 'tax-invoices'} />
          )}
        </div>,
      );
  for (const kind of ['INVOICE', 'DEBIT_NOTE'] as const)
    if (on(`st-${kind}`) && d.statements[kind].lines.length)
      sheets.push(
        <div className={`${s.sheet} ${p.statementSheet}`} key={`st-${kind}`}>
          <StatementSheet client={d.client} month={month} st={d.statements[kind]} c={c} />
        </div>,
      );
  for (let i = 0; i < receipts.length; i += 2)
    sheets.push(
      <div className={`${s.sheet} ${p.receiptSheet}`} key={`or-${i}`}>
        {receipts.slice(i, i + 2).map((r) => (
          <ReceiptBlock key={r.id} r={r} c={c} />
        ))}
      </div>,
    );
  if (on('checklist'))
    sheets.push(
      <div className={s.sheet} key="checklist">
        <ChecklistSheet pack={d} month={month} c={c} preparedBy={user?.fullName ?? ''} />
      </div>,
    );

  return (
    <div className={s.page}>
      <Toolbar>
        <div className={p.toggles}>
          {PARTS.map(([k, label]) => (
            <label key={k}>
              <input type="checkbox" checked={on(k)} onChange={() => toggle(k)} />
              {label}
            </label>
          ))}
        </div>
      </Toolbar>
      {drafts > 0 && (
        <div className={p.hint}>
          {drafts} draft{drafts === 1 ? ' is' : 's are'} in this pack marked DRAFT. Issue{' '}
          {drafts === 1 ? 'it' : 'them'} in Client Billing to make the pack final.
        </div>
      )}
      {sheets.length ? (
        <div className={p.pack}>{sheets}</div>
      ) : (
        <div className={p.hint}>Nothing to print for these choices yet.</div>
      )}
    </div>
  );
}

/** One official receipt (on the top half of an A4 sheet). */
export function PrintReceiptPage() {
  const { id = '' } = useParams();
  const receipt = useReceipt(id);
  const company = useCompany();
  useEffect(() => {
    if (receipt.data) document.title = `${receipt.data.receiptNo} — Grateful Solutions`;
  }, [receipt.data]);
  useAutoPrint(!!receipt.data && !company.isLoading);
  if (receipt.isLoading || company.isLoading) return <div className={s.page}>Loading…</div>;
  if (!receipt.data) return <div className={s.page}>Receipt not found.</div>;
  return (
    <div className={s.page}>
      <Toolbar />
      <div className={`${s.sheet} ${p.receiptSheet}`}>
        <ReceiptBlock r={receipt.data} c={company.data ?? {}} />
      </div>
    </div>
  );
}

/** Account statement, laid out like the Excel ST-INV / STA-DN sheets. */
export function StatementSheet({
  client,
  month,
  st,
  c,
}: {
  client: BillingClient;
  month: string;
  st: BillingStatement;
  c: CompanyInfo;
}) {
  const inv = st.kind === 'INVOICE';
  // Columns before Currency and Amount: No, Date, (INV, DIS | DN), REF.
  const before = inv ? 5 : 4;
  // The Excel sheets' headings: ST-INV in mixed case, STA-DN in capitals.
  const heads = inv
    ? ['No:', 'Date', 'INV Number', 'DISBURSEMENT', 'REF #', 'Currency', 'Amount']
    : ['NO:', 'DATE', 'DN NUMBER', 'REF NO:', 'CURRENCY', 'AMOUNT'];
  const total = (label: ReactNode, value: string, cls?: string) => (
    <tr className={cls}>
      <td />
      <td colSpan={before - 1}>{label}</td>
      <td />
      <td className={p.r}>{money3(value)}</td>
    </tr>
  );
  return (
    <>
      {/* Printed for checking before the documents are issued. */}
      {st.drafts > 0 && <div className={s.stamp}>DRAFT</div>}
      {/* As in the Excel: ST-INV has the invoice's letterhead, STA-DN none at all. */}
      {inv && <Masthead c={c} />}
      <div className={p.stTitle}>Account Statement</div>
      <div className={p.stPeriod}>Date: {periodRange(month)}</div>
      <div className={p.billTo}>
        <b>{(client.legalName ?? client.name).toUpperCase()}</b>
        {client.address?.toUpperCase()}
      </div>
      {/* Laid out like the Excel ST-INV / STA-DN: a boxed table, ruled heading cells, open
          rows, then the balance between a thin and a heavy rule. */}
      <table className={p.stTable}>
        <thead>
          <tr>
            {heads.map((t) => (
              <th key={t}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {st.lines.map((l, i) => (
            <tr key={i}>
              <td className={p.c}>{i + 1}</td>
              <td className={p.c}>{shortDate(l.date)}</td>
              {inv ? (
                <>
                  {/* A shipment billed on its disbursement only has no tax invoice: "NON". */}
                  <td className={p.c}>{l.invNo || 'NON'}</td>
                  <td className={p.c}>{l.disNo ?? ''}</td>
                </>
              ) : (
                <td className={p.c}>{l.dnNo}</td>
              )}
              <td className={p.c}>{l.ref ?? 'NON'}</td>
              <td className={p.c}>USD</td>
              <td className={p.r}>{money3(l.amount)}</td>
            </tr>
          ))}
          <tr className={p.stGap}>
            <td colSpan={before + 2} />
          </tr>
          {total(
            <>
              BALANCE AS <span className={p.stPeriodCode}>{periodCode(month)}</span>
            </>,
            st.total,
            p.balanceRow,
          )}
        </tbody>
      </table>
    </>
  );
}

/** A receipt not recorded yet: printed in advance for a statement's balance, filled in by hand. */
export type ReceiptView = Omit<OfficialReceipt, 'paymentMethod'> & {
  paymentMethod: OfficialReceipt['paymentMethod'] | null;
  /** True for the advance copy: no number, method or signer yet. */
  pending?: boolean;
  /** Its statement still has drafts: printed marked DRAFT. */
  draft?: boolean;
};

/** The month's last day (2026-09 → 2026-09-30), the date on the Excel's OR-INV sheet. */
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
};

/**
 * A statement's receipts: those recorded (not void), then — while something is still due —
 * one for the balance, so it can be printed and handed over before the client pays.
 */
export function statementReceipts(
  d: BillingPack,
  month: string,
  kind: StatementKind,
): ReceiptView[] {
  const st = d.statements[kind];
  const draft = st.drafts > 0;
  const list: ReceiptView[] = st.receipts
    .filter((r) => r.status === 'ISSUED')
    .sort((a, b) => a.receiptNo.localeCompare(b.receiptNo))
    .map((r) => ({ ...r, draft }));
  if (Number(st.balance) > 0)
    list.push({
      id: `pending-${kind}`,
      receiptNo: '',
      clientId: d.client.id,
      clientCode: d.client.code,
      clientName: d.client.name,
      receivedFrom: (d.client.legalName ?? d.client.name).toUpperCase(),
      month,
      kind,
      receiptDate: monthEnd(month),
      amount: st.balance,
      paymentMethod: null,
      paymentRef: null,
      note: null,
      status: 'DRAFT',
      createdByName: null,
      createdAt: '',
      pending: true,
      draft,
    });
  return list;
}

/**
 * Official receipt (A5 landscape), like the Excel OR-INV sheet, amount in words generated.
 * As on that sheet, the debit-note receipt has no letterhead (logo and company details).
 */
export function ReceiptBlock({ r, c }: { r: ReceiptView; c: CompanyInfo }) {
  // As on the Excel OR-INV sheet: the invoices receipt has the letterhead, the DN one none.
  const letterhead = r.kind !== 'DEBIT_NOTE';
  return (
    <div className={p.receipt}>
      {r.status === 'VOID' ? (
        <div className={p.void}>CANCELLED</div>
      ) : (
        r.draft && <div className={p.void}>DRAFT</div>
      )}
      {letterhead && <Masthead c={c} compact />}
      <div className={p.rcTitle}>OFFICIAL RECEIPT</div>
      <div className={p.rcGrid}>
        <span className={p.rcLabel}>Received from</span>
        <span className={p.rcField}>
          <b>{r.receivedFrom}</b>
        </span>
        <span className={p.rcSide}>
          <span>Date:</span>
          <span className={p.rcField}>{receiptDate(r.receiptDate)}</span>
        </span>

        <span className={p.rcLabel}>Amount</span>
        <span className={`${p.rcField} ${p.rcAmount}`}>
          <b>$</b>
          <b>{money(r.amount)}</b>
        </span>

        <span className={p.rcLabel}>Amount in word</span>
        <span className={`${p.rcField} ${p.rcWide}`}>{amountInWords(r.amount)}</span>

        <span className={p.rcLabel}>Received for</span>
        <span className={`${p.rcField} ${p.rcShort}`}>
          {periodCode(r.month)}
          {r.note ? ` · ${r.note}` : ''}
        </span>

        <span className={p.rcLabel}>Payment Method</span>
        <span className={`${p.rcField} ${p.rcMethods}`}>
          {(Object.keys(RECEIPT_METHOD) as PaymentMethod[]).map((m) => (
            <span key={m}>
              <span className={p.box}>{r.paymentMethod === m ? '✓' : ''}</span>
              {RECEIPT_METHOD[m]}
            </span>
          ))}
          {r.paymentRef && <span>REF: {r.paymentRef}</span>}
        </span>
      </div>
      <div className={p.rcRule} />
      <div className={p.rcSign}>
        <div>Received by:</div>
        <div className={letterhead ? p.rcSigned : p.rcSignedBold}>Authorized Signature</div>
      </div>
    </div>
  );
}

/** The checklist's rows (sheet and Excel): each shipment's issued documents, then the rest. */
export function checklistRows(pack: BillingPack, month: string) {
  const issued = (list: { number: string | null; status: string }[]) =>
    list.filter((x) => x.status === 'ISSUED').map((x) => x.number ?? '');
  const rows: { doc: string; declare: string; date: string }[] = [];
  for (const r of pack.rows) {
    const docs = [
      ...issued(r.docs['tax-invoices']),
      ...issued(r.docs.disbursements),
      ...issued(r.docs['debit-notes']),
    ];
    if (docs.length) rows.push({ doc: docs.join(' · '), declare: r.declareNo, date: r.invDate });
  }
  for (const o of pack.others.filter((x) => x.status === 'ISSUED'))
    rows.push({
      doc: `${o.number ?? ''}${o.reference ? ` (${o.reference})` : ''}`,
      declare: '',
      date: o.date,
    });
  for (const kind of ['INVOICE', 'DEBIT_NOTE'] as const)
    if (pack.statements[kind].lines.length)
      rows.push({
        doc: `${periodCode(month)} ACCOUNT STATEMENT (${STATEMENT_TITLE[kind].toUpperCase()})`,
        declare: '',
        date: '',
      });
  for (const r of [...pack.statements.INVOICE.receipts, ...pack.statements.DEBIT_NOTE.receipts])
    if (r.status === 'ISSUED')
      rows.push({ doc: `${r.receiptNo} (OFFICIAL RECEIPT)`, declare: '', date: r.receiptDate });
  return rows;
}

/** "IMP & EXP SHIPMENT-CHECKING LIST": the originals handed to the client, to sign for. */
export function ChecklistSheet({
  pack,
  month,
  c,
  preparedBy,
}: {
  pack: BillingPack;
  month: string;
  c: CompanyInfo;
  preparedBy: string;
}) {
  const rows = checklistRows(pack, month);
  const clientName = (pack.client.legalName ?? pack.client.name).toUpperCase();
  return (
    <>
      <div className={p.clMeta}>
        <div>
          <b>From:</b> {c.nameEn}
        </div>
        <div>
          <b>Date:</b> {dmy(today())}
        </div>
        <div>
          <b>To:</b> {clientName}
        </div>
        <div />
        <div className={p.clSubject}>
          Subject: IMP &amp; EXP SHIPMENT-CHECKING LIST · {periodCode(month)}
        </div>
      </div>
      <table className={p.clTable}>
        <thead>
          <tr>
            <th style={{ width: 40 }}>No</th>
            <th>DOC NO</th>
            <th>DECLARE NO</th>
            <th>DATE</th>
            <th>REMARK</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={p.c}>{i + 1}</td>
              <td>{r.doc}</td>
              <td className={p.c}>{r.declare}</td>
              <td className={p.c}>{r.date ? dmy(r.date) : ''}</td>
              <td className={p.c}>ORIGINAL</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={p.clTotal}>TOTAL: {rows.length}</div>
      <div className={p.clSigns}>
        <div>
          <b>PREPARED BY:</b>
          NAME: {preparedBy}
          <br />
          DATE: {dmy(today())}
          <br />
          SIGNATURE: <span className={p.blank} />
        </div>
        <div>
          <b>RECEIVED BY: {clientName}</b>
          NAME: <span className={p.blank} />
          <br />
          DATE: <span className={p.blank} />
          <br />
          SIGNATURE: <span className={p.blank} />
        </div>
      </div>
    </>
  );
}
