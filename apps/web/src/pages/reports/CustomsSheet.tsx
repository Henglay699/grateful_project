import type { CustomsModel } from './importExport';
import s from './CustomsSheet.module.css';

const n = (v: number, dp: number) =>
  v ? v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '-';
const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
/** "2026-08-21" → "21-Aug-26", as the sheet shows it. */
const day = (iso: string) =>
  `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;

/**
 * The import or export report on A4 portrait, laid out like the factory's workbook: Khmer and
 * English headings, one row per invoice line, the total and the signature. Black on white
 * whatever the app theme; the column headings repeat on every printed page.
 */
export function CustomsSheet({ m }: { m: CustomsModel }) {
  const imp = m.direction === 'IMPORT';
  // Exports: whole pieces and unit values to 3 places, as on the sheet.
  const qtyDp = imp ? 2 : 0;
  const unitDp = imp ? 2 : 3;
  return (
    <article className={s.sheet}>
      <h1 className={s.title}>{m.titleKh}</h1>
      <p className={s.subtitle}>{m.subtitleKh}</p>
      <table className={s.table}>
        <colgroup>
          <col style={{ width: '5%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col />
          <col style={{ width: '8%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '11%' }} />
        </colgroup>
        <thead>
          <tr className={s.kh}>
            <th>ល.រ</th>
            <th>លេខប្រតិវេតន៍គយ</th>
            <th>កាលបរិច្ឆេទ</th>
            <th>មុខទំនិញ</th>
            <th>ឯកតា</th>
            <th>{m.qtyHeadKh}</th>
            <th>ទម្ងន់សុទ្ធ</th>
            <th>ទម្ងន់សរុប</th>
            <th>តម្លៃគិតពន្ធគយ</th>
          </tr>
          <tr className={s.en}>
            <th>No.</th>
            <th>Customs Declaration No.</th>
            <th>Customs Declaration Date</th>
            <th>Description of Goods</th>
            <th>Unit</th>
            <th>Quantity</th>
            <th>
              Net Weight
              <br />
              (Kgs.)
            </th>
            <th>
              Gross Weight
              <br />
              (Kgs.)
            </th>
            <th>
              Customs Value
              <br />
              (USD)
            </th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.no}>
              <td className={s.c}>{r.no}</td>
              <td className={s.c}>{r.declareNo}</td>
              <td className={s.c}>{day(r.declareDate)}</td>
              <td className={s.c}>{r.goods}</td>
              <td className={s.r}>{n(r.unitValue, unitDp)}</td>
              <td className={s.r}>{n(r.qty, qtyDp)}</td>
              <td className={s.r}>{n(r.netWeightKg, 2)}</td>
              <td className={s.r}>{n(r.grossWeightKg, 2)}</td>
              <td className={s.r}>{n(r.value, 2)}</td>
            </tr>
          ))}
          {!m.rows.length && (
            <tr>
              <td colSpan={9} className={s.c}>
                —
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className={s.total}>
            <td colSpan={5}>{m.totalLabel}</td>
            <td>{n(m.totals.qty, qtyDp)}</td>
            <td>{n(m.totals.netWeightKg, 2)}</td>
            <td>{n(m.totals.grossWeightKg, 2)}</td>
            <td>{n(m.totals.value, 2)}</td>
          </tr>
        </tfoot>
      </table>
      <div className={s.sign}>
        <div>{m.signDateKh}</div>
        <div>{m.signer.title}</div>
        <div className={s.name}>{m.signer.name}</div>
      </div>
    </article>
  );
}
