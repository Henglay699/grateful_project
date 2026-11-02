import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProductionMachine, ProductionProfile } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorBanner, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useLookups } from '../../features/hooks';
import { useProductionReport, useSaveProductionProfile } from '../../features/reports';
import { icons } from '../../layout/icons';
import { fmtNum } from '../../lib/format';
import { buildCapacityModel, defaultProfile, DEFAULT_MACHINES } from './capacity';
import { exportCapacityExcel } from './capacityExport';
import { printCapacity } from './capacityPrint';
import { CapacitySheet } from './CapacitySheet';
import { matchClient, periodLabel, type PayrollReport } from './payroll';
import s from './Capacity.module.css';

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Reports → Payroll → Capacity report: the monthly report to the Ministry of Commerce. Points 4–5
 * come from the imported payroll, point 10 from the month's export invoices; the rest is the
 * client's saved setup, edited on the left with the A4 sheet updating on the right.
 */
export function CapacityReport({ payroll }: { payroll: PayrollReport }) {
  const lookups = useLookups();
  const clients = useMemo(() => lookups.data?.clients ?? [], [lookups.data]);
  const [clientId, setClientId] = useState('');
  const [month, setMonth] = useState(payroll.period ?? thisMonth());
  useEffect(() => {
    if (!clientId && clients.length) setClientId(matchClient(payroll.company, clients) ?? '');
  }, [clients, clientId, payroll.company]);

  const report = useProductionReport(clientId || undefined, month || undefined);
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className={s.controls}>
          <label className={s.field}>
            <span>Factory (client)</span>
            <select
              className={ui.input}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span>Month of exports</span>
            <input
              className={ui.input}
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <p className={s.hint}>
            Staff and salaries (points 4–5) come from the imported payroll
            {payroll.period ? ` (${periodLabel(payroll.period)})` : ''}. Point 10 adds up the
            factory’s export invoices dated in the month.
          </p>
        </div>
        {payroll.period && month && payroll.period !== month && (
          <div className={ui.notice} style={{ marginTop: 10 }}>
            The payroll is for {periodLabel(payroll.period)} but the exports are for{' '}
            {periodLabel(month)}. Import that month’s payroll if the staff figures should match.
          </div>
        )}
      </div>
      {!clientId ? (
        <div className="card">Choose the factory to build its report.</div>
      ) : report.error ? (
        <ErrorBanner error={report.error} />
      ) : !report.data ? (
        <div className="card">Loading the month’s exports…</div>
      ) : (
        <Editor
          key={clientId}
          payroll={payroll}
          data={report.data}
          clientId={clientId}
          fallbackName={clients.find((c) => c.id === clientId)?.legalName || payroll.company || ''}
        />
      )}
    </>
  );
}

type Data = NonNullable<ReturnType<typeof useProductionReport>['data']>;

function Editor({
  payroll,
  data,
  clientId,
  fallbackName,
}: {
  payroll: PayrollReport;
  data: Data;
  clientId: string;
  fallbackName: string;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const save = useSaveProductionProfile(clientId);
  const saved = useMemo(
    () => data.profile ?? defaultProfile(fallbackName),
    [data.profile, fallbackName],
  );
  const [draft, setDraft] = useState<ProductionProfile>(saved);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const canSave = can('reports:write');

  const m = useMemo(() => buildCapacityModel(payroll, data, draft), [payroll, data, draft]);
  const set = <K extends keyof ProductionProfile>(k: K, v: ProductionProfile[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const setOt = (key: string, value: string) =>
    setDraft((d) => {
      // A blank box drops the line's typed value (and the month, once nothing is left).
      const month = Object.fromEntries(
        Object.entries(d.otPcs[data.month] ?? {}).filter(([k]) => k !== key),
      );
      if (value.trim() !== '') month[key] = Math.max(0, Math.round(Number(value) || 0));
      const otPcs = Object.fromEntries(Object.entries(d.otPcs).filter(([m]) => m !== data.month));
      if (Object.keys(month).length) otPcs[data.month] = month;
      return { ...d, otPcs };
    });
  const setMachine = (i: number, patch: Partial<ProductionMachine>) =>
    set(
      'machines',
      draft.machines.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    );
  const products = [...new Set(m.lines.map((l) => l.product))];
  const shipments = new Set(data.lines.flatMap((l) => l.shipments)).size;
  const invoiceLines = data.lines.reduce((t, l) => t + l.invoiceLines, 0);

  const onSave = () =>
    save.mutate(draft, {
      onSuccess: () => toast('Report setup saved.'),
    });

  return (
    <div className={s.layout}>
      <div className={s.form}>
        <div className={`card ${s.actions}`}>
          {canSave && (
            <button
              type="button"
              className="new-shipment-btn"
              disabled={!dirty || save.isPending}
              onClick={onSave}
            >
              {save.isPending ? 'Saving…' : dirty ? 'Save setup' : 'Setup saved'}
            </button>
          )}
          {dirty && (
            <button type="button" className={ui.ghostBtn} onClick={() => setDraft(saved)}>
              Undo changes
            </button>
          )}
          <span className={s.spacer} />
          <button type="button" className={ui.ghostBtn} onClick={() => printCapacity(m)}>
            Print / PDF
          </button>
          <button type="button" className={ui.ghostBtn} onClick={() => void exportCapacityExcel(m)}>
            {icons.download({ width: 14, height: 14 })} Excel
          </button>
          {save.error ? <ErrorBanner error={save.error} /> : null}
          {!canSave && (
            <p className={s.hint}>
              Changes here are for this print only; saving the setup needs Reports edit access.
            </p>
          )}
        </div>

        <Section title="10) Exports this month" open>
          <p className={s.hint}>
            {invoiceLines
              ? `${fmtNum(m.exportTotal)} pcs from ${invoiceLines} invoice lines on ${shipments} export shipment${shipments === 1 ? '' : 's'}, by commercial invoice date.`
              : 'No export invoices dated in this month.'}
          </p>
          <div className={s.row}>
            <Num
              label="OT share % (each line’s pcs counted as overtime)"
              value={draft.otSharePct}
              step={0.5}
              onChange={(v) => set('otSharePct', v)}
            />
          </div>
          {m.lines.length > 0 && (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Product line</th>
                  <th className={s.num}>Export pcs</th>
                  <th className={s.num}>OT pcs</th>
                  <th className={s.num} title="Per hour, regular (÷ regular hours)">
                    /hr
                  </th>
                  <th className={s.num} title="Per hour, overtime (÷ overtime hours)">
                    OT /hr
                  </th>
                </tr>
              </thead>
              <tbody>
                {m.lines.map((l) => (
                  <tr key={l.key}>
                    <td>{[l.kind, l.product, l.material].filter(Boolean).join(' · ')}</td>
                    <td className={s.num}>{fmtNum(l.pcs)}</td>
                    <td className={s.num}>
                      <input
                        className={`${ui.input} ${s.small} ${l.otTyped ? s.typed : ''}`}
                        inputMode="numeric"
                        aria-label={`OT pcs for ${l.product}`}
                        placeholder={String(Math.round((l.pcs * draft.otSharePct) / 100))}
                        value={l.otTyped ? l.otPcs : ''}
                        onChange={(e) => setOt(l.key, e.target.value)}
                      />
                    </td>
                    <td className={s.num}>{l.regularPerHour}</td>
                    <td className={s.num}>{l.overtimePerHour}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Capacity per month</td>
                  <td className={s.num} colSpan={4}>
                    {fmtNum(m.capacityTotal)} pcs
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
          <p className={s.hint}>
            Leave OT pcs blank to use the share; type a number to set it for this month (0 = all
            regular hours, all pcs = overtime only).
          </p>
        </Section>

        <Section title="11) Unit weights (kg per piece)" open={products.length > 0}>
          <div className={s.row}>
            {products.map((prod) => (
              <Num
                key={prod}
                label={prod}
                step={0.01}
                value={draft.unitWeights[prod] ?? 0}
                onChange={(v) => set('unitWeights', { ...draft.unitWeights, [prod]: v })}
              />
            ))}
          </div>
        </Section>

        <Section title="1–3) Factory">
          <Text
            label="Factory name"
            value={draft.companyName}
            onChange={(v) => set('companyName', v)}
          />
          <Text label="Address" value={draft.address1} onChange={(v) => set('address1', v)} />
          <Text
            label="Address (2nd line)"
            value={draft.address2}
            onChange={(v) => set('address2', v)}
          />
          <Text label="Phone / fax" value={draft.phone} onChange={(v) => set('phone', v)} />
          <div className={s.row}>
            <Text
              label="Registration no."
              value={draft.registration}
              onChange={(v) => set('registration', v)}
            />
            <Text
              label="Registration date"
              value={draft.registrationDate}
              onChange={(v) => set('registrationDate', v)}
            />
          </div>
        </Section>

        <Section title="6) Working hours">
          <div className={s.row}>
            <Num
              label="Regular hours / month"
              value={draft.regularHours}
              onChange={(v) => set('regularHours', v)}
            />
            <Num
              label="Overtime hours / month"
              value={draft.overtimeHours}
              onChange={(v) => set('overtimeHours', v)}
            />
          </div>
          <div className={s.row}>
            <Num
              label="Regular hours / day"
              value={draft.regularHoursPerDay}
              onChange={(v) => set('regularHoursPerDay', v)}
            />
            <Num
              label="Overtime hours / day"
              value={draft.overtimeHoursPerDay}
              onChange={(v) => set('overtimeHoursPerDay', v)}
            />
          </div>
          <Text
            label="Working time"
            value={draft.regularTime}
            onChange={(v) => set('regularTime', v)}
          />
          <Text
            label="Overtime"
            value={draft.overtimeTime}
            onChange={(v) => set('overtimeTime', v)}
          />
        </Section>

        <Section title="7–8) Materials and destination">
          <Text
            label="Imported materials"
            value={draft.materials}
            placeholder={m.materials || 'e.g. WOVEN FABRIC, KNITTED FABRIC'}
            onChange={(v) => set('materials', v)}
          />
          <Text
            label="Imported from"
            value={draft.materialOrigins}
            placeholder={m.materialOrigins || 'e.g. CHINA, TAIWAN'}
            onChange={(v) => set('materialOrigins', v)}
          />
          <Text
            label="Export destinations"
            value={draft.destinations}
            placeholder={m.destinations || 'e.g. USA'}
            onChange={(v) => set('destinations', v)}
          />
          <Text
            label="Categories"
            value={draft.categories}
            placeholder="e.g. 340, 347, 341, 348"
            onChange={(v) => set('categories', v)}
          />
          <p className={s.hint}>Left blank, these use the month’s import and export shipments.</p>
        </Section>

        <Section title="9) Machines">
          <table className={s.table}>
            <thead>
              <tr>
                <th>Machine</th>
                <th className={s.num}>Total</th>
                <th className={s.num}>Working</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.machines.map((x, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className={`${ui.input} ${s.wide}`}
                      aria-label="Machine (Khmer)"
                      value={x.labelKh}
                      onChange={(e) => setMachine(i, { labelKh: e.target.value })}
                    />
                    <input
                      className={`${ui.input} ${s.wide}`}
                      aria-label="Machine (English)"
                      value={x.labelEn}
                      onChange={(e) => setMachine(i, { labelEn: e.target.value })}
                    />
                  </td>
                  <td className={s.num}>
                    <input
                      className={`${ui.input} ${s.small}`}
                      inputMode="numeric"
                      aria-label="Total"
                      value={x.total}
                      onChange={(e) =>
                        setMachine(i, { total: Math.max(0, Number(e.target.value) || 0) })
                      }
                    />
                  </td>
                  <td className={s.num}>
                    <input
                      className={`${ui.input} ${s.small}`}
                      inputMode="numeric"
                      aria-label="Working"
                      value={x.working}
                      onChange={(e) =>
                        setMachine(i, { working: Math.max(0, Number(e.target.value) || 0) })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={s.remove}
                      aria-label="Remove machine"
                      onClick={() =>
                        set(
                          'machines',
                          draft.machines.filter((_, j) => j !== i),
                        )
                      }
                    >
                      {icons.close({ width: 14, height: 14 })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className={ui.ghostBtn}
            onClick={() =>
              set('machines', [
                ...draft.machines,
                draft.machines.length
                  ? { ...DEFAULT_MACHINES[4]!, labelKh: '', labelEn: '' }
                  : DEFAULT_MACHINES[0]!,
              ])
            }
          >
            + Add machine
          </button>
        </Section>

        <Section title="12) Conclusion and signatures">
          <label className={s.field}>
            <span>Conclusion (blank = dotted lines to write by hand)</span>
            <textarea
              className={ui.input}
              rows={3}
              value={draft.conclusion}
              onChange={(e) => set('conclusion', e.target.value)}
            />
          </label>
          <div className={s.row}>
            <Text
              label="Factory informant"
              value={draft.informantName}
              onChange={(v) => set('informantName', v)}
            />
            <Text
              label="Their position"
              value={draft.informantTitle}
              onChange={(v) => set('informantTitle', v)}
            />
          </div>
          <div className={s.row}>
            <Text
              label="Ministry officer"
              value={draft.officerName}
              onChange={(v) => set('officerName', v)}
            />
            <Text
              label="Approved by"
              value={draft.approverName}
              onChange={(v) => set('approverName', v)}
            />
          </div>
        </Section>
      </div>

      <div className={s.preview}>
        <CapacitySheet m={m} />
      </div>
    </div>
  );
}

function Section({
  title,
  open,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={`card ${s.section}`} open={open}>
      <summary>{title}</summary>
      <div className={s.sectionBody}>{children}</div>
    </details>
  );
}

function Text({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input
        className={ui.input}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Num({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input
        className={ui.input}
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}
