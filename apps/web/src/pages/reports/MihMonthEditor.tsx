import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MIH_MARKETS,
  MIH_MARKET_LABELS,
  MIH_ORIGINS,
  MIH_ORIGIN_LABELS,
  materialKeyOf,
  materialTotal,
  mihChecks,
  mihExportTotal,
  mihFigures,
  mihMaterialSchema,
  mihProductSchema,
  mihTotals,
  mihUtilitySchema,
  productExport,
  productKeyOf,
  utilityKeyOf,
  type MihDraft,
  type MihMonthData,
  type MihQV,
  type MihYear,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorBanner, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDeleteMihMonth, useMihDraft, useSaveMihMonth } from '../../features/reports';
import { icons } from '../../layout/icons';
import { api } from '../../lib/api';
import { fmtMoney, fmtNum } from '../../lib/format';
import { periodLabel } from './payroll';
import s from './Mih.module.css';

const ZERO: MihQV = { qty: 0, value: 0 };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A number box that lets "12." or "" sit while typing; empty counts as 0. */
function Num({
  value,
  onChange,
  label,
  wide,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  wide?: boolean;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => {
    if ((Number(text.replace(/,/g, '')) || 0) !== value) setText(value ? String(value) : '');
    // Only an outside change (refill, row removed) rewrites what's typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={`${ui.input} ${wide ? '' : s.cellNum}`}
      style={wide ? { textAlign: 'right' } : undefined}
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(/,/g, ''));
        if (Number.isFinite(n) && n >= 0) onChange(n);
      }}
    />
  );
}

function Txt({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <input
      className={`${ui.input} ${className ?? s.cellText}`}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`${s.field} ${wide ? s.wide : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const Ytd = ({ v }: { v: MihQV }) => (
  <>
    <td className={s.ytd}>{fmtNum(v.qty, 2)}</td>
    <td className={s.ytd}>{fmtMoney(v.value)}</td>
  </>
);

function RemoveBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={s.iconBtn} aria-label={label} title="Remove" onClick={onClick}>
      {icons.trash({ width: 14, height: 14 })}
    </button>
  );
}

/**
 * Reports → MIH → one month: the report's four pages as tables to fill in. A month not saved
 * yet starts from the app's payroll and invoices. The grey columns are the year so far: the
 * saved months before this one added up by product, plus what's on screen.
 */
export function MihMonthEditor({
  clientId,
  month,
  year,
  onBack,
}: {
  clientId: string;
  month: string;
  year: MihYear;
  onBack: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const writer = can('reports:write');
  const saved = year.months.find((m) => m.period === month);
  const draft = useMihDraft(saved ? undefined : clientId, saved ? undefined : month);
  const save = useSaveMihMonth();
  const del = useDeleteMihMonth();

  const [data, setData] = useState<MihMonthData | null>(saved?.data ?? null);
  const [dirty, setDirty] = useState(false);
  const [sources, setSources] = useState<MihDraft['sources'] | null>(null);
  const [refilling, setRefilling] = useState(false);
  useEffect(() => {
    if (!data && draft.data) {
      setData(draft.data.data);
      setSources(draft.data.sources);
    }
  }, [data, draft.data]);

  const edit = (fn: (d: MihMonthData) => void) => {
    setData((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const prior = useMemo(
    () => mihTotals(year.months.filter((m) => m.period < month).map((m) => m.data)),
    [year.months, month],
  );
  const current = useMemo(() => (data ? mihFigures(data) : new Map<string, MihQV>()), [data]);
  const ytd = (key: string): MihQV => {
    const a = prior.get(key) ?? ZERO;
    const b = current.get(key) ?? ZERO;
    return { qty: a.qty + b.qty, value: a.value + b.value };
  };
  const payroll = year.payroll.find((p) => p.period === month) ?? null;
  const checks = useMemo(
    () =>
      data
        ? mihChecks(
            month,
            data,
            [...year.months.filter((m) => m.period !== month), { period: month, data }],
            payroll,
          )
        : [],
    [data, month, year.months, payroll],
  );

  if (draft.error) return <ErrorBanner error={draft.error} />;
  if (!data) return <div className="card">Filling in {periodLabel(month)} from the app…</div>;

  const total = mihExportTotal(data);
  const yearTotal = sumKeys(
    data.products.map((p) => productKeyOf(p, 'EXPORT')),
    ytd,
  );

  const submit = () =>
    save.mutate(
      {
        period: month,
        clientId,
        data,
        source: saved?.source ?? 'app',
        fileName: saved?.fileName ?? '',
        issues: saved?.issues ?? [],
        replace: !!saved,
      },
      {
        onSuccess: () => {
          setDirty(false);
          toast(`${periodLabel(month)} ${saved ? 'updated' : 'saved'}.`);
        },
      },
    );

  const refill = async () => {
    if (
      !window.confirm(
        'Replace the products, markets, materials, staff and salary with what the app has now (payroll and invoices)? Electricity, water, waste and the factory details stay as they are.',
      )
    )
      return;
    setRefilling(true);
    try {
      const d = await api<MihDraft>('/reports/mih/draft', { query: { clientId, month } });
      edit((x) => {
        x.products = d.data.products;
        x.materials = d.data.materials;
        if (d.sources.payrollPeriod) {
          x.employees = d.data.employees;
          x.female = d.data.female;
          x.salary = d.data.salary;
        }
      });
      setSources(d.sources);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The app’s figures could not be loaded.');
    } finally {
      setRefilling(false);
    }
  };

  const remove = () => {
    if (!saved || !window.confirm(`Delete the saved MIH report for ${periodLabel(month)}?`)) return;
    del.mutate(saved.id, {
      onSuccess: () => {
        toast(`${periodLabel(month)} deleted.`);
        onBack();
      },
    });
  };

  const setUtility = (
    section: 'energy' | 'water',
    i: number,
    patch: Partial<{ name: string; unit: string; qty: number; unitPrice: number; value: number }>,
  ) =>
    edit((d) => {
      const u = Object.assign(d[section][i]!, patch);
      // Use or price changed: the cost follows. A typed cost stays as typed.
      if ('qty' in patch || 'unitPrice' in patch) u.value = round2(u.qty * u.unitPrice);
    });

  return (
    <>
      <div className={`card ${s.bar}`}>
        <button type="button" className={ui.ghostBtn} onClick={onBack}>
          {icons.back({ width: 14, height: 14 })} Year
        </button>
        <h3>{periodLabel(month)}</h3>
        {saved ? (
          <span className={s.plain}>
            Saved{saved.source === 'excel' ? ' from Excel' : ''}
            {saved.savedByName ? ` · ${saved.savedByName}` : ''}
          </span>
        ) : (
          <span className={s.warn}>Not saved yet</span>
        )}
        {dirty && <span className={s.warn}>Unsaved changes</span>}
        <span className={s.spacer} />
        {writer && (
          <div className={s.btnRow}>
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={() => void refill()}
              disabled={refilling}
              title="Fill products, materials and staff again from the app's invoices and payroll"
            >
              {refilling ? 'Loading…' : 'Refill from app'}
            </button>
            {saved && (
              <button
                type="button"
                className={ui.ghostBtn}
                onClick={remove}
                disabled={del.isPending}
              >
                {icons.trash({ width: 14, height: 14 })} Delete
              </button>
            )}
            <button
              type="button"
              className="new-shipment-btn"
              onClick={submit}
              disabled={save.isPending || (!!saved && !dirty)}
            >
              {save.isPending ? 'Saving…' : saved ? 'Save changes' : 'Save month'}
            </button>
          </div>
        )}
      </div>
      {save.error ? <ErrorBanner error={save.error} /> : null}
      {del.error ? <ErrorBanner error={del.error} /> : null}

      {sources && (
        <p className={s.sub} style={{ margin: '0 0 12px' }}>
          Filled in from {sources.exportLines} export invoice line
          {sources.exportLines === 1 ? '' : 's'} ({sources.exportShipments.length} shipment
          {sources.exportShipments.length === 1 ? '' : 's'}), {sources.importLines} import line
          {sources.importLines === 1 ? '' : 's'}
          {sources.payrollPeriod
            ? `, and the payroll saved for ${periodLabel(sources.payrollPeriod)}`
            : '; no payroll is saved for this month, so type the staff and salary'}
          .{' '}
          {sources.carriedFrom
            ? `Factory details, prices and row names from ${periodLabel(sources.carriedFrom)}.`
            : ''}{' '}
          Check every figure before saving.
        </p>
      )}

      {checks.length > 0 && (
        <div className={s.checks} role="status">
          <h4>To check ({checks.length})</h4>
          <ul>
            {checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {saved && saved.issues.length > 0 && (
        <details className={`card ${s.notes}`}>
          <summary>
            Notes from reading {saved.fileName || 'the Excel copy'} ({saved.issues.length})
          </summary>
          <ul>
            {saved.issues.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <section className={`card ${s.section}`}>
        <div className={s.sectionHead}>
          <h3>Factory and staff</h3>
          {payroll && (
            <span className={s.muted}>
              Payroll {periodLabel(payroll.period)}: {fmtNum(payroll.staffCount)} staff,{' '}
              {fmtNum(payroll.female)} women, {fmtMoney(payroll.gross)}
            </span>
          )}
        </div>
        <div className={s.grid}>
          <Field label="Factory name" wide>
            <Txt
              label="Factory name"
              className=""
              value={data.companyName}
              onChange={(v) => edit((d) => void (d.companyName = v))}
            />
          </Field>
          <Field label="Total employees">
            <Num
              wide
              label="Total employees"
              value={data.employees}
              onChange={(n) => edit((d) => void (d.employees = Math.round(n)))}
            />
          </Field>
          <Field label="Of whom women">
            <Num
              wide
              label="Women"
              value={data.female}
              onChange={(n) => edit((d) => void (d.female = Math.round(n)))}
            />
          </Field>
          <Field label="Salary & wages of the month (USD)">
            <Num
              wide
              label="Salary"
              value={data.salary}
              onChange={(n) => edit((d) => void (d.salary = n))}
            />
          </Field>
          <Field label="Total asset, land excluded (USD)">
            <Num
              wide
              label="Total asset"
              value={data.totalAsset}
              onChange={(n) => edit((d) => void (d.totalAsset = n))}
            />
          </Field>
          <Field label="Fixed asset, land excluded (USD)">
            <Num
              wide
              label="Fixed asset"
              value={data.fixedAsset}
              onChange={(n) => edit((d) => void (d.fixedAsset = n))}
            />
          </Field>
          <Field label="Report date (as signed)" wide>
            <Txt
              label="Report date"
              className=""
              value={data.reportDate}
              onChange={(v) => edit((d) => void (d.reportDate = v))}
            />
          </Field>
          <Field label="Director">
            <Txt
              label="Director"
              className=""
              value={data.directorName}
              onChange={(v) => edit((d) => void (d.directorName = v))}
            />
          </Field>
          <Field label="Reported by">
            <Txt
              label="Reported by"
              className=""
              value={data.reporterName}
              onChange={(v) => edit((d) => void (d.reporterName = v))}
            />
          </Field>
        </div>
      </section>

      <section className={`card ${s.section}`}>
        <div className={s.sectionHead}>
          <h3>Products and markets</h3>
          <span className={s.muted}>
            Month: {fmtNum(total.qty)} pcs · {fmtMoney(total.value)} — Year so far:{' '}
            {fmtNum(yearTotal.qty)} pcs · {fmtMoney(yearTotal.value)}
          </span>
        </div>
        <div className={s.scrollX}>
          <table className={`data-table-clean ${s.sheet}`}>
            <thead>
              <tr>
                <th colSpan={3} />
                <th colSpan={2}>Export, month</th>
                <th colSpan={2}>Export, year so far</th>
                {MIH_MARKETS.map((m) => (
                  <th key={m} colSpan={2}>
                    {MIH_MARKET_LABELS[m]}
                  </th>
                ))}
                <th colSpan={2}>Domestic</th>
                <th />
              </tr>
              <tr>
                <th>Kind</th>
                <th>Product</th>
                <th>Unit</th>
                {['E', 'Y', ...MIH_MARKETS, 'D'].map((m) => (
                  <QvHead key={m} />
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.products.map((p, i) => {
                const ex = productExport(p);
                const label = `${p.kind} ${p.product}`;
                return (
                  <tr key={i}>
                    <td>
                      <Txt
                        label={`Kind, row ${i + 1}`}
                        className={s.cellKind}
                        value={p.kind}
                        onChange={(v) => edit((d) => void (d.products[i]!.kind = v))}
                      />
                    </td>
                    <td>
                      <Txt
                        label={`Product, row ${i + 1}`}
                        value={p.product}
                        onChange={(v) => edit((d) => void (d.products[i]!.product = v))}
                      />
                    </td>
                    <td>
                      <Txt
                        label={`Unit, row ${i + 1}`}
                        className={s.cellShort}
                        value={p.unit}
                        onChange={(v) => edit((d) => void (d.products[i]!.unit = v))}
                      />
                    </td>
                    <td className={`${s.num} val-bold`}>{fmtNum(ex.qty, 2)}</td>
                    <td className={`${s.num} val-bold`}>{fmtMoney(ex.value)}</td>
                    <Ytd v={ytd(productKeyOf(p, 'EXPORT'))} />
                    {MIH_MARKETS.map((m) => (
                      <QvCells
                        key={m}
                        label={`${label} ${MIH_MARKET_LABELS[m]}`}
                        v={p.markets[m]}
                        onChange={(f, n) => edit((d) => void (d.products[i]!.markets[m][f] = n))}
                      />
                    ))}
                    <QvCells
                      label={`${label} domestic`}
                      v={p.domestic}
                      onChange={(f, n) => edit((d) => void (d.products[i]!.domestic[f] = n))}
                    />
                    <td>
                      <RemoveBtn
                        label={`Remove ${label}`}
                        onClick={() => edit((d) => void d.products.splice(i, 1))}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr className={s.total}>
                <td colSpan={3}>Total</td>
                <QvTotal v={total} />
                <QvTotal v={yearTotal} />
                {MIH_MARKETS.map((m) => {
                  const t = sumQV(data.products.map((p) => p.markets[m]));
                  return <QvTotal key={m} v={t} />;
                })}
                <QvTotal v={sumQV(data.products.map((p) => p.domestic))} />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className={`${ui.ghostBtn} ${s.addBtn}`}
          onClick={() =>
            edit(
              (d) => void d.products.push(mihProductSchema.parse({ kind: 'LADIES', unit: 'PCS' })),
            )
          }
        >
          {icons.plus({ width: 14, height: 14 })} Add product
        </button>
      </section>

      <section className={`card ${s.section}`}>
        <div className={s.sectionHead}>
          <h3>Raw materials by origin</h3>
          <span className={s.muted}>Imported this month, by the country they came from</span>
        </div>
        <div className={s.scrollX}>
          <table className={`data-table-clean ${s.sheet}`}>
            <thead>
              <tr>
                <th colSpan={2} />
                <th colSpan={2}>Month</th>
                <th colSpan={2}>Year so far</th>
                {MIH_ORIGINS.map((o) => (
                  <th key={o} colSpan={2}>
                    {MIH_ORIGIN_LABELS[o]}
                  </th>
                ))}
                <th />
              </tr>
              <tr>
                <th>Material</th>
                <th>Unit</th>
                {['M', 'Y', ...MIH_ORIGINS].map((o) => (
                  <QvHead key={o} />
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.materials.map((m, i) => {
                const t = materialTotal(m);
                return (
                  <tr key={i}>
                    <td>
                      <Txt
                        label={`Material, row ${i + 1}`}
                        className=""
                        value={m.name}
                        onChange={(v) => edit((d) => void (d.materials[i]!.name = v))}
                      />
                    </td>
                    <td>
                      <Txt
                        label={`Unit, material row ${i + 1}`}
                        className={s.cellShort}
                        value={m.unit}
                        onChange={(v) => edit((d) => void (d.materials[i]!.unit = v))}
                      />
                    </td>
                    <td className={`${s.num} val-bold`}>{fmtNum(t.qty, 2)}</td>
                    <td className={`${s.num} val-bold`}>{fmtMoney(t.value)}</td>
                    <Ytd v={ytd(materialKeyOf(m, 'TOTAL'))} />
                    {MIH_ORIGINS.map((o) => (
                      <QvCells
                        key={o}
                        label={`${m.name} ${MIH_ORIGIN_LABELS[o]}`}
                        v={m.origins[o]}
                        onChange={(f, n) => edit((d) => void (d.materials[i]!.origins[o][f] = n))}
                      />
                    ))}
                    <td>
                      <RemoveBtn
                        label={`Remove ${m.name}`}
                        onClick={() => edit((d) => void d.materials.splice(i, 1))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className={`${ui.ghostBtn} ${s.addBtn}`}
          onClick={() => edit((d) => void d.materials.push(mihMaterialSchema.parse({})))}
        >
          {icons.plus({ width: 14, height: 14 })} Add material
        </button>
      </section>

      <section className={`card ${s.section}`}>
        <div className={s.sectionHead}>
          <h3>Electricity and water</h3>
          <span className={s.muted}>
            From this month’s bills. The cost follows use × unit price.
          </span>
        </div>
        <div className={s.scrollX}>
          <table className={`data-table-clean ${s.sheet}`}>
            <thead>
              <tr>
                <th />
                <th>Supplier</th>
                <th>Unit</th>
                <th className={s.num}>Used</th>
                <th className={s.num}>Unit price $</th>
                <th className={s.num}>Cost $</th>
                <th className={s.num}>Year: used</th>
                <th className={s.num}>Year: cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(['energy', 'water'] as const).flatMap((section) =>
                data[section].map((u, i) => (
                  <tr key={`${section}${i}`}>
                    <td className={s.muted}>{section === 'energy' ? 'Electricity' : 'Water'}</td>
                    <td>
                      <Txt
                        label={`${section} supplier ${i + 1}`}
                        value={u.name}
                        onChange={(v) => setUtility(section, i, { name: v })}
                      />
                    </td>
                    <td>
                      <Txt
                        label={`${section} unit ${i + 1}`}
                        className={s.cellShort}
                        value={u.unit}
                        onChange={(v) => setUtility(section, i, { unit: v })}
                      />
                    </td>
                    <td>
                      <Num
                        label={`${u.name} used`}
                        value={u.qty}
                        onChange={(n) => setUtility(section, i, { qty: n })}
                      />
                    </td>
                    <td>
                      <Num
                        label={`${u.name} unit price`}
                        value={u.unitPrice}
                        onChange={(n) => setUtility(section, i, { unitPrice: n })}
                      />
                    </td>
                    <td>
                      <Num
                        label={`${u.name} cost`}
                        value={u.value}
                        onChange={(n) => setUtility(section, i, { value: n })}
                      />
                    </td>
                    <Ytd v={ytd(utilityKeyOf(section === 'energy' ? 'e' : 'w', u.name))} />
                    <td>
                      <RemoveBtn
                        label={`Remove ${u.name}`}
                        onClick={() => edit((d) => void d[section].splice(i, 1))}
                      />
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <div className={s.btnRow} style={{ marginTop: 8 }}>
          {(['energy', 'water'] as const).map((section) => (
            <button
              key={section}
              type="button"
              className={ui.ghostBtn}
              onClick={() => edit((d) => void d[section].push(mihUtilitySchema.parse({})))}
            >
              {icons.plus({ width: 14, height: 14 })} Add{' '}
              {section === 'energy' ? 'electricity' : 'water'} supply
            </button>
          ))}
        </div>
      </section>

      <section className={`card ${s.section}`}>
        <div className={s.sectionHead}>
          <h3>Waste from production</h3>
        </div>
        <div className={s.scrollX}>
          <table className={`data-table-clean ${s.sheet}`}>
            <thead>
              <tr>
                <th>Kind of waste</th>
                <th>Unit</th>
                <th className={s.num}>This month</th>
                <th className={s.num}>Year so far</th>
              </tr>
            </thead>
            <tbody>
              {data.waste.map((w, i) => (
                <tr key={i}>
                  <td>
                    <Txt
                      label={`Waste ${i + 1}`}
                      value={w.name}
                      onChange={(v) => edit((d) => void (d.waste[i]!.name = v))}
                    />
                  </td>
                  <td>
                    <Txt
                      label={`Waste unit ${i + 1}`}
                      className={s.cellShort}
                      value={w.unit}
                      onChange={(v) => edit((d) => void (d.waste[i]!.unit = v))}
                    />
                  </td>
                  <td>
                    <Num
                      label={`${w.name} this month`}
                      value={w.qty}
                      onChange={(n) => edit((d) => void (d.waste[i]!.qty = n))}
                    />
                  </td>
                  <td className={s.ytd}>{fmtNum(ytd(utilityKeyOf('x', w.name)).qty, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`card ${s.section}`}>
        <Field label="Notes (not on the report)">
          <textarea
            className={ui.input}
            rows={3}
            value={data.notes}
            onChange={(e) => edit((d) => void (d.notes = e.target.value))}
          />
        </Field>
      </section>
    </>
  );
}

const sumQV = (list: MihQV[]): MihQV => ({
  qty: list.reduce((t, x) => t + x.qty, 0),
  value: list.reduce((t, x) => t + x.value, 0),
});
/** The year-to-date of several keys (each product once, however many rows share it). */
const sumKeys = (keys: string[], ytd: (k: string) => MihQV) => sumQV([...new Set(keys)].map(ytd));

const QvHead = () => (
  <>
    <th className={s.num}>Qty</th>
    <th className={s.num}>Value $</th>
  </>
);
const QvTotal = ({ v }: { v: MihQV }) => (
  <>
    <td className={s.num}>{fmtNum(v.qty, 2)}</td>
    <td className={s.num}>{fmtMoney(v.value)}</td>
  </>
);
function QvCells({
  v,
  label,
  onChange,
}: {
  v: MihQV;
  label: string;
  onChange: (field: 'qty' | 'value', n: number) => void;
}) {
  return (
    <>
      <td>
        <Num label={`${label} quantity`} value={v.qty} onChange={(n) => onChange('qty', n)} />
      </td>
      <td>
        <Num label={`${label} value`} value={v.value} onChange={(n) => onChange('value', n)} />
      </td>
    </>
  );
}
