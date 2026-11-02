import { useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  BILLING_DOC_SCHEMAS,
  BILLING_DOC_TYPES,
  DEFAULT_CHARGE_UNITS,
  computeLinesTotal,
  computeTaxDocument,
  computeTaxLine,
  lineAmount,
  usdToKhr,
  vatLabel,
  type BillingDoc,
  type BillingDocType,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useCompany,
  useDocVatPercent,
  useDoc,
  useDocAction,
  useDocs,
  useLedgerRow,
  usePrefill,
} from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, FieldError, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { downloadFile } from '../../lib/files';
import { fmtDate, fmtMoney } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';
import { NotFoundPage } from '../NotFoundPage';
import { fi } from '../plans/formIcons';
import { DOC_CONFIG, type FieldDef } from './docConfig';
import { DOC_STATUS_PILL } from './DocsListPage';
import { PrintLink } from '../../components/PrintLink';
import dl from './DocLines.module.css';
import dh from './DocHeader.module.css';
import { CorrectDocDialog } from './CorrectDocDialog';
import { DeleteInvoiceDialog } from './DeleteInvoiceDialog';
import { PickShipment } from './PickShipment';
import { exportInvoiceExcel, INVOICE_EXCEL_TYPES } from './invoiceExport';

/** The three shipment documents: numbered from the Monthly Ledger, dated from clearance. */
const SHIPMENT_DOCS = ['tax-invoices', 'disbursements', 'debit-notes'] as const;
type ShipmentDoc = (typeof SHIPMENT_DOCS)[number];
const isShipmentDoc = (t: BillingDocType): t is ShipmentDoc =>
  (SHIPMENT_DOCS as readonly string[]).includes(t);

/** The usual fee items on the Excel pack, offered with Settings → Charge descriptions. */
const FEE_ITEMS: Record<ShipmentDoc, string[]> = {
  'tax-invoices': [
    'កំរៃសេវាបំពេញបែបបទនាំចេញ / EXPORT PROCESSING FEE',
    'កំរៃសេវាបំពេញបែបបទនាំចូល / IMPORT PROCESSING FEE',
  ],
  disbursements: ['LOLO AT PORT', 'CUSTOM PROCESSING FEE', 'HBL FEE', 'THC', 'STORAGE FEE'],
  'debit-notes': [
    'TRUCKING FEE',
    'HANDLING FEE',
    'INCREASE TRUCKING FEE(65%)',
    'DOCUMENT FEE',
    'SERVICE TAXATION',
    'PETROLL ALLOWANCE FEE',
    'FUEL SURCHARGE',
    'LOLO EMPTY CONTAINER',
  ],
};

export type Values = Record<string, unknown> & {
  clientId: string;
  lines: { description: string; qty: string; unit: string; unitPrice: string; mark: string }[];
};

export function DocEditorPage() {
  const { type = '', id = 'new' } = useParams();
  const [params] = useSearchParams();
  if (!(BILLING_DOC_TYPES as readonly string[]).includes(type)) return <NotFoundPage />;
  const t = type as BillingDocType;
  const clientId = params.get('clientId');
  const date = params.get('date');
  return (
    <Loader
      key={`${t}-${id}-${params.get('recordId') ?? ''}-${clientId ?? ''}`}
      type={t}
      id={id === 'new' ? undefined : id}
      recordId={params.get('recordId')}
      client={clientId && date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { clientId, date } : null}
    />
  );
}

/** Where "back" goes: the page that opened the editor (e.g. Client Billing), else the list. */
function useBack(type: BillingDocType) {
  const [params] = useSearchParams();
  const back = params.get('back');
  // Only paths inside accounting, never an outside URL.
  const safe = back && /^\/accounting(\/|\?|$)/.test(back) ? back : null;
  return {
    to: safe ?? `/accounting/${type}`,
    label: safe?.startsWith('/accounting/billing')
      ? 'Client Billing'
      : `${DOC_CONFIG[type].title}s`,
    /** Keep the way back when the URL changes (e.g. a new draft gets its id). */
    query: safe ? `?back=${encodeURIComponent(safe)}` : '',
  };
}

function Loader({
  type,
  id,
  recordId,
  client,
}: {
  type: BillingDocType;
  id?: string | undefined;
  recordId: string | null;
  client: { clientId: string; date: string } | null;
}) {
  const pick = !id && !recordId && !client && isShipmentDoc(type);
  const doc = useDoc(type, id);
  const pre = usePrefill(type, id || pick ? null : recordId, null, id || recordId ? null : client);
  const lookups = useLookups();
  // A new shipment document starts by choosing an approved shipment.
  if (pick) return <PickShipment type={type} />;
  if (doc.isLoading || pre.isLoading || lookups.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading…</div>
      </section>
    );
  if (doc.error || pre.error)
    return (
      <section className="view active">
        <ErrorBanner error={doc.error ?? pre.error} />
      </section>
    );
  return <Editor type={type} doc={doc.data} prefill={pre.data} />;
}

/**
 * The form resolver for documents with a standard list of items to price (Record Summary,
 * Credit Noted): an empty price is saved as 0, so the line stays in the editor but off the
 * sheet until priced (see pricedLines).
 */
export function priceOrZeroResolver(type: BillingDocType) {
  const base = formResolver(BILLING_DOC_SCHEMAS[type]);
  const resolver: typeof base = (values, ctx, options) =>
    base(
      {
        ...values,
        lines: (values.lines ?? []).map((l) => ({
          ...l,
          unitPrice: String(l.unitPrice ?? '').trim() || '0',
        })),
      },
      ctx,
      options,
    );
  return resolver;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

export function initialValues(
  type: BillingDocType,
  doc: BillingDoc | undefined,
  prefill: Record<string, unknown> | undefined,
): Values {
  const cfg = DOC_CONFIG[type];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(
    new Date(),
  );
  const header: Record<string, string> = {};
  for (const f of cfg.fields)
    header[f.name] =
      f.type === 'number'
        ? num((doc?.header ?? prefill)?.[f.name])
        : str((doc?.header ?? prefill)?.[f.name]);
  if (!header[cfg.dateField]) header[cfg.dateField] = today;
  if ('exchangeRate' in header && !header.exchangeRate) header.exchangeRate = '4026';
  if (type === 'record-summaries') {
    header.direction ||= 'IMPORT';
    header.transportMode ||= 'SEA';
    header.loadType ||= 'FCL';
  }
  const lines = (doc?.lines ?? (prefill?.lines as Values['lines'] | undefined) ?? []).map((l) => ({
    description: str(l.description),
    qty: num(l.qty),
    unit: str(l.unit),
    unitPrice: num(l.unitPrice),
    mark: str(l.mark),
  }));
  return {
    ...header,
    accountingRecordId: doc?.accountingRecordId ?? str(prefill?.accountingRecordId),
    clientId: doc?.clientId ?? str(prefill?.clientId),
    lines: lines.length
      ? lines
      : [{ description: '', qty: '1', unit: 'SHIP', unitPrice: '', mark: '' }],
  };
}

function Editor({
  type,
  doc,
  prefill,
}: {
  type: BillingDocType;
  doc?: BillingDoc | undefined;
  prefill?: Record<string, unknown> | undefined;
}) {
  const cfg = DOC_CONFIG[type];
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const company = useCompany();
  const lookups = useLookups();
  const action = useDocAction(type);
  const back = useBack(type);
  // An issued tax invoice, DIS or debit note can still be fixed; its number and date stay
  // (changed through "Correct number / date").
  const issuedEdit = doc?.status === 'ISSUED' && isShipmentDoc(type);
  const editable = can('accounting:write') && (!doc || doc.status === 'DRAFT' || issuedEdit);
  const defaults = useMemo(() => initialValues(type, doc, prefill), [type, doc, prefill]);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver: formResolver(BILLING_DOC_SCHEMAS[type]) as never,
    defaultValues: defaults,
  });
  // Header fields vary by document type (index signature), so give the field array a narrow view of the form.
  const lines = useFieldArray({
    control: control as unknown as Control<Pick<Values, 'lines'>>,
    name: 'lines',
  });
  const watched = useWatch({ control, name: 'lines' });
  const rate = useWatch({ control, name: 'exchangeRate' }) as unknown as string | undefined;
  const docDate = useWatch({ control, name: cfg.dateField }) as unknown as string | undefined;
  // The percent in force on the document's date (Settings → Tax Management); a saved
  // document keeps its own while its date stays.
  const vatPercent = useDocVatPercent(
    docDate,
    doc
      ? { date: doc.date, vatRate: doc.header.vatRate }
      : { date: str(prefill?.[cfg.dateField]), vatRate: str(prefill?.vatRate) || null },
  );
  const clientId = useWatch({ control, name: 'clientId' });
  /** Most shipments repeat the same charges: start from an earlier document's lines. */
  const copyLines = (src: BillingDoc) => {
    const filled = (watched ?? []).some((l) => l.description.trim() || Number(l.unitPrice));
    if (
      filled &&
      !window.confirm(
        `Replace the ${watched.length} line(s) here with the ${src.lines.length} of ${src.number ?? 'that document'}?`,
      )
    )
      return;
    lines.replace(
      src.lines.map((l) => ({
        description: l.description,
        qty: num(l.qty),
        unit: str(l.unit),
        unitPrice: num(l.unitPrice),
        mark: str(l.mark),
      })),
    );
    toast(`Lines copied from ${src.number ?? 'the document'}. Check quantities and prices.`);
  };

  const totals = cfg.tax
    ? computeTaxDocument(
        (watched ?? []).map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
        rate,
        vatPercent,
      )
    : (() => {
        const total = computeLinesTotal(
          (watched ?? []).map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
        );
        return {
          subtotal: total,
          vat: 0,
          total,
          totalKhr: cfg.khr ? usdToKhr(total, rate) : undefined,
        };
      })();

  const save = handleSubmit(async (values) => {
    const saved = doc
      ? await action.mutateAsync({ action: 'update', id: doc.id, body: values })
      : await action.mutateAsync({ action: 'create', body: values });
    toast(
      issuedEdit
        ? `Saved. ${cfg.title} stays issued${doc?.accountingRecordId ? '; the Monthly Ledger has the new total' : ''}.`
        : doc
          ? 'Saved.'
          : `${cfg.title} ${(saved as BillingDoc).number ?? ''} created as a draft.`,
    );
    if (!doc)
      navigate(`/accounting/${type}/${(saved as BillingDoc).id}${back.query}`, { replace: true });
  });
  const issue = async () => {
    if (!doc) return;
    if (isDirty) return toast('Save your changes before issuing.');
    if (
      !window.confirm(
        `Issue ${cfg.title} ${doc.number ?? ''}? ${isShipmentDoc(type) ? 'Its number and date are then fixed' : 'It can no longer be edited'}${cfg.numberField && type !== 'credit-notes' ? ', and its number and total go into the Monthly Ledger' : ''}.`,
      )
    )
      return;
    await action.mutateAsync({ action: 'issue', id: doc.id });
    toast(`${cfg.title} issued.`);
  };
  const [correcting, setCorrecting] = useState(false);
  const [deletingInvoice, setDeletingInvoice] = useState(false);
  const linked = !!defaults.accountingRecordId && isShipmentDoc(type);
  const ledger = useLedgerRow(
    doc?.accountingRecordId && isShipmentDoc(type) ? doc.accountingRecordId : null,
  );
  // Fee items and units: dropdown suggestions (Settings → Dropdown lists), still editable.
  const feeItems = [
    ...new Set([
      ...(isShipmentDoc(type) ? FEE_ITEMS[type] : []),
      ...(lookups.data?.values.CHARGE ?? []).map((c) => c.label),
    ]),
  ];
  const units = [
    ...new Set([
      ...DEFAULT_CHARGE_UNITS,
      '45H',
      '40H',
      '20H',
      'TRUCK',
      'SET',
      'TIME',
      'INV',
      'MONTH',
      ...(lookups.data?.values.CHARGE_UNIT ?? []).map((u) => u.label),
    ]),
  ];
  const voidDoc = async () => {
    if (!doc) return;
    const reason = window.prompt(
      'Why is this document being cancelled? It keeps its number. (Kept in the audit log)',
    );
    if (!reason) return;
    await action.mutateAsync({ action: 'void', id: doc.id, body: { reason } });
    toast(`${cfg.title} cancelled.`);
  };
  const remove = async () => {
    if (!doc || !window.confirm('Delete this draft?')) return;
    await action.mutateAsync({ action: 'delete', id: doc.id });
    toast('Draft deleted.');
    navigate(back.to);
  };

  const err = (name: string) =>
    (errors as Record<string, { message?: string } | undefined>)[name]?.message;
  const lineErr = (i: number, f: string) =>
    (errors.lines as unknown as Record<number, Record<string, { message?: string }>> | undefined)?.[
      i
    ]?.[f]?.message;

  /** One header field in its section's grid; long values wrap instead of being cut off. */
  const renderField = (f: FieldDef) => {
    // Never typed: the number (and, for a shipment, its date and rate) come from the ledger.
    const locked =
      (f.name === cfg.numberField && (isShipmentDoc(type) || issuedEdit)) ||
      ((linked || issuedEdit) && (f.name === cfg.dateField || f.name === 'exchangeRate'));
    const placeholder =
      f.name === cfg.numberField && isShipmentDoc(type) ? 'Given automatically' : f.placeholder;
    return (
      <div className={dh.field} data-half={f.half || undefined} key={f.name}>
        <label htmlFor={`d-${f.name}`} title={f.label}>
          {f.label}
        </label>
        {f.type === 'select' ? (
          <select id={`d-${f.name}`} className="form-select-box" {...register(f.name)}>
            <option value="">—</option>
            {lookups.data &&
              f.options?.(lookups.data).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        ) : f.type === 'number' ? (
          <NumberInput
            id={`d-${f.name}`}
            className="form-field-box"
            decimals={f.name === 'exchangeRate' ? 4 : 3}
            placeholder={placeholder}
            readOnly={locked}
            {...register(f.name)}
            aria-invalid={!!err(f.name)}
          />
        ) : f.type === 'textarea' ? (
          <textarea
            id={`d-${f.name}`}
            rows={2}
            className={`form-field-box ${dh.textarea}`}
            placeholder={placeholder}
            {...register(f.name)}
            aria-invalid={!!err(f.name)}
          />
        ) : (
          <input
            id={`d-${f.name}`}
            className={`form-field-box${/Km$/.test(f.name) ? ` ${dh.khmer}` : ''}`}
            type={f.type === 'date' ? 'date' : 'text'}
            placeholder={placeholder}
            readOnly={locked}
            title={
              locked
                ? issuedEdit
                  ? 'Issued: use "Correct number / date" to change it'
                  : 'From the Monthly Ledger'
                : undefined
            }
            {...register(f.name)}
            aria-invalid={!!err(f.name)}
          />
        )}
        <FieldError message={err(f.name)} />
      </div>
    );
  };

  return (
    <section className="view active">
      <div className="shipment-create-container">
        <div className="create-top-bar">
          <div className={backRow}>
            <BackLink to={back.to} label={back.label} />
            <div className="create-header-title">
              {cfg.title} {doc?.number ?? (doc ? (doc.declareNo ?? '') : '(new)')}{' '}
              {doc && (
                <Pill tone={DOC_STATUS_PILL[doc.status].tone}>
                  {DOC_STATUS_PILL[doc.status].label}
                </Pill>
              )}
            </div>
            <div className="create-header-desc">
              {(doc?.declareNo ?? str(prefill?.declareNo))
                ? `Declaration ${doc?.declareNo ?? str(prefill?.declareNo)}`
                : 'Not linked to a ledger entry'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {doc && (
              <PrintLink className="filter-btn" href={`/print/${type}/${doc.id}`}>
                Print / PDF
              </PrintLink>
            )}
            {doc && (
              <button
                type="button"
                className="filter-btn"
                onClick={() =>
                  // Tax invoice, disbursement and debit note: laid out like the printed sheet.
                  (INVOICE_EXCEL_TYPES.includes(type)
                    ? exportInvoiceExcel(doc, company.data ?? {})
                    : downloadFile(`/accounting/docs/${type}/${doc.id}/export.xlsx`)
                  ).catch(() => toast('Export failed.'))
                }
              >
                Excel
              </button>
            )}
            {can('accounting:write') && doc?.status === 'DRAFT' && (
              <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
                Delete draft
              </button>
            )}
            {can('accounting:write') &&
              doc?.status === 'ISSUED' &&
              (type === 'tax-invoices' || type === 'disbursements' || type === 'debit-notes') && (
                <button type="button" className="filter-btn" onClick={() => setCorrecting(true)}>
                  Correct number / date
                </button>
              )}
            {can('accounting:write') &&
              doc?.status === 'ISSUED' &&
              isShipmentDoc(type) &&
              doc.accountingRecordId && (
                <button
                  type="button"
                  className="btn-delete-shipment"
                  onClick={() => setDeletingInvoice(true)}
                >
                  Delete invoice
                </button>
              )}
            {can('accounting:write') && doc && doc.status !== 'VOID' && doc.status !== 'DRAFT' && (
              <button type="button" className="btn-delete-shipment" onClick={() => void voidDoc()}>
                Cancel document
              </button>
            )}
            {editable && (
              <button
                type="button"
                className="btn-cancel-shipment"
                onClick={() => void save()}
                disabled={action.isPending}
              >
                {issuedEdit ? 'Save changes' : doc ? 'Save draft' : 'Create draft'}
              </button>
            )}
            {can('accounting:write') && doc?.status === 'DRAFT' && (
              <button
                type="button"
                className="btn-create-submit"
                onClick={() => void issue()}
                disabled={action.isPending}
              >
                Issue
              </button>
            )}
          </div>
        </div>
        <ErrorBanner error={action.error} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <fieldset disabled={!editable} style={{ border: 'none', minWidth: 0 }}>
            <div className={`cx-card ${dh.card}`}>
              {(
                [
                  ['doc', `${cfg.title} details`, 'receipt'],
                  ['customer', type === 'debit-notes' ? 'Bill to' : 'Customer', 'building'],
                  ['ship', 'Shipment information', 'ship'],
                ] as const
              )
                .map(([group, title, icon]) => ({
                  group,
                  title,
                  icon,
                  fields: cfg.fields.filter((f) => (f.group ?? 'doc') === group),
                }))
                .filter((sec) => sec.group === 'doc' || sec.fields.length > 0)
                .map((sec) => (
                  <section key={sec.group} className={dh.section}>
                    <div className={dh.sectionHead}>
                      <h4>
                        <span className={`cx-title-icon ${dh.headIcon}`}>
                          {fi[sec.icon]({ width: 16, height: 16 })}
                        </span>
                        {sec.title}
                      </h4>
                    </div>
                    <div className={dh.fields}>
                      {sec.group === 'doc' && (
                        <div className={dh.field}>
                          <label htmlFor="d-clientId">Client</label>
                          <select
                            id="d-clientId"
                            className="form-select-box"
                            {...register('clientId')}
                            disabled={!!defaults.accountingRecordId || !editable || issuedEdit}
                          >
                            <option value="">Choose…</option>
                            {lookups.data?.clients.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <FieldError message={err('clientId')} />
                        </div>
                      )}
                      {sec.fields.map(renderField)}
                    </div>
                  </section>
                ))}
            </div>

            <div className="cx-card" style={{ marginTop: 16 }}>
              <div className="cx-card-head">
                <div className="cx-title">
                  <div>
                    <h3>Line items</h3>
                    <p>
                      {cfg.tax
                        ? `${vatLabel(vatPercent)} is added per line`
                        : 'No VAT on this document'}
                    </p>
                  </div>
                </div>
                {editable && (
                  <CopyLines type={type} clientId={clientId} exclude={doc?.id} onPick={copyLines} />
                )}
              </div>
              <FieldError message={(errors.lines as { message?: string } | undefined)?.message} />
              <div className={dl.wrap}>
                <table className={dl.table}>
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>Description</th>
                      <th className={dl.num} style={{ width: 84 }}>
                        Qty
                      </th>
                      <th style={{ width: 92 }}>Unit</th>
                      <th className={dl.num} style={{ width: 116 }}>
                        Unit price
                      </th>
                      {cfg.tax ? (
                        <>
                          <th className={dl.num}>Sub total</th>
                          <th className={dl.num}>{vatLabel(vatPercent)}</th>
                          <th className={dl.num}>Amount</th>
                        </>
                      ) : (
                        <>
                          <th style={{ width: 130 }}>Mark</th>
                          <th className={dl.num}>Total</th>
                        </>
                      )}
                      <th style={{ width: 40 }} aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.fields.map((f, i) => {
                      const l = watched?.[i];
                      const tl = cfg.tax
                        ? computeTaxLine({ qty: l?.qty, unitPrice: l?.unitPrice }, vatPercent)
                        : null;
                      return (
                        <tr key={f.id}>
                          <td>
                            <span className={dl.no}>{i + 1}</span>
                          </td>
                          <td style={{ minWidth: 280 }}>
                            <input
                              className="form-field-box"
                              placeholder="Choose or type a fee item"
                              list="doc-fee-items"
                              {...register(`lines.${i}.description`)}
                              aria-invalid={!!lineErr(i, 'description')}
                            />
                            <FieldError message={lineErr(i, 'description')} />
                          </td>
                          <td>
                            <NumberInput
                              className={`form-field-box ${dl.numIn}`}
                              decimals={3}
                              {...register(`lines.${i}.qty`)}
                              aria-invalid={!!lineErr(i, 'qty')}
                            />
                          </td>
                          <td>
                            <input
                              className="form-field-box"
                              placeholder="SHIP"
                              list="doc-units"
                              {...register(`lines.${i}.unit`)}
                            />
                          </td>
                          <td>
                            <NumberInput
                              className={`form-field-box ${dl.numIn}`}
                              decimals={4}
                              placeholder="0.00"
                              {...register(`lines.${i}.unitPrice`)}
                              aria-invalid={!!lineErr(i, 'unitPrice')}
                            />
                            <FieldError message={lineErr(i, 'unitPrice')} />
                          </td>
                          {tl ? (
                            <>
                              <td>
                                <span className={dl.calc}>{fmtMoney(tl.subtotal)}</span>
                              </td>
                              <td>
                                <span className={dl.calc}>{fmtMoney(tl.vat)}</span>
                              </td>
                              <td>
                                <span className={`${dl.calc} ${dl.calcStrong}`}>
                                  {fmtMoney(tl.amount)}
                                </span>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <input
                                  className="form-field-box"
                                  placeholder="Mark"
                                  {...register(`lines.${i}.mark`)}
                                />
                              </td>
                              <td>
                                <span className={`${dl.calc} ${dl.calcStrong}`}>
                                  {fmtMoney(lineAmount(l?.qty, l?.unitPrice))}
                                </span>
                              </td>
                            </>
                          )}
                          <td>
                            {editable && lines.fields.length > 1 && (
                              <button
                                type="button"
                                className="cdc-remove-line-btn"
                                style={{ marginTop: 4 }}
                                onClick={() => lines.remove(i)}
                                title="Remove line"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={dl.foot}>
                {editable && (
                  <button
                    type="button"
                    className="cdc-add-line-btn"
                    style={{ marginTop: 0 }}
                    onClick={() =>
                      lines.append({
                        description: '',
                        qty: '1',
                        unit: 'SHIP',
                        unitPrice: '',
                        mark: '',
                      })
                    }
                  >
                    + Add line
                  </button>
                )}
                <div className={dl.totals}>
                  {cfg.tax && (
                    <>
                      <div>
                        <span>Sub total</span>
                        <b>{fmtMoney(totals.subtotal)}</b>
                      </div>
                      <div>
                        <span>{vatLabel(vatPercent)}</span>
                        <b>{fmtMoney(totals.vat)}</b>
                      </div>
                    </>
                  )}
                  <div className={dl.grand}>
                    <span>Grand total</span>
                    <b>{fmtMoney(totals.total)}</b>
                  </div>
                  {'totalKhr' in totals && totals.totalKhr !== undefined && (
                    <div className={dl.riel}>
                      <span>In riel</span>
                      <b>{Number(totals.totalKhr).toLocaleString('en-US')} KHR</b>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </fieldset>
          <datalist id="doc-fee-items">
            {feeItems.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="doc-units">
            {units.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </form>
        {!editable && doc && (
          <p className={ui.dialogSub} style={{ marginTop: 12 }}>
            {doc.status === 'DRAFT'
              ? 'Read only for your role.'
              : `This document is ${doc.status === 'VOID' ? 'cancelled' : doc.status.toLowerCase()} and can't be edited.`}
          </p>
        )}
      </div>
      {correcting && doc && (
        <CorrectDocDialog doc={doc} title={cfg.title} onClose={() => setCorrecting(false)} />
      )}
      {deletingInvoice && doc?.accountingRecordId && (
        <DeleteInvoiceDialog
          recordId={doc.accountingRecordId}
          declareNo={doc.declareNo ?? ''}
          numbers={
            ledger.data
              ? [ledger.data.invNo, ledger.data.disNo, ledger.data.dnNo].filter(
                  (x): x is string => !!x,
                )
              : doc.number
                ? [doc.number]
                : []
          }
          onClose={() => setDeletingInvoice(false)}
          onDeleted={() => navigate(back.to)}
        />
      )}
    </section>
  );
}

/** "Copy lines from…": the client's recent issued documents of this type. */
function CopyLines({
  type,
  clientId,
  exclude,
  onPick,
}: {
  type: BillingDocType;
  clientId: string;
  exclude: string | undefined;
  onPick: (doc: BillingDoc) => void;
}) {
  const recent = useDocs(type, { clientId, status: 'ISSUED', pageSize: 15 }, !!clientId);
  const [busy, setBusy] = useState(false);
  const options = (recent.data?.data ?? []).filter((d) => d.id !== exclude);
  if (!clientId || !options.length) return null;
  return (
    <select
      className="form-select-box"
      style={{ width: 'auto', maxWidth: 320 }}
      value=""
      disabled={busy}
      aria-label="Copy lines from an earlier document"
      onChange={(e) => {
        const id = e.target.value;
        if (!id) return;
        setBusy(true);
        api<BillingDoc>(`/accounting/docs/${type}/${id}`)
          .then(onPick)
          .finally(() => setBusy(false));
      }}
    >
      <option value="">{busy ? 'Copying…' : 'Copy lines from…'}</option>
      {options.map((d) => (
        <option key={d.id} value={d.id}>
          {d.number ?? '—'} · {fmtDate(d.date)} · {fmtMoney(d.total)}
          {d.declareNo ? ` · ${d.declareNo}` : ''}
        </option>
      ))}
    </select>
  );
}
