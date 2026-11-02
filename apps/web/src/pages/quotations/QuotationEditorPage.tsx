import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import { quotationInputSchema, type QuotationDetail, type QuotationTemplate } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useApiMutation, useQuotation, useQuotationTemplates } from '../../features/admin';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { QUOTE_STATUS } from '../QuotationsPage';
import { PrintLink } from '../../components/PrintLink';
import { icons } from '../../layout/icons';
import s from '../creditnoted/CreditNotedEditor.module.css';
import q from './QuotationEditor.module.css';

type Row = Record<string, string>;
const rowsFrom = (t: QuotationTemplate): Row[] =>
  t.defaultRows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.key, r[i] ?? ''])));

/** Rates-table column widths by type; the remark column takes what is left. */
const COL_WIDTH: Record<QuotationTemplate['columns'][number]['type'], string | number | undefined> =
  { wide: '26%', text: 96, num: 120, remark: undefined };

export function QuotationEditorPage() {
  const { id = 'new' } = useParams();
  const quote = useQuotation(id === 'new' ? undefined : id);
  const templates = useQuotationTemplates();
  if (quote.isLoading || templates.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading…</div>
      </section>
    );
  if (quote.error || templates.error)
    return (
      <section className="view active">
        <ErrorBanner error={quote.error ?? templates.error} />
      </section>
    );
  return (
    <Editor key={quote.data?.id ?? 'new'} quote={quote.data} templates={templates.data ?? []} />
  );
}

function Editor({
  quote,
  templates,
}: {
  quote?: QuotationDetail | undefined;
  templates: QuotationTemplate[];
}) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const lookups = useLookups();
  const first = templates[0];
  const [templateKey, setTemplateKey] = useState(quote?.templateKey ?? first?.key ?? '');
  const template = templates.find((t) => t.key === templateKey);
  const [head, setHead] = useState({
    clientId: quote?.clientId ?? '',
    toName: quote?.toName ?? '',
    attn: quote?.attn ?? '',
    quoteDate:
      quote?.quoteDate ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()),
    paymentTermDays: quote?.paymentTermDays?.toString() ?? '7',
    latePenaltyPctPerDay: quote?.latePenaltyPctPerDay
      ? String(Number(quote.latePenaltyPctPerDay))
      : '',
    notes: quote?.notes ?? first?.notes ?? '',
  });
  const [rows, setRows] = useState<Row[]>(() => quote?.lines ?? (first ? rowsFrom(first) : []));
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const editable = can('quotations:write') && (!quote || quote.status === 'DRAFT');
  const latest = !quote || quote.versions[0]?.id === quote.id;

  const body = () => ({
    templateKey,
    ...head,
    clientId: head.clientId || null,
    paymentTermDays: head.paymentTermDays || null,
    lines: rows,
  });
  const save = useApiMutation(
    () =>
      quote
        ? api<QuotationDetail>(`/quotations/${quote.id}`, { method: 'PUT', json: body() })
        : api<QuotationDetail>('/quotations', { method: 'POST', json: body() }),
    [['quotations']],
  );
  const status = useApiMutation(
    (s: string) =>
      api<QuotationDetail>(`/quotations/${quote!.id}/status`, {
        method: 'POST',
        json: { status: s },
      }),
    [['quotations']],
  );
  const revise = useApiMutation(
    () => api<QuotationDetail>(`/quotations/${quote!.id}/revise`, { method: 'POST' }),
    [['quotations']],
  );
  const del = useApiMutation(
    () => api(`/quotations/${quote!.id}`, { method: 'DELETE' }),
    [['quotations']],
  );

  const onSave = async () => {
    const check = quotationInputSchema.safeParse(body());
    setFieldErrors(check.success ? [] : check.error.issues.map((i) => i.message));
    if (!check.success) return;
    const saved = await save.mutateAsync(undefined);
    toast(quote ? 'Quotation saved.' : `Quotation ${saved.quoteNo} created.`);
    if (!quote) navigate(`/quotations/${saved.id}`, { replace: true });
  };
  const changeTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    if (
      rows.some((r) => Object.values(r).some(Boolean)) &&
      !window.confirm(
        'Switch service? The rows will be replaced with that service’s standard rates.',
      )
    )
      return;
    setTemplateKey(key);
    setRows(rowsFrom(t));
    setHead((h) => ({ ...h, notes: t.notes ?? '' }));
  };
  const pickClient = (id: string) => {
    const c = lookups.data?.clients.find((x) => x.id === id);
    setHead((h) => ({ ...h, clientId: id, toName: c && !h.toName ? c.name : h.toName }));
  };
  const cols = useMemo(() => template?.columns ?? [], [template]);
  const err = save.error ?? status.error ?? revise.error ?? del.error;
  const setCell = (i: number, key: string, value: string) =>
    setRows(rows.map((x, j) => (j === i ? { ...x, [key]: value } : x)));

  return (
    <section className="view active">
      <div className="shipment-create-container">
        <div className="create-top-bar">
          <div className={backRow}>
            <BackLink to="/quotations" label="Quotations" />
            <div>
              <div className="create-header-title">
                {quote
                  ? `${quote.quoteNo}${quote.version > 1 ? ` v${quote.version}` : ''}`
                  : 'New quotation'}{' '}
                {quote && (
                  <Pill tone={QUOTE_STATUS[quote.status].tone}>
                    {QUOTE_STATUS[quote.status].label}
                  </Pill>
                )}
              </div>
              {quote && quote.versions.length > 1 && (
                <div className={q.versions}>
                  Versions
                  {quote.versions.map((v) => (
                    <Link
                      key={v.id}
                      to={`/quotations/${v.id}`}
                      className={q.version}
                      aria-current={v.id === quote.id ? 'page' : undefined}
                    >
                      v{v.version}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={q.headActions}>
            {can('quotations:write') && quote?.status === 'DRAFT' && (
              <button
                type="button"
                className={s.headDelete}
                disabled={del.isPending}
                onClick={() =>
                  window.confirm('Delete this draft?') &&
                  void del.mutateAsync(undefined).then(() => navigate('/quotations'))
                }
                aria-label="Delete draft"
                title="Delete draft"
              >
                {icons.trash({})}
              </button>
            )}
            {quote && (
              <PrintLink className="filter-btn" href={`/print/quotation/${quote.id}`}>
                Print / PDF
              </PrintLink>
            )}
            {can('quotations:write') &&
              quote &&
              latest &&
              quote.status !== 'DRAFT' &&
              quote.status !== 'SUPERSEDED' && (
                <button
                  type="button"
                  className="btn-cancel-shipment"
                  onClick={() =>
                    void revise.mutateAsync(undefined).then((v) => {
                      toast(`Version ${v.version} created.`);
                      navigate(`/quotations/${v.id}`);
                    })
                  }
                >
                  Revise (new version)
                </button>
              )}
            {can('quotations:write') && quote?.status === 'SENT' && (
              <button
                type="button"
                className="btn-cancel-shipment"
                onClick={() =>
                  void status.mutateAsync('ACCEPTED').then(() => toast('Marked accepted.'))
                }
              >
                Mark accepted
              </button>
            )}
            {editable && (
              <button
                type="button"
                className="btn-cancel-shipment"
                onClick={() => void onSave()}
                disabled={save.isPending}
              >
                {quote ? 'Save draft' : 'Create draft'}
              </button>
            )}
            {can('quotations:write') && quote?.status === 'DRAFT' && (
              <button
                type="button"
                className="btn-create-submit"
                onClick={() => void status.mutateAsync('SENT').then(() => toast('Marked sent.'))}
              >
                Mark sent
              </button>
            )}
          </div>
        </div>
        <ErrorBanner error={err instanceof ApiError ? err : null} />
        {fieldErrors.length > 0 && <div className={ui.alert}>{fieldErrors.join(' · ')}</div>}
        <fieldset disabled={!editable} className={q.fieldset}>
          <div className={q.card}>
            <div className={q.section}>
              <div className={q.sectionHead}>
                <div>
                  <h4>Quotation details</h4>
                  <p>The service, who it is for, and its payment terms.</p>
                </div>
              </div>
              <div className={q.fields}>
                <div className={`${q.field} ${q.span2}`}>
                  <label htmlFor="qt-template">Service</label>
                  <select
                    id="qt-template"
                    className="form-select-box"
                    value={templateKey}
                    onChange={(e) => changeTemplate(e.target.value)}
                    disabled={!!quote}
                    title={template?.label}
                  >
                    {templates.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={`${q.field} ${q.span2}`}>
                  <label htmlFor="qt-client">Client (optional)</label>
                  <select
                    id="qt-client"
                    className="form-select-box"
                    value={head.clientId}
                    onChange={(e) => pickClient(e.target.value)}
                  >
                    <option value="">— prospect —</option>
                    {lookups.data?.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={`${q.field} ${q.span2}`}>
                  <label htmlFor="qt-toName">To</label>
                  <input
                    id="qt-toName"
                    className="form-field-box"
                    value={head.toName}
                    onChange={(e) => setHead({ ...head, toName: e.target.value })}
                  />
                </div>
                <div className={`${q.field} ${q.span2}`}>
                  <label htmlFor="qt-attn">Attn</label>
                  <input
                    id="qt-attn"
                    className="form-field-box"
                    value={head.attn}
                    onChange={(e) => setHead({ ...head, attn: e.target.value })}
                  />
                </div>
                <div className={q.field}>
                  <label htmlFor="qt-quoteDate">Date</label>
                  <input
                    id="qt-quoteDate"
                    type="date"
                    className="form-field-box"
                    value={head.quoteDate}
                    onChange={(e) => setHead({ ...head, quoteDate: e.target.value })}
                  />
                </div>
                <div className={q.field}>
                  <label htmlFor="qt-paymentTermDays">Payment term</label>
                  <div className={q.suffix}>
                    <NumberInput
                      id="qt-paymentTermDays"
                      decimals={0}
                      className="form-field-box"
                      value={head.paymentTermDays}
                      onChange={(e) => setHead({ ...head, paymentTermDays: e.target.value })}
                    />
                    <span>days</span>
                  </div>
                </div>
                <div className={q.field}>
                  <label htmlFor="qt-latePenaltyPctPerDay">Late penalty</label>
                  <div className={q.suffix}>
                    <NumberInput
                      id="qt-latePenaltyPctPerDay"
                      decimals={3}
                      className="form-field-box"
                      value={head.latePenaltyPctPerDay}
                      onChange={(e) => setHead({ ...head, latePenaltyPctPerDay: e.target.value })}
                    />
                    <span>% / day</span>
                  </div>
                </div>
              </div>
            </div>

            <div className={q.section}>
              <div className={q.sectionHead}>
                <div>
                  <h4>{template?.docTitle ?? 'Rates'}</h4>
                  <p>Type numbers or text such as “As per receipt”.</p>
                </div>
                <span className={q.count}>
                  {rows.length} {rows.length === 1 ? 'row' : 'rows'}
                </span>
              </div>
              <div className={q.tableWrap}>
                <table className={q.table}>
                  <colgroup>
                    <col className={q.no} />
                    {cols.map((c) => (
                      <col key={c.key} style={{ width: COL_WIDTH[c.type] }} />
                    ))}
                    <col className={q.actions} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={q.no}>#</th>
                      {cols.map((c) => (
                        <th key={c.key} className={c.type === 'num' ? q.num : undefined}>
                          {c.label}
                        </th>
                      ))}
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className={q.no}>{i + 1}</td>
                        {cols.map((c) => (
                          <td key={c.key} className={c.type === 'num' ? q.num : undefined}>
                            {c.type === 'remark' || c.type === 'wide' ? (
                              <textarea
                                className="form-field-box"
                                rows={1}
                                value={r[c.key] ?? ''}
                                onChange={(e) => setCell(i, c.key, e.target.value)}
                                aria-label={`${c.label} row ${i + 1}`}
                              />
                            ) : (
                              <input
                                className="form-field-box"
                                value={r[c.key] ?? ''}
                                onChange={(e) => setCell(i, c.key, e.target.value)}
                                aria-label={`${c.label} row ${i + 1}`}
                                title={r[c.key] || undefined}
                              />
                            )}
                          </td>
                        ))}
                        <td>
                          {editable && (
                            <button
                              type="button"
                              className={q.remove}
                              onClick={() => setRows(rows.filter((_, j) => j !== i))}
                              aria-label={`Remove row ${i + 1}`}
                              title="Remove row"
                            >
                              {icons.trash({})}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {editable && (
                <button
                  type="button"
                  className={q.addRow}
                  onClick={() =>
                    setRows([
                      ...rows,
                      Object.fromEntries(cols.map((c) => [c.key, c.key === 'ccy' ? 'USD' : ''])),
                    ])
                  }
                >
                  + Add row
                </button>
              )}
            </div>

            <div className={q.section}>
              <div className={q.sectionHead}>
                <div>
                  <h4>
                    <label htmlFor="qt-notes">Notes &amp; conditions</label>
                  </h4>
                  <p>Printed under the rates, one condition per line.</p>
                </div>
              </div>
              <textarea
                id="qt-notes"
                className={`form-field-box ${q.notes}`}
                rows={6}
                value={head.notes}
                onChange={(e) => setHead({ ...head, notes: e.target.value })}
              />
            </div>
          </div>
        </fieldset>
      </div>
    </section>
  );
}
