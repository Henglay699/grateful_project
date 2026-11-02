import type { CoBreakdownInput } from '@gs/shared';
import type { BreakdownSheet as Figures } from './breakdown';
import s from './BreakdownSheet.module.css';

/** What the sheet prints: the inputs, the worked-out figures and the company's letterhead. */
export interface BreakdownModel {
  company: { name: string; address: string; phone: string };
  invoiceNo: string;
  input: CoBreakdownInput;
  figures: Figures;
}

const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
/** "2026-10-08" → "8-Oct-26", as the sheet shows it. */
const day = (iso: string | null) =>
  iso ? `${Number(iso.slice(8, 10))}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}` : '';
const n = (v: number, dp = 2) =>
  v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const usd = (v: number, dp = 2) => `USD ${n(v, dp)} / PCS`;
const pct = (v: number) => `${n(v * 100)}%`;

/** A numbered "(1)…(6)" table of the suggested format, with its total line under it. */
function SuggestedTable({
  originHead,
  rows,
  total,
}: {
  originHead: [string, string];
  rows: { desc: string; origin?: string; qty?: string; unit?: string; total: string }[];
  total: { label: string; sub?: string; value: string };
}) {
  return (
    <>
      <table className={s.grid}>
        <colgroup>
          <col style={{ width: '24%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '19%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr>
            {['(1)', '(2)', '(3)', '(4)', '(5)', '(6)'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
          <tr>
            <th>Description</th>
            <th>
              {originHead[0]}
              <br />
              {originHead[1]}
            </th>
            <th>
              Quantity / no. of Pieces
              <br />
              Consumed per Unit of
              <br />
              Finished Product
            </th>
            <th>
              Unit
              <br />
              cost of Item in col
              <br />
              (1)
            </th>
            <th>
              Total Cost
              <br />
              col (3) x Col (4)
            </th>
            <th>Reference No of Supporting Invoices Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.desc}>
              <td>{r.desc}</td>
              <td className={s.c}>{r.origin ?? ''}</td>
              <td className={s.c}>{r.qty ?? ''}</td>
              <td className={s.c}>{r.unit ?? ''}</td>
              <td className={s.c}>{r.total}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <div className={s.totalLine}>
        <div>
          {total.label}
          {total.sub && <div>{total.sub}</div>}
        </div>
        <b>{total.value}</b>
      </div>
    </>
  );
}

/**
 * CO → Breakdown: the BREAKDOWN workbook's AB sheet on three A4 portrait pages, black on white
 * whatever the app theme: the cost breakdown for the GSP application, then the suggested
 * format of the ex-factory cost, ex-factory price and FOB price.
 */
export function BreakdownSheet({ m }: { m: BreakdownModel }) {
  const { input: b, figures: f, company } = m;
  const lines: {
    no: number;
    desc: string;
    origin: string;
    kg?: string;
    unit?: string;
    total: number;
  }[] = [
    {
      no: 1,
      desc: b.fabricName,
      origin: b.fabricOrigin,
      kg: n(f.kgPerPcs),
      unit: n(f.fabricUnitCost),
      total: f.fabric,
    },
    { no: 2, desc: 'ACCESSORIES', origin: b.accessoriesOrigin, total: f.accessories },
    { no: 3, desc: 'LOCAL OPERATIONAL', origin: 'Cambodia', total: f.local },
    { no: 4, desc: 'OVERHEAD', origin: 'Cambodia', total: f.overhead },
    { no: 5, desc: 'PROFIT', origin: '', total: f.profit },
  ];
  const tenth = usd(f.tenth, 3);
  const exFactoryCost = f.fabric + f.accessories + f.local + f.overhead;

  return (
    <div className={s.sheets}>
      <article className={s.page}>
        <header className={s.letterhead}>
          <h1>{company.name}</h1>
          {company.address && <p>{company.address}</p>}
          {company.phone && <p>Tel: {company.phone}</p>}
        </header>
        <h2 className={s.title}>
          BREAKDOWN COST OF FINISHED PRODUCTS
          <br />
          FOR GSP QUALIFY APPLICATION
        </h2>
        <dl className={s.facts}>
          <dt>HTS CODE:</dt>
          <dd>
            <b className={s.arial}>{b.htsCode}</b>
            <span className={s.factDate}>DATE: {day(b.date)}</span>
          </dd>
          <dt>KINDS OF THE PRODUCTS.:</dt>
          <dd>{b.kinds}</dd>
          <dt>P.O NO.#:</dt>
          <dd>{b.poNo}</dd>
          <dt>STYLE NO.:</dt>
          <dd>{b.styleNo}</dd>
          <dt>TOTAL Q&apos;TY SHIPPED.:</dt>
          <dd>
            <b>{n(f.qty, 0)} PCS</b>
          </dd>
          <dt>N.N.W.:</dt>
          <dd>
            <b>{n(f.netWeightKg)} KGS</b>
          </dd>
        </dl>
        <table className={s.grid}>
          <colgroup>
            <col style={{ width: '9%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>NO.</th>
              <th>
                DESCRIPTION
                <br />
                OF CONTENT
              </th>
              <th>ORIGIN</th>
              <th>
                UNIT/PCS
                <br />
                (KGS)
              </th>
              <th>
                UNIT COST
                <br />
                (USD)
              </th>
              <th>
                TOTAL COST
                <br />
                (USD)
              </th>
              <th>REMARKS</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.no}>
                <td className={s.c}>{l.no}</td>
                <td>{l.desc}</td>
                <td>{l.origin}</td>
                <td className={s.c}>{l.kg ?? ''}</td>
                <td className={s.c}>{l.unit ?? ''}</td>
                <td className={s.r}>{n(l.total)}</td>
                <td />
              </tr>
            ))}
            <tr>
              <td />
              <td>SUB-TOTAL</td>
              <td />
              <td />
              <td />
              <td className={s.r}>{n(f.subTotal)}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={7} className={s.band}>
                EX-PRICE
              </td>
            </tr>
            <tr>
              <td className={s.c}>1</td>
              <td>TRANSPORT COST</td>
              <td />
              <td />
              <td />
              <td className={s.r}>{n(f.transport)}</td>
              <td />
            </tr>
            <tr className={s.fob}>
              <td />
              <td>TOTAL COST FOB</td>
              <td />
              <td />
              <td />
              <td className={s.r}>{n(f.fob)}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={7}>*LOCAL CONTENT: {pct(f.localContent)}</td>
            </tr>
          </tbody>
        </table>
        <p className={s.importLine}>* IMPORT: {pct(f.importContent)}</p>
        <div className={s.signs}>
          <div>
            <div>ACCOUNTANT</div>
            <div className={s.signName}>{b.accountant}</div>
          </div>
          <div>
            <div>DATE:</div>
            <div>GENERAL MANAGER</div>
            <div className={s.signName}>{b.manager}</div>
          </div>
        </div>
      </article>

      <article className={s.page}>
        <h2 className={s.title}>
          SUGGESTED FORMAT OF THE BREAKDOWN OF
          <br />
          THE EX-FACTORY COST, EX-FACTORY PRICE AND FOB PRICE
        </h2>
        <dl className={s.facts}>
          <dt>Kind of Garment :</dt>
          <dd>{b.kinds}</dd>
          <dt>Order No :</dt>
          <dd>{b.poNo}</dd>
        </dl>
        <h3 className={s.section}>
          1- Imported / foreign / Consigned Raw Materials, Parts of Components
          <br />
          (including those locally purchased but foreign origin)
        </h3>
        <SuggestedTable
          originHead={['Country of', 'Origin']}
          rows={[
            {
              desc: b.fabricName,
              origin: b.fabricOrigin,
              qty: `${n(f.kgPerPcs)} KGS / PCS`,
              unit: usd(f.fabricUnitCost),
              total: usd(f.fabric),
            },
            { desc: 'ACCESSORIES', origin: b.accessoriesOrigin, total: usd(f.accessories) },
          ]}
          total={{
            label:
              'TOTAL COST of imported / foreign / consigned raw materials, Parts of components',
            sub: '(including those locally purchased but of foreign origin)',
            value: usd(f.fabric + f.accessories),
          }}
        />
        <h3 className={s.section}>
          2. Materials, Parts or Components made by the Manufacturer / Exporter
          <br />
          and / or other Cambodia suppliers.
        </h3>
        <SuggestedTable
          originHead={['Country of', 'Origin']}
          rows={[
            { desc: 'Electric Power Oil', total: tenth },
            { desc: 'Diesel', total: tenth },
            { desc: 'Water', origin: 'Cambodia', total: tenth },
            { desc: 'Other', total: tenth },
          ]}
          total={{
            label:
              'TOTAL COST of materials, parts or components made by the Manufacturer / Exporter',
            sub: 'and / or by Cambodian supplier',
            value: usd(f.tenth * 4, 3),
          }}
        />
      </article>

      <article className={s.page}>
        <h3 className={s.section}>
          3. Cost of DIRECT LABOR in Cambodia
          <br />
          (Labor Cost directly attributable to the Manufacture of finished product)
        </h3>
        <SuggestedTable
          originHead={['labor', 'origin']}
          rows={[
            { desc: 'CUTTING', origin: 'CAMBODIA', total: tenth },
            { desc: 'SEWING', total: tenth },
            { desc: 'CHECKING', total: tenth },
            { desc: 'IRONING', total: tenth },
            { desc: 'OTHER', total: tenth },
          ]}
          total={{
            label: 'TOTAL COST OF DIRECT LABOR in Cambodia',
            sub: '(labor Cost directly attributable to the Manufacture of the finished product)',
            value: usd(f.tenth * 5, 3),
          }}
        />
        <ol className={s.items} start={4}>
          <li>
            <span>
              Other Direct Cost of Processing Operations (i.e., except direct labor) carried out in
              Cambodia which can reasonably be allocated to the manufacture of the finished product
              (e.g., machinery depreciation, cost of tooling, research development, quality control,
              etc…)
            </span>
            <b>{tenth}</b>
          </li>
          <li>
            <span>
              Overhead or General Expenses not directly attributable to the export product (e.g.
              administrative expenses, commissions, salaries of executives, etc..)
            </span>
            <b>{usd(f.overhead)}</b>
          </li>
          <li>
            <span>Ex-factory Cost of the finished product [ sum of Item (1) to (4) ]</span>
            <b>{usd(exFactoryCost, 3)}</b>
          </li>
          <li>
            <span>
              Ex-factory Price of the finished product [ sum of Item (1) to (5) plus profit ]
              <em className={s.profit}>profit {usd(f.profit, 3)}</em>
            </span>
            <b>{usd(f.subTotal)}</b>
          </li>
          <li>
            <span>
              Cost of Transportation / Trucking from the factory to the pier or frontier, including
              brokerage service and port handling expenses
            </span>
            <b>{usd(f.transport)}</b>
          </li>
          <li>
            <span>FOB Price [ Sum of (7) and (8) ]</span>
            <b>{usd(f.fob)}</b>
          </li>
        </ol>
        <div className={s.exporter}>
          <div className={s.signName}>{b.manager}</div>
          <div className={s.signLine}>Name and Signature of Exporter</div>
        </div>
      </article>
    </div>
  );
}
