import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { coBreakdownSchema, type CoBreakdownInput, type CoDetail } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCoDetail, useCoList, useSaveBreakdown } from '../../features/co';
import { ErrorBanner, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import { BreakdownSheet, type BreakdownModel } from './BreakdownSheet';
import { computeBreakdown, defaultBreakdown, needsBreakdown, startingBreakdown } from './breakdown';
import { printBreakdown } from './breakdownPrint';
import { CoStatusPill } from './CoPlansPage';
import s from '../reports/Capacity.module.css';

/**
 * CO → Breakdown: an export invoice's "breakdown cost of finished products for GSP qualify
 * application" (the BREAKDOWN workbook). The qty and net weight are the invoice's; the target
 * FOB, import share, transport and base ratios are typed here and saved with the invoice.
 * The invoice sits in the URL (?invoice=…), so CO Plans can link straight to it.
 */
export function BreakdownPage() {
  const [params, setParams] = useSearchParams();
  const invoiceId = params.get('invoice') ?? '';
  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch))
      if (v) next.set(k, v);
      else next.delete(k);
    setParams(next, { replace: true });
  };

  const list = useCoList({ from: `${year}-01`, to: `${year}-12` });
  const detail = useCoDetail(invoiceId || undefined);
  // Only forms AB, N, AJ, E, RCEP and D need a breakdown (plus any already saved).
  const options = (list.data ?? []).filter((o) => o.hasBreakdown || needsBreakdown(o.form));

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className={s.controls}>
          <label className={s.field} style={{ minWidth: 110 }}>
            <span>Year</span>
            <select
              className={ui.input}
              value={year}
              onChange={(e) => set({ year: e.target.value, invoice: null })}
            >
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field} style={{ minWidth: 320 }}>
            <span>Export invoice</span>
            <select
              className={ui.input}
              value={invoiceId}
              onChange={(e) => set({ invoice: e.target.value })}
            >
              <option value="">Choose…</option>
              {/* The linked invoice stays listed even when it's from another year. */}
              {detail.data && !options.some((o) => o.invoiceId === invoiceId) && (
                <option value={invoiceId}>{detail.data.invoiceNo}</option>
              )}
              {options.map((o) => (
                <option key={o.invoiceId} value={o.invoiceId}>
                  {o.invoiceNo} · {o.clientCode} · {fmtDate(o.invoiceDate)} · {o.form ?? 'no form'}
                  {o.hasBreakdown ? ' · has breakdown' : ''}
                </option>
              ))}
            </select>
          </label>
          {detail.data && (
            <p className={s.hint}>
              <Link to={`/plans/${detail.data.shipmentId}`}>{detail.data.reference}</Link> ·{' '}
              {detail.data.clientName} · {detail.data.country ?? '-'} · {fmtNum(detail.data.pcs, 0)}{' '}
              pcs · {fmtNum(detail.data.netWeightKg, 2)} kg net · {fmtMoney(detail.data.amount)}{' '}
              (avg {detail.data.pcs ? fmtMoney(detail.data.amount / detail.data.pcs) : '-'} / pc) ·{' '}
              <CoStatusPill status={detail.data.status} />
            </p>
          )}
        </div>
      </div>
      {!invoiceId ? (
        <div className="card">
          Choose the export invoice to make its breakdown, or open one from CO Plans.
        </div>
      ) : detail.error ? (
        <ErrorBanner error={detail.error} />
      ) : !detail.data ? (
        <div className="card">Loading the invoice…</div>
      ) : !detail.data.breakdown && !needsBreakdown(detail.data.form) ? (
        <div className="card">
          {detail.data.invoiceNo} is{' '}
          {detail.data.form ? `Form ${detail.data.form}` : 'without a CO form'}, which needs no
          breakdown. Only Forms AB, N, AJ, E, RCEP and D do.
        </div>
      ) : (
        <BreakdownEditor key={detail.data.invoiceId} d={detail.data} />
      )}
    </>
  );
}

function BreakdownEditor({ d }: { d: CoDetail }) {
  const { can } = useAuth();
  const toast = useToast();
  const save = useSaveBreakdown();
  const editable = can('shipments:write');
  const [b, setB] = useState<CoBreakdownInput>(() => startingBreakdown(d));
  const [dirty, setDirty] = useState(!d.breakdown);

  const patch = (p: Partial<CoBreakdownInput>) => {
    setB((v) => ({ ...v, ...p }));
    setDirty(true);
  };
  const patchBase = (p: Partial<CoBreakdownInput['base']>) => patch({ base: { ...b.base, ...p } });

  const figures = useMemo(() => computeBreakdown(b, d.pcs, d.netWeightKg), [b, d]);
  const m: BreakdownModel = { company: d.company, invoiceNo: d.invoiceNo, input: b, figures };
  const valid = coBreakdownSchema.safeParse(b);

  const onSave = async () => {
    if (!valid.success) return;
    await save.mutateAsync({ invoiceId: d.invoiceId, body: valid.data });
    setDirty(false);
    toast(`Breakdown of ${d.invoiceNo} saved.`);
  };

  const text = (key: keyof CoBreakdownInput, label: string, type: 'text' | 'date' = 'text') => (
    <label className={s.field}>
      <span>{label}</span>
      <input
        className={ui.input}
        type={type}
        value={(b[key] as string | null) ?? ''}
        readOnly={!editable}
        onChange={(e) =>
          patch({ [key]: type === 'date' ? e.target.value || null : e.target.value })
        }
      />
    </label>
  );
  const num = (label: string, value: number, onChange: (v: number) => void, step = '0.01') => (
    <label className={s.field}>
      <span>{label}</span>
      <input
        className={ui.input}
        type="number"
        min={0}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        readOnly={!editable}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </label>
  );

  const off = Math.abs(figures.fob - b.targetFob) > 0.005;
  return (
    <div className={s.layout}>
      <div className={`${s.form} ${s.formPinned}`}>
        <div className={`card ${s.actions}`}>
          <b>{d.invoiceNo}</b>
          {d.breakdown && !dirty && <span className={s.hint}>Saved</span>}
          {!d.breakdown && (
            <span className={s.hint}>
              {d.template ? 'Started from the client’s last breakdown' : 'Not saved yet'}
            </span>
          )}
          <span className={s.spacer} />
          {editable && (
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={() =>
                patch({ ...defaultBreakdown(d), accountant: b.accountant, manager: b.manager })
              }
            >
              Reset to defaults
            </button>
          )}
          <button type="button" className={ui.ghostBtn} onClick={() => printBreakdown(m)}>
            Print / PDF
          </button>
          {editable && (
            <button
              type="button"
              className="btn-create-submit"
              disabled={!dirty || !valid.success || save.isPending}
              onClick={() => void onSave()}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ErrorBanner error={save.error} />
            {(!d.pcs || !d.netWeightKg) && (
              <div className={ui.notice}>
                The invoice has no {d.pcs ? 'net weight' : 'pieces'} on the shipping plan, so the
                fabric per piece can’t be worked out. Fill in its cargo lines first.
              </div>
            )}
            {!valid.success && (
              <div className={ui.notice}>
                {valid.error.issues[0]?.path.join(' ')}: {valid.error.issues[0]?.message}
              </div>
            )}
            <div className="form-section-title">Target settings</div>
            <div className={s.row} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {num('Target FOB (USD / pc)', b.targetFob, (v) => patch({ targetFob: v }))}
              {num(
                'Import share (%)',
                Math.round(b.importShare * 10000) / 100,
                (v) => patch({ importShare: v / 100 }),
                '1',
              )}
              {num('Transport cost (USD / pc)', b.transportCost, (v) =>
                patch({ transportCost: v }),
              )}
            </div>
            <p className={s.hint}>
              Local content {fmtNum(figures.localContent * 100, 2)}% · import{' '}
              {fmtNum(figures.importContent * 100, 2)}% · FOB on the sheet {fmtNum(figures.fob, 2)}
              {off ? ' (differs from the target: check the inputs)' : ''}
            </p>
            <div className="form-section-title">Base ratios (how the costs are split)</div>
            <div className={s.row} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {num('Fabric', b.base.fabric, (v) => patchBase({ fabric: v }))}
              {num('Accessories', b.base.accessories, (v) => patchBase({ accessories: v }))}
              {num('Local operational', b.base.local, (v) => patchBase({ local: v }))}
              {num('Overhead', b.base.overhead, (v) => patchBase({ overhead: v }))}
              {num('Profit', b.base.profit, (v) => patchBase({ profit: v }))}
            </div>
            <div className="form-section-title">Sheet</div>
            <div className={s.row} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {text('htsCode', 'HTS code')}
              {text('date', 'Date', 'date')}
            </div>
            {text('kinds', 'Kinds of the products')}
            {text('poNo', 'P.O no.')}
            {text('styleNo', 'Style no.')}
            <div className={s.row} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {text('fabricName', 'Fabric')}
              {text('fabricOrigin', 'Fabric origin')}
              {text('accessoriesOrigin', 'Accessories origin')}
            </div>
            <div className={s.row} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {text('accountant', 'Accountant')}
              {text('manager', 'General manager')}
            </div>
          </div>
        </div>
      </div>
      <div className={s.preview}>
        <BreakdownSheet m={m} />
      </div>
    </div>
  );
}
