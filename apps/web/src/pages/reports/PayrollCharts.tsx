import { useState } from 'react';
import { Bar } from '../../components/bklit/charts/bar';
import { BarChart } from '../../components/bklit/charts/bar-chart';
import { BarXAxis } from '../../components/bklit/charts/bar-x-axis';
import { Gauge } from '../../components/bklit/charts/gauge';
import { Grid } from '../../components/bklit/charts/grid';
import { PieCenter } from '../../components/bklit/charts/pie-center';
import { PieChart } from '../../components/bklit/charts/pie-chart';
import { PieSlice } from '../../components/bklit/charts/pie-slice';
import { Ring } from '../../components/bklit/charts/ring';
import { RingCenter } from '../../components/bklit/charts/ring-center';
import { RingChart } from '../../components/bklit/charts/ring-chart';
import { ChartTooltip } from '../../components/bklit/charts/tooltip/chart-tooltip';
import { PatternLines } from '../../components/bklit/charts/visx-pattern';
import '../../components/bklit/bklit.css';
import { fmtMoney, fmtNum } from '../../lib/format';
import type { PayrollReport } from './payroll';
import s from './PayrollCharts.module.css';

/** Bklit's palette, one colour per staff category (foreign, Khmer, sewing, production). */
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
/** As on bklit.com, the last two slices are hatched in their colour. */
const HATCHED = [false, false, true, true];
const hatchId = (i: number) => `payroll-hatch-${i}`;
const usd = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } as const;

/**
 * Reports → Payroll → Charts: the open month drawn with Bklit UI charts — staff by category
 * (pie), female and male by department (bars), gross salary by category (rings) and net pay as
 * a share of gross (gauge). Hovering a legend row highlights its slice or ring.
 */
export function PayrollCharts({ r }: { r: PayrollReport }) {
  return (
    <div className={`bklit ${s.charts}`}>
      <div className={s.row}>
        <DepartmentBars r={r} />
        <CategoryPie r={r} />
      </div>
      <div className={s.row}>
        <SalaryRings r={r} />
        <NetGauge r={r} />
      </div>
    </div>
  );
}

function Card({
  title,
  sub,
  wide,
  children,
}: {
  title: string;
  sub: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`${s.card}${wide ? ` ${s.wide}` : ''}`}>
      <header>
        <h3>{title}</h3>
        <p>{sub}</p>
      </header>
      {children}
    </section>
  );
}

/** Swatch for a legend row: solid, or hatched like its slice. */
function Swatch({ i }: { i: number }) {
  const c = COLORS[i]!;
  return (
    <span
      className={s.swatch}
      style={{
        background: HATCHED[i]
          ? `repeating-linear-gradient(135deg, ${c} 0 2px, transparent 2px 5px)`
          : c,
        boxShadow: HATCHED[i] ? `inset 0 0 0 1px ${c}` : undefined,
      }}
    />
  );
}

function Hatches() {
  return (
    <>
      {COLORS.map((c, i) =>
        HATCHED[i] ? (
          <PatternLines
            key={i}
            id={hatchId(i)}
            width={6}
            height={6}
            stroke={c}
            strokeWidth={1.5}
            orientation={['diagonal']}
          />
        ) : null,
      )}
    </>
  );
}

function CategoryPie({ r }: { r: PayrollReport }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const data = r.byCategory.map((g, i) => ({
    label: g.labelKh ?? g.label,
    value: g.total,
    color: COLORS[i]!,
  }));
  return (
    <Card title="Staff by category" sub={`${fmtNum(r.totals.count)} staff this month`}>
      <div className={s.square}>
        <PieChart
          data={data}
          innerRadius={62}
          padAngle={0.02}
          cornerRadius={4}
          hoveredIndex={hovered}
          onHoverChange={setHovered}
        >
          <Hatches />
          {data.map((_, i) => (
            <PieSlice key={i} index={i} fill={HATCHED[i] ? `url(#${hatchId(i)})` : undefined} />
          ))}
          <PieCenter defaultLabel="Total staff" />
        </PieChart>
      </div>
      <ul className={s.legend}>
        {r.byCategory.map((g, i) => (
          <li
            key={g.key}
            data-hovered={hovered === i || undefined}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <Swatch i={i} />
            <span className={s.legendLabel}>
              <span className={s.kh}>{g.labelKh}</span> {g.label}
            </span>
            <b>{fmtNum(g.total)}</b>
            <span className={s.share}>
              {r.totals.count ? Math.round((g.total / r.totals.count) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DepartmentBars({ r }: { r: PayrollReport }) {
  // Capitalised keys: the tooltip shows them as the series names.
  const data = r.byDepartment.map((d) => ({
    dept: d.key,
    Female: d.female,
    Male: d.male,
    Total: d.total,
  }));
  return (
    <Card
      wide
      title="Female and male by department"
      sub="Grouped by the letters of the card no.; hatched bar = department total"
    >
      <BarChart data={data} xDataKey="dept" aspectRatio="2.4 / 1" barGap={0.28}>
        <PatternLines
          id="payroll-bar-hatch"
          width={6}
          height={6}
          stroke="var(--chart-1)"
          strokeWidth={1.5}
          orientation={['diagonal']}
        />
        <Grid horizontal />
        <Bar dataKey="Female" fill="var(--chart-1)" lineCap="round" />
        <Bar dataKey="Male" fill="var(--chart-2)" lineCap="round" />
        <Bar dataKey="Total" fill="url(#payroll-bar-hatch)" lineCap="round" />
        <BarXAxis showAllLabels />
        <ChartTooltip />
      </BarChart>
      <ul className={`${s.legend} ${s.inline}`}>
        <li>
          <span className={s.swatch} style={{ background: 'var(--chart-1)' }} /> Female{' '}
          <b>{fmtNum(r.totals.female)}</b>
        </li>
        <li>
          <span className={s.swatch} style={{ background: 'var(--chart-2)' }} /> Male{' '}
          <b>{fmtNum(r.totals.male)}</b>
        </li>
        <li>
          <span
            className={s.swatch}
            style={{
              background:
                'repeating-linear-gradient(135deg, var(--chart-1) 0 2px, transparent 2px 5px)',
              boxShadow: 'inset 0 0 0 1px var(--chart-1)',
            }}
          />{' '}
          Total <b>{fmtNum(r.totals.count)}</b>
        </li>
      </ul>
    </Card>
  );
}

function SalaryRings({ r }: { r: PayrollReport }) {
  const [hovered, setHovered] = useState<number | null>(null);
  // Each ring is its category's share of the month's gross salary.
  const data = r.byCategory.map((g, i) => ({
    label: g.label,
    value: Math.round(g.gross),
    maxValue: Math.max(1, Math.round(r.totals.gross)),
    color: COLORS[i]!,
  }));
  return (
    <Card title="Gross salary by category" sub="Each ring is its share of the month’s gross">
      <div className={s.square}>
        <RingChart
          data={data}
          strokeWidth={12}
          ringGap={6}
          baseInnerRadius={58}
          hoveredIndex={hovered}
          onHoverChange={setHovered}
        >
          {data.map((d, i) => (
            <Ring key={d.label} index={i} />
          ))}
          <RingCenter defaultLabel="Gross salary" formatOptions={usd} />
        </RingChart>
      </div>
      <ul className={s.legend}>
        {r.byCategory.map((g, i) => (
          <li
            key={g.key}
            data-hovered={hovered === i || undefined}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className={s.swatch} style={{ background: COLORS[i] }} />
            <span className={s.legendLabel}>{g.label}</span>
            <b>{fmtMoney(g.gross)}</b>
            <span className={s.share}>
              {r.totals.gross ? Math.round((g.gross / r.totals.gross) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NetGauge({ r }: { r: PayrollReport }) {
  const t = r.totals;
  const pct = t.gross ? (t.net / t.gross) * 100 : 0;
  const deductions = [
    { label: 'Half-month advance', amount: t.advance },
    { label: 'Pension 2%', amount: t.pension },
    { label: 'Salary tax', amount: t.tax },
  ];
  return (
    <Card
      wide
      title="Net pay"
      sub={`${pct.toFixed(1)}% of ${fmtMoney(t.gross)} gross reaches staff as the salary balance`}
    >
      <div className={s.gauge}>
        <Gauge
          value={Math.min(100, Math.max(0, pct))}
          centerValue={Math.round(t.net)}
          spacing={25}
          inactiveFillOpacity={0.4}
          defaultLabel="Net pay"
          formatOptions={usd}
        />
      </div>
      <ul className={`${s.legend} ${s.inline}`}>
        {deductions.map((d) => (
          <li key={d.label}>
            {d.label} <b>{fmtMoney(d.amount)}</b>
          </li>
        ))}
      </ul>
    </Card>
  );
}
