import { Fragment } from 'react';
import {
  companyBanks,
  fmtVatPercent,
  DEFAULT_VAT_PERCENT,
  type BillingDoc,
  type BillingDocType,
} from '@gs/shared';
import type { CompanyInfo } from '../../features/accounting';
import './printFonts';
import s from './print.module.css';
import p from './invoicePrint.module.css';

/*
 * Tax invoice, disbursement and debit note laid out exactly like the accounting engine
 * (accounting-engine.html → #paper-tax, #paper-dis, #paper-dn), filled from the document.
 */

const h = (d: BillingDoc, k: string) => d.header[k] ?? '';
/** PKGS as printed: the quantity and its unit (629 CTNS). */
const pkgs = (d: BillingDoc) => [h(d, 'pkgs'), h(d, 'pkgsUnit')].filter(Boolean).join(' ');
const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const riel = (v: string | number | null | undefined) =>
  Math.round(Number(v ?? 0)).toLocaleString('en-US');
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** 2026-06-02 → 02-JUN-2026 (tax invoice / disbursement). */
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}-${MON[Number(m) - 1]}-${y}` : iso;
};
const kgs = (v: string) => (v ? `${money(v)} KGS` : '');
const cbm = (v: string) =>
  v ? `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 })} CBM` : '';
/** The VOLUME line: always "NON" for a shipment by air (no CBM), import or export. */
const volume = (d: BillingDoc) =>
  h(d, 'transportMode') === 'AIR' ? 'NON' : cbm(h(d, 'volumeCbm'));
/** 1 → "1", 3.3 → "3.3" (the debit note's Q'TY column). */
const plain = (v: string | number) =>
  Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });

/** The sheet's class: these three use the engine's own paper (padding and fonts). */
export function sheetClass(type: BillingDocType): string {
  if (type === 'tax-invoices' || type === 'disbursements') return `${s.sheet} ${p.sheetInvoice}`;
  if (type === 'debit-notes') return `${s.sheet} ${p.sheetDn}`;
  // Credit notes and record summaries: narrow side margins.
  return `${s.sheet} ${p.sheetNarrow}`;
}

/** Column widths shared by the line table and the totals under it. */
const COLS = [32, null, 55, 48, 70, 75, 65, 75] as const;
const ColGroup = () => (
  <colgroup>
    {COLS.map((w, i) => (
      <col key={i} style={w ? { width: w } : undefined} />
    ))}
  </colgroup>
);

/**
 * The letterhead: the logo on the left and, centred, the company name in Khmer and English,
 * VATTIN, address and phone (tax invoice, disbursement, invoices account statement).
 * `compact` — the official receipt's: only the English name and VATTIN.
 */
export function Masthead({ c, compact = false }: { c: CompanyInfo; compact?: boolean }) {
  if (compact)
    return (
      <div className={`${p.masthead} ${p.mastheadCompact}`}>
        <div className={p.logo}>
          <img src="/logo.png" alt="" />
        </div>
        <div className={p.companyEn}>{c.nameEn}</div>
        <div className={p.vattin}>( VATTIN ) : {c.vattin}</div>
      </div>
    );
  return (
    <div className={p.masthead}>
      <div className={p.logo}>
        <img src="/logo.png" alt="" />
      </div>
      <div className={p.companyKm}>{c.nameKm}</div>
      <div className={p.companyEn}>{c.nameEn}</div>
      <div className={p.vattin}>លេខអត្តសញ្ញាណកម្ម អតប (VATTIN) : {c.vattin}</div>
      <div className={p.address}>
        អាស័យដ្ឋាន : {c.addressKm}
        <br />
        លេខទូរស័ព្ទ: {c.phone}
      </div>
    </div>
  );
}

export function TaxOrDisbursement({ d, c, tax }: { d: BillingDoc; c: CompanyInfo; tax: boolean }) {
  // The invoice's own VAT percent (kept with it; Settings → Tax Management sets new ones).
  const vat = fmtVatPercent(d.header.vatRate ?? DEFAULT_VAT_PERCENT);
  const banks = companyBanks(c);
  return (
    <>
      <Masthead c={c} />

      <div className={p.titleBlock}>
        <div className={p.titleKm}>{tax ? 'វិក្កយបត្រអាករ' : 'វិក្កយបត្របង់ជំនួស'}</div>
        <div className={p.titleEn}>{tax ? 'TAX INVOICE' : 'DISBURSEMENT'}</div>
      </div>

      <div className={p.meta}>
        <div>
          <div>
            <span className={p.lblMuol}>ឈ្មោះអតិថិជន</span>
            <span className={p.custLbl}> / Customer:</span>
            <span className={p.custKm}>{h(d, 'customerNameKm')}</span>
          </div>
          <div className={p.custEn}>{h(d, 'customerNameEn')}</div>
          <div>
            <span className={p.metaLbl}>អាស័យដ្ឋាន / Address:</span>{' '}
            <span className={p.metaVal}>{h(d, 'customerAddress')}</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <span className={p.metaLbl}>លេខ អតប (VATTIN) :</span>{' '}
            <span className={p.metaVal}>{h(d, 'customerVattin')}</span>
          </div>
          <div className={p.ship}>SHIPPER: {h(d, 'shipper')}</div>
          <div className={p.ship}>CONSIGNEE: {h(d, 'consignee')}</div>
          <div className={p.ship}>HBL: {h(d, 'hbl')}</div>
          <div className={p.ship}>PKGS: {pkgs(d)}</div>
        </div>
        <div className={p.metaRight}>
          <div>
            <span className={p.metaLbl}>
              {tax ? 'លេខវិក្កយបត្រ / Invoice No:' : 'លេខផ្តល់ប័ត្រ / DIS-No:'}
            </span>{' '}
            <span className={p.metaVal}>{d.number}</span>
          </div>
          <div>
            <span className={p.metaLbl}>
              {tax ? 'កាលបរិច្ឆេទវិក្កយបត្រ / Invoice Date:' : 'ការបញ្ជូនផ្តល់ប័ត្រ / DIS-Date:'}
            </span>{' '}
            <span className={p.metaVal}>{longDate(d.date)}</span>
          </div>
          <div className={`${p.ship} ${p.shipGap}`}>GROSS WEIGHT: {kgs(h(d, 'grossWeightKg'))}</div>
          <div className={p.ship}>VOLUME: {volume(d)}</div>
          <div className={p.ship}>Container No: {h(d, 'containerNo')}</div>
          <div className={p.ship}>POL: {h(d, 'pol').toUpperCase()}</div>
          <div className={p.ship}>POD: {h(d, 'pod').toUpperCase()}</div>
          <div className={p.ship}>Exchange Rate: 1USD = {riel(h(d, 'exchangeRate'))} KHR</div>
        </div>
      </div>

      <table className={p.lines}>
        <ColGroup />
        <thead>
          <tr>
            <th>
              ល.រ
              <br />
              No
            </th>
            <th>
              បរិយាយមុខទំនិញ
              <br />
              Description
            </th>
            <th>
              បរិមាណ
              <br />
              Quantity
            </th>
            <th>
              ឯកតា
              <br />
              Unit
            </th>
            {/* Money columns, headings included, are right-aligned like their figures. */}
            <th className={p.r}>
              <span className={p.thStack}>
                ថ្លៃឯកតា
                <br />
                Unit Price
              </span>
            </th>
            <th className={p.r}>
              <span className={p.thStack}>
                សរុប
                <br />
                Sub Total
              </span>
            </th>
            <th className={p.r}>
              <span className={p.thStack}>
                {tax ? `អាករ ${vat}%` : 'អាករ (0%)'}
                <br />
                {tax ? `VAT (${vat}%)` : 'VAT (0%)'}
              </span>
            </th>
            <th className={p.r}>
              <span className={p.thStack}>
                ថ្លៃទំនិញ
                <br />
                Amount
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.id}>
              <td className={p.c}>{l.lineNo}</td>
              <td>{l.description}</td>
              <td className={p.c}>{money(l.qty)}</td>
              <td className={p.c}>{l.unit}</td>
              {/* Money right-aligned, as in Excel, so it lines up with the totals below. */}
              <td className={p.r}>{money(l.unitPrice)}</td>
              <td className={p.r}>{money(l.subtotal)}</td>
              <td className={p.r}>{tax ? money(l.vat) : '-'}</td>
              <td className={`${p.r} ${p.strong}`}>{money(tax ? l.amount : l.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className={p.totals}>
        <ColGroup />
        <tbody>
          {tax ? (
            <>
              <TaxTotal label="សរុប SUB TOTAL" khr={d.totals.subtotalKhr} usd={d.totals.subtotal} />
              <TaxTotal
                label={`អាករលើតម្លៃបន្ថែម (VAT ${vat}%)`}
                khr={d.totals.vatKhr}
                usd={d.totals.vat}
              />
              <TaxTotal
                label="សរុបរួម GRAND TOTAL"
                khr={d.totals.totalKhr}
                usd={d.totals.total}
                strong
              />
            </>
          ) : (
            <>
              <UsdTotal label="សរុប SUB TOTAL" value={money(d.totals.total)} />
              <UsdTotal label="អាករលើតម្លៃបន្ថែម (VAT 0%)" value="-" />
              <UsdTotal label="សរុបរួម GRAND TOTAL" value={money(d.totals.total)} strong />
            </>
          )}
        </tbody>
      </table>

      <div className={p.note}>
        Note: You can make payment by cross cheque to:
        <br />
        {banks[0]?.accountName}
        <br />
        or Deposit Cash/Cheque payment to bank as below:
        {banks.map((b, i) => (
          <Fragment key={i}>
            <br />
            {b.bankName}
            <br />
            AC/NAME: {b.accountName}
            <br />
            AC/NO: {b.accountNo}
          </Fragment>
        ))}
      </div>

      <div className={p.signs}>
        <div className={p.signCol}>
          <div className={p.signRule} />
          <div className={p.signLeft}>ហត្ថលេខា និង ឈ្មោះអ្នកទិញ</div>
          <div className={p.legend}>
            សម្គាល់ច្បាប់ដើមសម្រាប់អ្នកទិញច្បាប់ចម្លងសម្រាប់អ្នកលក់
            <br />
            Note : Original invoice for customer, copies invoice for seller
          </div>
        </div>
        <div className={p.signCol}>
          <div className={p.signRule} />
          <div className={p.signRight}>ហត្ថលេខា និង ឈ្មោះអ្នកលក់</div>
        </div>
      </div>
    </>
  );
}

function TaxTotal({
  label,
  khr,
  usd,
  strong,
}: {
  label: string;
  khr: string | undefined;
  usd: string;
  strong?: boolean;
}) {
  return (
    <tr>
      <td colSpan={3} className={p.label}>
        {label}
      </td>
      <td className={p.c}>KHR</td>
      <td />
      <td className={`${p.r}${strong ? ` ${p.strong}` : ''}`}>{riel(khr)}</td>
      {/* In the VAT column: right-aligned like the VAT figures above it. */}
      <td className={p.r}>USD</td>
      <td className={`${p.r}${strong ? ` ${p.strong}` : ''}`}>{money(usd)}</td>
    </tr>
  );
}

function UsdTotal({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td colSpan={6} className={p.label}>
        {label}
      </td>
      <td className={p.r}>USD</td>
      <td className={`${p.r}${strong ? ` ${p.strong}` : ''}`}>{value}</td>
    </tr>
  );
}

export function DebitNote({ d }: { d: BillingDoc; c?: CompanyInfo }) {
  // A debit note of no shipment (e.g. the monthly MIH / payroll fee) shows what it charges.
  const shipment = !!(h(d, 'hbl') || h(d, 'containerNo') || h(d, 'shipper'));
  return (
    <>
      <div className={p.dnHeadline}>DEBIT NOTE</div>
      {/* Laid out like the tax invoice's details, in English only. */}
      <div className={`${p.meta} ${p.dnMeta}`}>
        <div>
          <div>
            <span className={p.custLbl}>Customer: </span>
            <span className={p.custEn}>{h(d, 'billTo')}</span>
          </div>
          <div>
            <span className={p.metaLbl}>Address:</span>{' '}
            <span className={p.metaVal}>{h(d, 'address')}</span>
          </div>
          {shipment ? (
            <>
              <div className={p.ship}>SHIPPER: {h(d, 'shipper')}</div>
              <div className={p.ship}>CONSIGNEE: {h(d, 'consignee')}</div>
              <div className={p.ship}>HBL: {h(d, 'hbl')}</div>
              <div className={p.ship}>PKGS: {pkgs(d)}</div>
            </>
          ) : (
            <div className={p.ship}>CHARGE: {h(d, 'reference')}</div>
          )}
        </div>
        <div className={p.metaRight}>
          <div>
            <span className={p.metaLbl}>DN No:</span> <span className={p.metaVal}>{d.number}</span>
          </div>
          <div>
            <span className={p.metaLbl}>DN Date:</span>{' '}
            <span className={p.metaVal}>{longDate(d.date)}</span>
          </div>
          {shipment && (
            <>
              <div className={p.ship}>GROSS WEIGHT: {kgs(h(d, 'grossWeightKg'))}</div>
              <div className={p.ship}>VOLUME: {volume(d)}</div>
              <div className={p.ship}>Container No: {h(d, 'containerNo')}</div>
              <div className={p.ship}>POL: {h(d, 'pol').toUpperCase()}</div>
              <div className={p.ship}>POD: {h(d, 'pod').toUpperCase()}</div>
            </>
          )}
        </div>
      </div>

      <table className={p.dnTable}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>NO</th>
            <th>DESCRIPTION</th>
            <th style={{ width: 45 }}>Q&apos;TY</th>
            <th style={{ width: 55 }}>U/M</th>
            <th style={{ width: 75 }}>PRICE</th>
            <th style={{ width: 85 }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.id}>
              <td className={p.c}>{l.lineNo}</td>
              <td>{l.description}</td>
              <td className={p.c}>{plain(l.qty)}</td>
              <td className={p.c}>{l.unit}</td>
              <td className={p.r}>{money(l.unitPrice)}</td>
              <td className={p.r}>{money(l.subtotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={p.sum}>
            <td colSpan={4} className={p.r} style={{ paddingRight: 8 }}>
              GRAND TOTAL:
            </td>
            <td className={p.c}>USD</td>
            <td className={p.r} style={{ paddingRight: 8 }}>
              {money(d.totals.total)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className={p.dnFoot}>
        <div>Thank you for your supporting</div>
        <div>AUTHORIZED SIGNATURE</div>
      </div>
    </>
  );
}
