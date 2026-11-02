import type { ReactNode } from 'react';
import { hoursLabel, type CapacityModel } from './capacity';
import s from './CapacitySheet.module.css';

const n0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const n2 = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (v: number) => (v ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '-');
const year = (month: string) => month.slice(0, 4);
const DOTS =
  '......................................................................................................................';

/** A numbered point: "១០)" heading on its own line, body under it. */
function Point({ no, title, children }: { no: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className={s.point}>
      <div className={s.pointHead}>
        {no}) {title}
      </div>
      {children}
    </section>
  );
}

/**
 * The capacity report on A4, laid out like the factory's monthly sheet (JR-08): Khmer headings,
 * points 1–12 and the signature blocks. Black on white whatever the app theme.
 */
export function CapacitySheet({ m }: { m: CapacityModel }) {
  const p = m.profile;
  return (
    <article className={s.sheet}>
      <header className={s.kingdom}>
        <div>ព្រះរាជាណាចក្រកម្ពុជា</div>
        <div>ជាតិ សាសនា ព្រះមហាក្សត្រ</div>
      </header>
      <div className={s.ministry}>
        <div>ក្រសួងពាណិជ្ជកម្ម</div>
        <div>អគ្គនាយកដ្ឋានសេវាពាណិជ្ជកម្ម</div>
        <div>នាយកដ្ឋាននាំចេញ-នាំចូល</div>
      </div>
      <div className={s.title}>
        <div className={s.muol}>របាយការណ៍</div>
        <div className={s.muol}>ស្តីពី</div>
        <div>{m.titleKh}</div>
      </div>

      <div className={s.kv}>
        <span>១) ឈ្មោះរោងចក្រ</span>
        <b>{p.companyName}</b>
        <span className={s.indent}>មានទីតាំងនៅ</span>
        <span>
          {p.address1}
          {p.address2 && <br />}
          {p.address2}
        </span>
        <span>២) លេខទូរស័ព្ទ</span>
        <span>{p.phone}</span>
        <span>៣) លេខ និងកាលបរិច្ឆេទចុះបញ្ជី</span>
        <span>
          {p.registration}
          {p.registrationDate && <> &nbsp; Date: {p.registrationDate}</>}
        </span>
      </div>

      <Point no="៤" title="សមត្ថភាពការងារ">
        <table className={s.plain}>
          <tbody>
            {m.staff.map((r) => (
              <tr key={r.labelKh}>
                <td className={s.label}>- {r.labelKh}</td>
                <td>ប្រុស</td>
                <td className={s.num}>{r.male}</td>
                <td>នាក់</td>
                <td>ស្រី</td>
                <td className={s.num}>{r.female}</td>
                <td>នាក់</td>
                <td>សរុប</td>
                <td className={s.num}>{r.total}</td>
                <td>នាក់</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Point>

      <Point no="៥" title="ប្រាក់បៀវត្ស">
        <table className={s.plain}>
          <tbody>
            {m.salaries.map((r) => (
              <tr key={r.labelKh}>
                <td className={s.label}>- {r.labelKh}</td>
                <td className={s.num}>{n2(r.amount)}</td>
                <td>ដុល្លាអាមេរិក</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Point>

      <Point no="៦" title="ម៉ោងការងារ">
        <div className={s.line}>
          + ម៉ោងធ្វើការងារ &nbsp; {p.regularTime} &nbsp; ម៉ោងធ្វើការសរុបប្រចាំខែ{' '}
          <b>{p.regularHours}</b>
        </div>
        <div className={s.line}>
          + ម៉ោងបន្ថែម &nbsp; {p.overtimeTime} &nbsp; ថែមម៉ោងសរុបប្រចាំខែ <b>{p.overtimeHours}</b>
        </div>
      </Point>

      <Point no="៧" title="ប្រភេទវត្ថុធាតុដើមនាំចូលមាន">
        <div className={s.line}>
          + ប្រភេទ &nbsp; {m.materials || '…'} &nbsp; នាំមកពីប្រទេស: {m.materialOrigins || '…'}
        </div>
      </Point>

      <Point no="៨" title="ទិសដៅនាំចេញៈ">
        <div className={s.line}>+ {m.destinations || '…'}</div>
        <div className={s.line}>
          + Category. &nbsp; {p.categories || '…'} &nbsp; (សរសេរលេខ Cat ជាភាសារខ្មែរ)
        </div>
      </Point>

      <Point no="៩" title="មធ្យោបាយបំរើផលិតកម្មៈ">
        <table className={s.plain}>
          <tbody>
            {m.machines.map((x, i) => (
              <tr key={i}>
                <td className={s.label}>+ {x.labelKh}</td>
                <td>{x.labelEn && `(${x.labelEn})`}</td>
                <td>សរុប</td>
                <td className={s.num}>{x.total}</td>
                <td>{x.unitKh}</td>
                <td>ដំណើរការ</td>
                <td className={s.num}>{x.working}</td>
                <td>គ្រឿង</td>
              </tr>
            ))}
            <tr className={s.bold}>
              <td />
              <td className={s.right}>ចំនួនសរុប</td>
              <td />
              <td className={s.num}>{m.machinesTotal}</td>
              <td>គ្រឿង</td>
              <td>ដំណើរការ</td>
              <td className={s.num}>{m.machinesWorking}</td>
              <td>គ្រឿង</td>
            </tr>
          </tbody>
        </table>
      </Point>

      <Point no="១០" title="ការវាយតម្លៃសមត្ថភាពផលិតកម្ម (Production Capacity)">
        <table className={s.grid}>
          <thead>
            <tr>
              <th colSpan={2} rowSpan={2}>
                ប្រភេទផលិតផល<small>Kind of Products</small>
              </th>
              <th rowSpan={2}>
                ប្រភេទវត្ថុធាតុដើម<small>Kind of Materials</small>
              </th>
              <th colSpan={2}>
                សមត្ថភាពផលិត<small>Production Capacity</small>
              </th>
              <th rowSpan={2}>
                សរុបប្រចាំថ្ងៃ<small>Total Per Day PCS</small>
              </th>
              <th rowSpan={2}>
                សរុបប្រចាំខែ<small>Total Per Month</small>
              </th>
            </tr>
            <tr>
              <th>
                ម៉ោង<small>Hour</small>
              </th>
              <th>
                ចំនួនផលិតផល<small>Quantity</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={`${r.key}|${r.overtime}`}>
                <td>{r.kind}</td>
                <td>{r.product}</td>
                <td>{r.material}</td>
                <td>{hoursLabel(r.hoursPerDay)}</td>
                <td>{n0(r.perHour)}</td>
                <td>{n2(r.perDay)}</td>
                <td>{n0(r.perMonth)} PCS</td>
              </tr>
            ))}
            {m.rows.length === 0 && (
              <tr>
                <td colSpan={7}>No exports invoiced this month.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Point>

      <Point no="១១" title="ការវាយតម្លៃលើបទដ្ឋានផលិតកម្ម (Production Norm)">
        <table className={s.grid}>
          <thead>
            <tr>
              <th colSpan={2} rowSpan={2}>
                ប្រភេទផលិតផល<small>Kind of Products</small>
              </th>
              <th rowSpan={2}>
                ប្រភេទវត្ថុធាតុដើម<small>Kind of Materials</small>
              </th>
              <th colSpan={2}>
                បទដ្ឋានផលិត<small>Products Norm</small>
              </th>
              <th rowSpan={2}>
                ចំនួនសរុប<small>Total Quantity</small>
              </th>
              <th rowSpan={2}>
                ទម្ងន់សរុប<small>Total Weight</small>
              </th>
            </tr>
            <tr>
              <th>
                ទម្ងន់ក្នុងមួយឡូតិ៍<small>A Dozen Weight</small>
              </th>
              <th>
                ទម្ងន់មួយឯកត្តា<small>A Unit Weight</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={`${r.key}|${r.overtime}`}>
                <td>{r.kind}</td>
                <td>{r.product}</td>
                <td>{r.material}</td>
                <td>{n3(r.dozenWeight)}</td>
                <td>{n3(r.unitWeight)}</td>
                <td>{n0(r.perMonth)}</td>
                <td>{r.unitWeight ? n2(r.totalWeight) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Point>

      <Point no="១២" title="សេចក្តីសន្និដ្ឋានៈ">
        {p.conclusion ? (
          <p className={s.para}>{p.conclusion}</p>
        ) : (
          <p className={s.para}>
            {DOTS}
            <br />
            {DOTS}។
          </p>
        )}
        <p className={s.para}>
          ការចុះពិនិត្យវាយតម្លៃលទ្ធភាពផលិត និងបទដ្ឋានផលិតខាងលើ ពិតជាបានចុះផ្ទាល់ដល់រោងចក្រ
          និងបានជួបជាមួយ ឈ្មោះ {p.informantName || '..................'} ជា
          {p.informantTitle || '..........'} ជាអ្នកផ្តល់ពត៌មានចូលរួមសហការណ៍
          និងឯកភាពតាមរបាយការណ៍វាយតម្លៃរបស់មន្រ្តី ។
        </p>
        <p className={s.para}>
          អាស្រ័យដូចបានជម្រាបខាងលើសូម ឯកឧត្តម ប្រធានមេត្តាជ្រាបជាពត៌មាន និងមតិណែនាំតាមការគួរ។
        </p>
      </Point>

      <div className={s.signs}>
        <div>
          <div>ថ្ងៃទី...........ខែ....... ឆ្នាំ {year(m.month)}</div>
          <div>អ្នកផ្តល់ពត៌មានពីរោងចក្រ</div>
          <div className={s.signName}>{p.informantName}</div>
        </div>
        <div>
          <div>ថ្ងៃទី...........ខែ....... ឆ្នាំ {year(m.month)}</div>
          <div>មន្រ្តីសម្រង់ពត៌មាន</div>
          <div className={s.signName}>{p.officerName}</div>
        </div>
      </div>
      <div className={s.approve}>
        <div className={s.muol}>ឯកភាព</div>
        <div>ថ្ងៃទី..........ខែ..... ឆ្នាំ {year(m.month)}</div>
        <div className={s.signName}>{p.approverName}</div>
      </div>
    </article>
  );
}
