import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { BILLING_DOC_TYPES, type BillingDoc, type BillingDocType } from '@gs/shared';
import { useCompany, useDoc, type CompanyInfo } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import s from './print.module.css';
import cn from './creditNote.module.css';
import rs from './recordSummary.module.css';
import { DebitNote, sheetClass, TaxOrDisbursement } from './InvoicePrint';
import { useAutoPrint } from './useAutoPrint';
import { exportInvoiceExcel, INVOICE_EXCEL_TYPES } from '../accounting/invoiceExport';
import './printFonts'; // Moul / Siemreap for the Record Summary letterhead

export { DebitNote, sheetClass, TaxOrDisbursement };

const money = (v: string | number | undefined | null) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const h = (d: BillingDoc, k: string) => d.header[k] ?? '';

/** Printable A4 view of a billing document. Use the browser's "Save as PDF" for a PDF. */
export function PrintDocPage() {
  const { type = '', id = '' } = useParams();
  const valid = (BILLING_DOC_TYPES as readonly string[]).includes(type);
  const doc = useDoc(type as BillingDocType, valid ? id : undefined);
  const company = useCompany();
  const lookups = useLookups();
  useAutoPrint(!!doc.data && !company.isLoading && !lookups.isLoading);
  useEffect(() => {
    if (doc.data) document.title = `${doc.data.number ?? type} — Grateful Solutions`;
  }, [doc.data, type]);
  if (!valid) return <div className={s.page}>Unknown document type.</div>;
  if (doc.isLoading || company.isLoading) return <div className={s.page}>Loading…</div>;
  if (!doc.data) return <div className={s.page}>Document not found.</div>;
  const d = doc.data;
  const c = company.data ?? {};
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        {INVOICE_EXCEL_TYPES.includes(d.type) && (
          <button
            type="button"
            className={s.btn}
            onClick={() => void exportInvoiceExcel(d, c).catch(() => alert('Export failed.'))}
          >
            Excel
          </button>
        )}
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <div className={sheetClass(d.type)}>
        {d.status !== 'ISSUED' && (
          <div className={s.stamp}>{d.status === 'VOID' ? 'CANCELLED' : d.status}</div>
        )}
        {type === 'tax-invoices' && <TaxOrDisbursement d={d} c={c} tax />}
        {type === 'disbursements' && <TaxOrDisbursement d={d} c={c} tax={false} />}
        {type === 'debit-notes' && <DebitNote d={d} c={c} />}
        {type === 'credit-notes' && <CreditNote d={d} />}
        {type === 'record-summaries' && <RecordSummary d={d} c={c} />}
      </div>
    </div>
  );
}

export function CompanyHead({ c, khmer = true }: { c: CompanyInfo; khmer?: boolean }) {
  return (
    <div className={s.head}>
      <img src="/logo.png" alt="" className={s.logo} />
      <div className={s.company}>
        {khmer && <div className={s.companyKm}>{c.nameKm}</div>}
        <div className={s.companyEn}>{c.nameEn}</div>
        <div className={s.companyMeta}>
          <span className={s.km}>លេខអត្តសញ្ញាណកម្ម អតប</span> (VATTIN) : {c.vattin}
        </div>
        {khmer && <div className={`${s.companyMeta} ${s.km}`}>អាស័យដ្ឋាន : {c.addressKm}</div>}
        <div className={s.companyMeta}>{c.addressEn}</div>
        <div className={s.companyMeta}>
          <span className={s.km}>លេខទូរស័ព្ទ</span>: {c.phone}
        </div>
      </div>
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-08-21 → 21-Aug-2026, as on the broker's voucher. */
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}-${MONTHS[Number(m) - 1]}-${y}` : iso;
};
/** 2420 → 2,420 and 1.5 → 1.5: no padded decimals. */
const plain = (v: string | number | null | undefined) =>
  v === '' || v === null || v === undefined
    ? ''
    : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * The label/value pairs in a Credit Noted's header, left and right columns. Shared by the
 * printed sheet and the Excel export so both always show the same thing.
 */
export function creditNoteHeader(d: BillingDoc, portName: string | undefined) {
  const refLabel =
    { HOUSE_BILL: 'HOUSE BILL', BILL_NO: 'Bl NO', HAWB_NO: 'HAWB NO' }[
      h(d, 'refType') as 'HOUSE_BILL'
    ] ?? 'REF';
  const left: [string, string][] = [
    ['BILL TO:', h(d, 'billTo')],
    ['ADDRESS:', h(d, 'address')],
    ['SHIPPER:', h(d, 'shipper')],
    ['PORT:', portName?.toUpperCase() ?? ''],
    ['CTNR:', h(d, 'containerNo')],
  ];
  const right: [string, string][] = [
    ['DECLARE NO:', h(d, 'declareNo')],
    [`${refLabel}:`, h(d, 'refNo')],
    ['DATE:', longDate(d.date)],
    ["Q'TY:", h(d, 'quantityText')],
    ['G.W:', h(d, 'grossWeightKg') && `${plain(h(d, 'grossWeightKg'))} KGS`],
    ['CBM:', plain(h(d, 'cbm'))],
  ];
  return { left, right };
}

/** Credit Noted sheet (no letterhead, like the broker's voucher); also the editor's live preview. */
export function CreditNote({ d }: { d: BillingDoc }) {
  const lookups = useLookups();
  const port = lookups.data?.ports.find((p) => p.id === h(d, 'portId'));
  const { left, right } = creditNoteHeader(d, port?.name);
  const kv = (rows: [string, string][], cls: string | undefined) => (
    <dl className={cls}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className={cn.cn}>
      <div className={cn.title}>CREDIT NOTED</div>
      <div className={cn.head}>
        {kv(left, cn.kv)}
        {kv(right, `${cn.kv} ${cn.right}`)}
      </div>
      <table className={cn.table}>
        <colgroup>
          <col style={{ width: '5%' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          {/* MARK: wide enough for a short note */}
          <col style={{ width: '27%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>NO</th>
            <th>DESCRIPTION</th>
            <th>Q&apos;TY</th>
            <th>SHIP</th>
            <th>PRICE</th>
            <th>SUBTOTAL</th>
            <th>MARK</th>
          </tr>
        </thead>
        <tbody>
          {pricedLines(d).map((l, i) => (
            <tr key={l.id}>
              <td className={cn.c}>{i + 1}</td>
              <td>{l.description}</td>
              <td className={cn.c}>{plain(l.qty)}</td>
              <td className={cn.c}>{l.unit}</td>
              <td className={cn.r}>{money(l.unitPrice)}</td>
              <td className={cn.r}>{money(l.subtotal)}</td>
              <td>{l.mark}</td>
            </tr>
          ))}
          <tr className={cn.total}>
            <td colSpan={4} />
            <td className={cn.r}>TOTAL:</td>
            <td className={cn.r}>{money(d.totals.total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** "IMPORT | BY SEA: CY / CY": the split the sheet and Excel draw the red bar at. */
export const SHIPMENT_SEPARATOR = ' | ';

/**
 * A Record Summary's header box, in reading order (left, right, left, right…). Shared by the
 * sheet and the Excel export so both always show the same thing.
 */
export function recordSummaryHeader(
  d: BillingDoc,
  port: string | undefined,
  forwarder: string | undefined,
): [string, string][] {
  const size = h(d, 'containerSize');
  return [
    [
      'SHIPMENT:',
      `${h(d, 'direction')}${SHIPMENT_SEPARATOR}${transportLabel(h(d, 'transportMode'), h(d, 'loadType'))}`,
    ],
    ['INVOICE NO:', h(d, 'invNo')],
    ['FACTORY:', d.clientName.toUpperCase()],
    ['DISBURSEMENT NO:', h(d, 'disNo')],
    ['PORT:', (port ?? '').toUpperCase()],
    ['DEBIT NOTE NO:', h(d, 'dnNo')],
    ['QUANTITY:', h(d, 'quantityText')],
    ['CTNR NO:', `${h(d, 'containerNo')}${size ? ` (${size.replace(/^(\d+)/, "$1' ")})` : ''}`],
    ['BL NO:', h(d, 'blNo')],
    ['GROSS WEIGHT:', h(d, 'grossWeightKg') && `${plain(h(d, 'grossWeightKg'))} KGS`],
    ['DECLARE NO:', h(d, 'declareNo')],
    // A number, or a note such as "NON" printed as typed.
    ['CBM:', Number.isFinite(Number(h(d, 'cbm'))) ? plain(h(d, 'cbm')) : h(d, 'cbm')],
    ['DATE:', d.date ? longDate(d.date) : ''],
    ['FORWARDER:', forwarder?.toUpperCase() ?? ''],
  ];
}

/** Record Summary sheet; also the Record Summary editor's live preview. */
export function RecordSummary({ d, c }: { d: BillingDoc; c: CompanyInfo }) {
  const lookups = useLookups();
  const port = lookups.data?.ports.find((p) => p.id === h(d, 'portId'));
  const fwd = lookups.data?.forwarders.find((f) => f.id === h(d, 'forwarderId'));
  const rows: [string, ReactNode][] = recordSummaryHeader(d, port?.name, fwd?.name).map(
    ([k, v]) => {
      if (k !== 'SHIPMENT:') return [k, v];
      const [dir, by] = v.split(SHIPMENT_SEPARATOR);
      return [
        k,
        <>
          {dir} <span className={rs.sep}>|</span> {by}
        </>,
      ];
    },
  );
  const amount = (v: string | number) => (Number(v) > 0 ? money(v) : '-');
  return (
    <div className={rs.rs}>
      <div className={rs.mast}>
        <img src="/logo.png" alt="" className={rs.logo} />
        <div className={rs.company}>
          <div className={rs.km}>{c.nameKm}</div>
          <div className={rs.en}>{c.nameEn}</div>
          <div className={rs.vat}>លេខអត្តសញ្ញាណកម្ម អតប (VATTIN) : {c.vattin}</div>
        </div>
      </div>
      <div className={rs.title}>RECORD SUMMARY</div>
      <div className={rs.box}>
        {rows.map(([k, v]) => (
          <div key={k} className={rs.row}>
            <div className={rs.lbl}>{k}</div>
            <div className={rs.val}>{v}</div>
          </div>
        ))}
      </div>
      <table className={rs.table}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>NO</th>
            <th>DESCRIPTION</th>
            <th style={{ width: 45 }}>Q&apos;TY</th>
            <th style={{ width: 55 }}>UNIT</th>
            <th style={{ width: 65 }}>PRICE</th>
            <th style={{ width: 80 }}>SUBTOTAL</th>
            <th style={{ width: 90 }}>MARK</th>
          </tr>
        </thead>
        <tbody>
          {pricedLines(d).map((l, i) => (
            <tr key={l.id}>
              <td className={rs.c}>{i + 1}</td>
              <td>{l.description}</td>
              <td className={rs.c}>{plain(l.qty)}</td>
              <td className={rs.c}>{l.unit}</td>
              <td className={rs.r}>{amount(l.unitPrice)}</td>
              <td className={rs.r}>{amount(l.subtotal)}</td>
              <td className={rs.c}>{l.mark}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={rs.sum}>
            <td colSpan={5} className={rs.r}>
              TOTAL:
            </td>
            <td className={rs.r}>{money(d.totals.total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** A record summary's or credit note's lines that have a price: an unpriced item stays off the sheet. */
export const pricedLines = (d: BillingDoc) => d.lines.filter((l) => Number(l.unitPrice) > 0);

/** SEA + FCL → "BY SEA: CY / CY", ROAD + LCL → "BY TRUCK: LCL", AIR → "BY AIR". */
export function transportLabel(mode: string, load: string): string {
  const by = `BY ${mode === 'ROAD' ? 'TRUCK' : mode}`;
  if (mode === 'AIR') return by;
  return load === 'FCL' ? `${by}: CY / CY` : load === 'LCL' ? `${by}: LCL` : by;
}
