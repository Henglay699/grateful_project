import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  CONTAINER_SIZES,
  DEFAULT_CHARGE_UNITS,
  RECORD_SUMMARY_ITEMS,
  recordSummaryItems,
  vatMark,
  chargeLineAmount,
  chargeLineUnit,
  computeChargeLinesTotal,
  containerUnit,
  followShipmentUnit,
  shipmentChargeUnit,
  type BillingDoc,
  type CreditNoteReviewStatus,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useCompany,
  useDoc,
  useDocAction,
  useDocVatPercent,
  usePrefill,
  useRecordSummaryShipments,
  useSetRecordSummaryReview,
} from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
import { moveInLines } from '../../lib/lineKeys';
import { maskDeclareNo } from '../../lib/declareNo';
import { RecordSummary, transportLabel } from '../print/PrintDocPage';
import { Preview, useFillWindow } from '../creditnoted/CreditNotedEditor';
import { printCreditNote } from '../creditnoted/creditNoteExport';
import { exportRecordSummaryExcel, recordSummaryFileName } from './recordSummaryExport';
import { initialValues, priceOrZeroResolver, type Values } from './DocEditorPage';
import { DOC_STATUS_PILL } from './DocsListPage';
import { REVIEW, REVIEW_PILL, checkIcon } from './CreditNotesReview';
import { SummaryReviseModal } from './ExpenseToClients';
import { DotsMenu, type MenuAction } from '../plans/CargoSection';
import { fi } from '../plans/formIcons';
import { SupportDocumentsModal } from '../plans/SupportDocuments';
import s from '../creditnoted/CreditNotedEditor.module.css';
import r from './RecordSummaryEditor.module.css';

const TYPE = 'record-summaries' as const;
const blankLine = (unit: string) => ({ description: '', qty: '1', unit, unitPrice: '', mark: '' });
/** The Unit dropdown's "+ Add New" choice. */
const NEW_ITEM = '__new__';
/** A blank summary starts with the standard import / export breakdown; prices to fill. */
const itemsFor = (direction: unknown, shipUnit: string, vatPercent?: number) =>
  recordSummaryItems(direction === 'EXPORT' ? 'EXPORT' : 'IMPORT', vatPercent).map(
    ([description, mark]) => ({
      description,
      qty: '1',
      unit: chargeLineUnit(description, shipUnit),
      unitPrice: '',
      mark,
    }),
  );
/** The unit the summary's charges are billed in, from its transport type and container size. */
const shipUnitOf = (v: Partial<Values>) =>
  shipmentChargeUnit({
    transportMode: v.transportMode as string | undefined,
    loadType: v.loadType as string | undefined,
    containerSize: v.containerSize as string | undefined,
  });
/** An empty price is saved as 0: the line stays on the summary, off the sheet until priced. */
const priceOrZero = priceOrZeroResolver(TYPE);
/** "306 ROLLS" → ["306", "ROLLS"]: a quantity is saved as that one text. */
const splitQuantity = (t: string) => {
  const m = /^\s*([\d.,]*)\s*(.*?)\s*$/.exec(t);
  return [(m?.[1] ?? '').replace(/,/g, ''), (m?.[2] ?? '').toUpperCase()] as const;
};
/** The Transport Type dropdown: one choice sets both the mode and the load. */
const TRANSPORTS = [
  ['SEA', 'FCL'],
  ['SEA', 'LCL'],
  ['AIR', 'NONE'],
  ['ROAD', 'LCL'],
  ['ROAD', 'FCL'],
] as const;

/**
 * A record summary from either list: /record-summary/:id (sidebar) or
 * /accounting/record-summaries/:id; "new" for a new one. A new summary picks its shipment
 * from the Declare No. box, which fills it in from the shipping plan (and the Monthly Ledger
 * once the shipment is there).
 */
export function RecordSummaryRoute({ base }: { base: string }) {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const docId = id === 'new' ? undefined : id;
  const recordId = docId ? null : params.get('recordId');
  const declarationId = docId || recordId ? null : params.get('declarationId');
  const doc = useDoc(TYPE, docId);
  const pre = usePrefill(TYPE, recordId, declarationId);
  const lookups = useLookups();
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
  return (
    <RecordSummaryEditor
      key={`${id}-${recordId ?? declarationId ?? ''}`}
      base={base}
      doc={doc.data}
      prefill={pre.data}
    />
  );
}

/**
 * Record Summary Operations, laid out like the accounting engine: the form on the left, the
 * A4 sheet updating live on the right. "Submit to Monthly" issues it (locks it).
 */
function RecordSummaryEditor({
  base,
  doc,
  prefill,
}: {
  base: string;
  doc?: BillingDoc | undefined;
  prefill?: Record<string, unknown> | undefined;
}) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const lookups = useLookups();
  const company = useCompany();
  const action = useDocAction(TYPE);
  // ⋯ → Revise reopens a submitted summary for editing until it is resubmitted (or cancelled).
  const [reopened, setReopened] = useState(false);
  const editable =
    can('recordsummaries:write') &&
    (!doc || doc.status === 'DRAFT' || (reopened && doc.status === 'ISSUED'));
  const fresh = !doc && !prefill;
  const eligible = useRecordSummaryShipments();
  const defaults = useMemo(() => {
    const v = initialValues(TYPE, doc, prefill);
    if (!doc && !prefill) v.lines = itemsFor(v.direction, shipUnitOf(v));
    // An unpriced line shows an empty box (placeholder 0.00), not a 0 to delete first.
    v.lines = v.lines.map((l) => (Number(l.unitPrice) ? l : { ...l, unitPrice: '' }));
    return v;
  }, [doc, prefill]);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<Values>({
    resolver: priceOrZero as never,
    defaultValues: defaults,
  });
  const lines = useFieldArray({
    control: control as unknown as Control<Pick<Values, 'lines'>>,
    name: 'lines',
  });
  const values = useWatch({ control }) as Values;
  // Units follow the container size (SHIP for air / LCL; SET for the per-set charges) on every
  // line not given a unit of its own (DAY, CBM…), as the size or transport type changes.
  const shipUnit = shipUnitOf(values);
  useEffect(() => {
    if (!editable) return;
    getValues('lines').forEach((l, i) => {
      const unit = followShipmentUnit(l, shipUnit);
      if (l.unit !== unit) setValue(`lines.${i}.unit`, unit, { shouldDirty: true });
    });
  }, [shipUnit, editable, getValues, setValue]);
  // The processing fee carries VAT on top (see chargeLineAmount), at the percent in force on the
  // summary's date (Settings → Tax Management); a saved summary keeps its own while its
  // date stays.
  const vatPercent = useDocVatPercent(
    values.summaryDate as string | undefined,
    doc
      ? { date: doc.date, vatRate: doc.header.vatRate }
      : prefill
        ? { date: prefill.summaryDate as string, vatRate: prefill.vatRate as string }
        : null,
  );
  const total = computeChargeLinesTotal(values.lines ?? [], vatPercent);
  const client = lookups.data?.clients.find((c) => c.id === values.clientId);
  const declareNo = String(values.declareNo ?? '') || doc?.declareNo || '';

  // Descriptions: suggestions from Settings → Dropdown lists, still free text. Units: a
  // dropdown of the standard ones and Settings → Dropdown lists → Charge units, as on Credit Noted.
  const charges = [
    ...new Set([
      ...defaults.lines.map((l) => l.description).filter(Boolean),
      ...RECORD_SUMMARY_ITEMS.IMPORT.map(([d]) => d),
      ...RECORD_SUMMARY_ITEMS.EXPORT.map(([d]) => d),
      ...(lookups.data?.values.CHARGE ?? []).map((c) => c.label),
    ]),
  ];
  const units = [
    ...new Set([
      ...DEFAULT_CHARGE_UNITS,
      ...CONTAINER_SIZES.map(containerUnit),
      ...(lookups.data?.values.CHARGE_UNIT ?? []).map((u) => u.label),
    ]),
  ];
  /** "+ Add New" in a line's Unit dropdown: ask, use it, and add it to the list. */
  const chooseNewUnit = async (i: number, el: HTMLSelectElement, current: string) => {
    if (el.value !== NEW_ITEM) return false;
    el.value = current; // keep showing the old choice while asking
    const label = window.prompt('New unit')?.trim().toUpperCase();
    if (!label) return true;
    setValue(`lines.${i}.unit`, label, { shouldDirty: true, shouldValidate: true });
    try {
      await api('/lookups/charge-units', { method: 'POST', json: { label } });
      await qc.invalidateQueries({ queryKey: queryKeys.lookups });
    } catch {
      toast('Unit used on this line, but it could not be added to the list.');
    }
    return true;
  };

  // Quantity: a number box and a unit dropdown (Settings → Dropdown lists → Quantity units),
  // saved together as "306 ROLLS".
  const [qtyNum, qtyUnit] = splitQuantity(String(values.quantityText ?? ''));
  const qtyUnits = (lookups.data?.values.QUANTITY_UNIT ?? []).map((u) => u.label);
  const setQuantity = (num: string, unit: string) =>
    setValue('quantityText', [num, unit].filter(Boolean).join(' '), { shouldDirty: true });
  /** "+ Add New" in the Quantity unit dropdown: ask, use it, and add it to the list. */
  const chooseNewQtyUnit = async () => {
    const label = window.prompt('New quantity unit')?.trim().toUpperCase();
    if (!label) return;
    setQuantity(qtyNum, label);
    try {
      await api('/lookups/quantity-units', { method: 'POST', json: { label } });
      await qc.invalidateQueries({ queryKey: queryKeys.lookups });
    } catch {
      toast('Unit used on this summary, but it could not be added to the list.');
    }
  };

  /**
   * A Declare No. on a shipping plan: reopen as that shipment's summary, filled in (from its
   * Monthly Ledger row when it has one; it joins the row later otherwise).
   */
  const pickDeclareNo = (typed: string) => {
    if (doc) return;
    const hit = eligible.data?.find(
      (e) => e.declareNo.toUpperCase() === typed.trim().toUpperCase(),
    );
    if (!hit || hit.declareNo === prefill?.declareNo) return;
    navigate(
      `${base}/new?${hit.recordId ? `recordId=${hit.recordId}` : `declarationId=${hit.declarationId}`}`,
      { replace: true },
    );
  };

  // Live preview: the print layout fed with what's in the form right now.
  const preview = {
    id: doc?.id ?? 'preview',
    type: TYPE,
    number: null,
    date: String(values.summaryDate ?? ''),
    status: doc?.status ?? 'ISSUED',
    clientId: String(values.clientId ?? ''),
    clientCode: client?.code ?? '',
    clientName: client?.name ?? doc?.clientName ?? '',
    accountingRecordId: doc?.accountingRecordId ?? null,
    declareNo: declareNo || null,
    header: {
      ...Object.fromEntries(
        Object.entries(values)
          .filter(([k]) => k !== 'lines')
          .map(([k, v]) => [k, v === undefined || v === null ? null : String(v)]),
      ),
      vatRate: String(vatPercent),
    },
    lines: (values.lines ?? []).map((l, i) => ({
      id: String(i),
      lineNo: i + 1,
      description: l.description,
      qty: l.qty || '0',
      unit: l.unit,
      unitPrice: l.unitPrice || '0',
      subtotal: chargeLineAmount(l, vatPercent),
      mark: vatMark(l, vatPercent),
    })),
    totals: { subtotal: total, vat: '0', total },
    createdAt: doc?.createdAt ?? '',
    updatedAt: doc?.updatedAt ?? '',
  } as unknown as BillingDoc;

  const save = (after?: (saved: BillingDoc) => Promise<void> | void) =>
    handleSubmit(async (v) => {
      const saved = (
        doc
          ? await action.mutateAsync({ action: 'update', id: doc.id, body: v })
          : await action.mutateAsync({ action: 'create', body: v })
      ) as BillingDoc;
      if (after) await after(saved);
      else toast(doc ? 'Saved.' : 'Record summary saved as a draft.');
      if (!doc) navigate(`${base}/${saved.id}`, { replace: true });
    })();

  const submit = () =>
    save(async (saved) => {
      if (
        !window.confirm(
          `Submit the record summary for ${saved.declareNo ?? (declareNo || 'this shipment')}?\n\n` +
            'It is issued and can no longer be edited. Accounting checks it in Expense to ' +
            'Clients; once checked, its lines fill the Monthly Ledger: INV (the processing fee), ' +
            'DIS (lines marked Receipt) and DN (the rest, LOLO empty container included).',
        )
      )
        return;
      await action.mutateAsync({ action: 'issue', id: saved.id });
      toast('Record summary submitted.');
    });
  /**
   * Revise → Resubmit: the changes are saved and the summary goes back to accounting as Request
   * Revise. The Monthly Ledger keeps its approved amounts until accounting approves again.
   */
  const resubmit = () =>
    handleSubmit(async (v) => {
      if (!doc) return;
      if (
        !window.confirm(
          `Resubmit the record summary for ${doc.declareNo ?? 'this shipment'} to accounting?\n\n` +
            'It goes back as Request Revise. The Monthly Ledger keeps the approved INV, DIS and ' +
            'DN amounts until accounting approves the revision.',
        )
      )
        return;
      await action.mutateAsync({ action: 'resubmit', id: doc.id, body: v });
      setReopened(false);
      toast('Record summary resubmitted to accounting (Request Revise).');
    })();
  const cancelRevise = () => {
    reset(defaults);
    setReopened(false);
  };
  const voidDoc = async () => {
    if (!doc) return;
    const reason = window.prompt(
      'Why is this record summary being cancelled? (Kept in the audit log)',
    );
    if (!reason) return;
    await action.mutateAsync({ action: 'void', id: doc.id, body: { reason } });
    toast('Record summary cancelled.');
  };
  // Accounting's decision, from Accounting → Expense to Clients (not Operations' own list).
  const setReview = useSetRecordSummaryReview();
  const [revising, setRevising] = useState(false);
  const reviewStatus = doc?.header.reviewStatus as CreditNoteReviewStatus | undefined;
  const canDecide =
    base.startsWith('/accounting') && can('accounting:write') && doc?.status === 'ISSUED';
  // Opening an Unchecked summary marks it Reviewed, once.
  const markedReviewed = useRef(false);
  useEffect(() => {
    if (!canDecide || reviewStatus !== 'UNCHECKED' || markedReviewed.current || !doc) return;
    markedReviewed.current = true;
    setReview.mutate({ id: doc.id, reviewStatus: 'REVIEWED' });
  }, [canDecide, reviewStatus, doc, setReview]);
  const approve = () => {
    if (!doc) return;
    setReview.mutate(
      { id: doc.id, reviewStatus: 'CHECKED' },
      {
        onSuccess: ({ drafts }) =>
          toast(
            `${doc.declareNo ?? 'Record summary'} approved: INV, DIS and DN are in the Monthly Ledger${drafts ? `; ${drafts} draft${drafts === 1 ? '' : 's'} made in Client Billing` : ''}.`,
          ),
      },
    );
  };
  /** Delete a draft, or a cancelled summary for good (it is already out of the ledger). */
  const remove = async () => {
    if (!doc) return;
    const voided = doc.status === 'VOID';
    if (
      !window.confirm(
        voided
          ? `Delete the cancelled record summary for ${doc.declareNo ?? 'this shipment'} for good? This can't be undone.`
          : 'Delete this draft?',
      )
    )
      return;
    await action.mutateAsync({ action: 'delete', id: doc.id });
    toast(voided ? 'Cancelled record summary deleted.' : 'Draft deleted.');
    navigate(base, { replace: true });
  };

  // Print / PDF use the live preview, so what's on screen is what comes out.
  const sheetRef = useRef<HTMLDivElement>(null);
  const fileName = recordSummaryFileName(preview);
  const printSheet = (title: string) => {
    if (sheetRef.current) printCreditNote(sheetRef.current, title);
  };
  // Excel is built from the live preview too, laid out like the sheet (as Credit Noted's is).
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      await exportRecordSummaryExcel(
        preview,
        company.data ?? {},
        lookups.data?.ports.find((p) => p.id === values.portId)?.name,
        lookups.data?.forwarders.find((f) => f.id === values.forwarderId)?.name,
      );
    } catch {
      toast('Excel export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  // ⋯: change it (Revise, support files), then print / export, then delete.
  const [supportDocs, setSupportDocs] = useState(false);
  const canWrite = can('recordsummaries:write');
  const deleteAction: MenuAction | null =
    !doc || !canWrite
      ? null
      : {
          label: 'Delete',
          icon: icons.trash({}),
          // A submitted one is cancelled (out of the ledger, kept on record); others deleted.
          onClick: () => void (doc.status === 'ISSUED' ? voidDoc() : remove()),
          danger: true,
        };
  const menuActions: MenuAction[] = [
    ...(doc?.status === 'ISSUED' && canWrite && !canDecide && !reopened
      ? [{ label: 'Revise', icon: icons.edit({}), onClick: () => setReopened(true) }]
      : []),
    ...(doc && can('documents:read')
      ? [
          {
            label: 'Upload support documents',
            icon: icons.paperclip({}),
            onClick: () => setSupportDocs(true),
          },
        ]
      : []),
    {
      label: 'Print',
      icon: icons.printer({}),
      onClick: () => printSheet(document.title),
      title: 'Print the record summary as shown on the right',
      separated: true,
    },
    {
      label: 'PDF file',
      icon: fi.file({}),
      onClick: () => printSheet(fileName),
      title: `Choose "Save as PDF" in the print window (${fileName}.pdf)`,
    },
    {
      label: exporting ? 'Exporting…' : 'Export Excel',
      icon: icons.download({}),
      onClick: () => void exportExcel(),
      disabled: exporting,
      title: `${fileName}.xlsx`,
    },
    ...(deleteAction ? [{ ...deleteAction, separated: true }] : []),
  ];

  const err = (name: string) =>
    (errors as Record<string, { message?: string } | undefined>)[name]?.message;
  const lineErr = (i: number, f: string) =>
    (errors.lines as unknown as Record<number, Record<string, { message?: string }>> | undefined)?.[
      i
    ]?.[f]?.message;
  const item = (label: string, control: ReactNode, name?: string, amber = false) => (
    <label className={`${r.item}${amber ? ` ${r.amber}` : ''}`}>
      <span>{label}</span>
      {control}
      {name && <FieldError message={err(name)} />}
    </label>
  );
  const text = (name: string, label: string, opts: { type?: string } = {}) =>
    item(
      label,
      <input
        type={opts.type ?? 'text'}
        className="form-field-box"
        {...register(name)}
        aria-invalid={!!err(name)}
      />,
      name,
    );
  /**
   * INV / DIS / DN: frozen. They come from the Monthly Ledger (the server sends them live and
   * ignores anything typed), given when the accountant checks the shipment's Chea payment.
   */
  const linked = !!defaults.accountingRecordId;
  const ledgerNo = (name: 'invNo' | 'disNo' | 'dnNo', label: string) =>
    item(
      label,
      <input
        className={`form-field-box ${r.frozen}`}
        value={String(values[name] ?? '')}
        readOnly
        tabIndex={-1}
        placeholder={linked ? 'Awaiting accountant approval' : 'From the Monthly Ledger'}
        title="Synced from the accountant's Monthly Ledger; it can't be typed here."
        aria-readonly
      />,
      undefined,
      true,
    );
  const transport = `${String(values.transportMode ?? 'SEA')}|${String(values.loadType ?? 'FCL')}`;

  const wrapRef = useFillWindow();

  return (
    <section ref={wrapRef} className={`view active ${s.wrap}`}>
      <div className={s.editor}>
        <header className={s.head}>
          <div className={`${s.headText} ${backRow}`}>
            <BackLink
              to={base}
              label={base.startsWith('/accounting') ? 'Expense to Clients' : 'Record Summary'}
            />
            <h2>
              Record Summary Operations{' '}
              {doc && (
                <Pill tone={DOC_STATUS_PILL[doc.status].tone}>
                  {DOC_STATUS_PILL[doc.status].label}
                </Pill>
              )}{' '}
              {canDecide && reviewStatus ? (
                <Pill tone={REVIEW_PILL[reviewStatus]}>{REVIEW[reviewStatus].label}</Pill>
              ) : (
                doc?.status === 'ISSUED' && (
                  <Pill tone={reviewStatus ? REVIEW_PILL[reviewStatus] : 'pending'}>
                    {reviewStatus && reviewStatus !== 'UNCHECKED'
                      ? REVIEW[reviewStatus].label
                      : 'Awaiting check'}
                  </Pill>
                )
              )}
            </h2>
            <p>Live invoice numbers populate automatically from Monthly updates</p>
          </div>
          <div className={s.headActions}>
            {editable && !reopened && (
              <button
                type="button"
                className="btn-cancel-shipment"
                disabled={action.isPending}
                onClick={() => void save()}
              >
                Save draft
              </button>
            )}
            {editable && !reopened && (
              <button
                type="button"
                className={s.submit}
                disabled={action.isPending}
                onClick={() => void submit()}
              >
                {icons.send({ width: 15, height: 15 })} Submit to Monthly
              </button>
            )}
            {editable && reopened && (
              <>
                <button
                  type="button"
                  className="btn-cancel-shipment"
                  disabled={action.isPending}
                  onClick={cancelRevise}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={s.submit}
                  disabled={action.isPending}
                  onClick={() => void resubmit()}
                >
                  {icons.send({ width: 15, height: 15 })} Resubmit
                </button>
              </>
            )}
            {canDecide && doc && (
              <>
                <button
                  type="button"
                  className={s.headIcon}
                  disabled={setReview.isPending}
                  onClick={() => setRevising(true)}
                  aria-label="Revise: send back to Operations"
                  title="Revise: send back to Operations"
                >
                  {icons.edit({})}
                </button>
                {reviewStatus !== 'CHECKED' && (
                  <button
                    type="button"
                    className={s.submit}
                    disabled={setReview.isPending}
                    onClick={approve}
                  >
                    {checkIcon} Approve
                  </button>
                )}
              </>
            )}
            <DotsMenu label="More actions" className={s.headIcon} actions={menuActions} />
          </div>
        </header>
        {doc?.status === 'DRAFT' && doc.header.reviewStatus === 'REVISED' && (
          <div className={`${s.banner} ${s.bannerRevise}`} role="status">
            <div className={s.bannerHead}>
              <b>Returned by accounting for revision</b>
            </div>
            {doc.header.reviewNote && <p className={s.bannerBody}>{doc.header.reviewNote}</p>}
            <p className={s.bannerHint}>Make the changes, then press “Submit to Monthly” again.</p>
          </div>
        )}
        {reopened && (
          <div className={`${s.banner} ${s.bannerRevise}`} role="status">
            <div className={s.bannerHead}>
              <b>Revising a submitted record summary</b>
            </div>
            <p className={s.bannerHint}>
              Make the changes, then press “Resubmit”. Accounting sees it as Request Revise; the
              Monthly Ledger keeps the approved amounts until they approve it.
            </p>
          </div>
        )}
        <ErrorBanner error={action.error ?? setReview.error} />
        {supportDocs && doc && (
          <SupportDocumentsModal
            title={`Record summary ${doc.declareNo ?? ''}`.trim()}
            link={{ recordSummaryId: doc.id }}
            clientId={doc.clientId}
            onClose={() => setSupportDocs(false)}
          />
        )}
        {revising && doc && (
          <SummaryReviseModal
            row={{
              id: doc.id,
              declareNo: doc.declareNo,
              clientName: doc.clientName,
              total: doc.totals.total,
            }}
            onClose={() => setRevising(false)}
          />
        )}

        <form
          className={s.body}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <fieldset disabled={!editable} className={s.fieldset}>
            <Panel title="1. Record summary header">
              <div className={r.grid2}>
                {item(
                  'Shipment mode',
                  <select
                    className="form-select-box"
                    {...register('direction', {
                      // Still unpriced: switch to that direction's standard breakdown.
                      onChange: (e: { target: { value: string } }) => {
                        if (!(values.lines ?? []).some((l) => Number(l.unitPrice) > 0))
                          lines.replace(itemsFor(e.target.value, shipUnit, vatPercent));
                      },
                    })}
                  >
                    <option value="IMPORT">IMPORT</option>
                    <option value="EXPORT">EXPORT</option>
                  </select>,
                )}
                {item(
                  'Transport type',
                  <select
                    className="form-select-box"
                    value={transport}
                    onChange={(e) => {
                      const [mode, load] = e.target.value.split('|');
                      setValue('transportMode', mode, { shouldDirty: true });
                      setValue('loadType', load, { shouldDirty: true });
                      // An air shipment has no CBM: "NON", and cleared again on leaving air.
                      if (mode === 'AIR') setValue('cbm', 'NON', { shouldDirty: true });
                      else if (values.cbm === 'NON') setValue('cbm', '', { shouldDirty: true });
                    }}
                  >
                    {!TRANSPORTS.some(([m, l]) => `${m}|${l}` === transport) && (
                      <option value={transport}>
                        {transportLabel(String(values.transportMode), String(values.loadType))}
                      </option>
                    )}
                    {TRANSPORTS.map(([m, l]) => (
                      <option key={`${m}|${l}`} value={`${m}|${l}`}>
                        {transportLabel(m, l)}
                      </option>
                    ))}
                  </select>,
                )}
              </div>
              <div className={r.grid3}>
                {ledgerNo('invNo', 'Invoice no')}
                {ledgerNo('disNo', 'Disbursement no')}
                {ledgerNo('dnNo', 'Debit note no')}
              </div>
              <div className={r.grid2}>
                {item(
                  'Factory / client',
                  <select
                    className="form-select-box"
                    {...register('clientId')}
                    disabled={(!!defaults.accountingRecordId || !!prefill) && !!defaults.clientId}
                    aria-invalid={!!err('clientId')}
                  >
                    <option value="">-- Select factory --</option>
                    {lookups.data?.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>,
                  'clientId',
                )}
                {item(
                  'Forwarder',
                  <select className="form-select-box" {...register('forwarderId')}>
                    <option value="">—</option>
                    {lookups.data?.forwarders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>,
                )}
              </div>
              <div className={r.grid3}>
                {item(
                  'Port',
                  <select className="form-select-box" {...register('portId')}>
                    <option value="">—</option>
                    {lookups.data?.ports.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} · {p.name}
                      </option>
                    ))}
                  </select>,
                )}
                {(() => {
                  const reg = register('declareNo');
                  return item(
                    'Declare no',
                    <input
                      className="form-field-box"
                      list={doc ? undefined : 'rs-declares'}
                      // A revision stays on its declaration (its Monthly Ledger entry).
                      readOnly={reopened}
                      placeholder={doc ? undefined : 'e.g. I 122050'}
                      title={doc ? undefined : 'Pick an approved shipment to fill in its numbers'}
                      {...reg}
                      onChange={(e) => {
                        // A ledger shipment picked from the list is taken as it is listed.
                        const listed = eligible.data?.some(
                          (x) => x.declareNo.toUpperCase() === e.target.value.trim().toUpperCase(),
                        );
                        if (!listed) maskDeclareNo(e);
                        void reg.onChange(e);
                        pickDeclareNo(e.target.value);
                      }}
                    />,
                    'declareNo',
                  );
                })()}
                {text('summaryDate', 'Date', { type: 'date' })}
              </div>
              <div className={r.grid3}>
                <div className={r.pair}>
                  {item(
                    'Quantity',
                    <input
                      className="form-field-box"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="e.g. 306"
                      value={qtyNum}
                      onChange={(e) =>
                        setQuantity(
                          e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'),
                          qtyUnit,
                        )
                      }
                    />,
                    'quantityText',
                  )}
                  {item(
                    'Unit',
                    <select
                      className="form-select-box"
                      value={qtyUnit}
                      onChange={(e) =>
                        e.target.value === NEW_ITEM
                          ? void chooseNewQtyUnit()
                          : setQuantity(qtyNum, e.target.value)
                      }
                    >
                      <option value="">—</option>
                      {qtyUnit && !qtyUnits.includes(qtyUnit) && (
                        <option value={qtyUnit}>{qtyUnit}</option>
                      )}
                      {qtyUnits.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                      <option value={NEW_ITEM}>+ Add New</option>
                    </select>,
                  )}
                </div>
                {text('blNo', 'BL / HBL no')}
                {text('containerNo', 'Container no')}
              </div>
              <div className={r.grid3}>
                {item(
                  'Container size',
                  <select className="form-select-box" {...register('containerSize')}>
                    <option value="">—</option>
                    {CONTAINER_SIZES.map((v) => (
                      <option key={v} value={v}>
                        {v.replace(/^(\d+)/, "$1' ")}
                      </option>
                    ))}
                  </select>,
                )}
                {item(
                  'Gross weight (kg)',
                  <NumberInput
                    className="form-field-box"
                    decimals={3}
                    {...register('grossWeightKg')}
                  />,
                  'grossWeightKg',
                )}
                {item(
                  'CBM',
                  // Usually a number, sometimes a note such as "NON"; always "NON" by air.
                  <input
                    className="form-field-box"
                    placeholder="e.g. 61.5 or NON"
                    readOnly={values.transportMode === 'AIR'}
                    title={values.transportMode === 'AIR' ? 'Air shipments have no CBM' : undefined}
                    {...register('cbm')}
                    aria-invalid={!!err('cbm')}
                  />,
                  'cbm',
                )}
              </div>
              {fresh && editable && (
                <p className={r.hint}>
                  Type or pick the Declare No. of a shipment on the shipping plans: its details fill
                  in, and its invoice, DIS and debit note numbers follow the Monthly Ledger once the
                  accountant approves it.
                </p>
              )}
              <datalist id="rs-declares">
                {eligible.data?.map((e) => (
                  <option key={e.declarationId} value={e.declareNo}>
                    {e.clientCode} ·{' '}
                    {e.number ?? (e.recordId ? 'awaiting approval' : 'not in the ledger yet')}
                  </option>
                ))}
              </datalist>
            </Panel>

            <Panel title="2. Breakdown line items">
              <FieldError message={(errors.lines as { message?: string } | undefined)?.message} />
              {lines.fields.map((f, i) => (
                <div className={r.rowItem} key={f.id} onKeyDown={moveInLines}>
                  <span className={r.no}>{i + 1}</span>
                  <input
                    className={`form-field-box ${r.desc}`}
                    list="rs-charges"
                    {...register(`lines.${i}.description`, {
                      onChange: (e: { target: { value: string } }) => {
                        const unit = followShipmentUnit(
                          { description: e.target.value, unit: getValues(`lines.${i}.unit`) },
                          shipUnit,
                        );
                        if (unit !== getValues(`lines.${i}.unit`))
                          setValue(`lines.${i}.unit`, unit, { shouldDirty: true });
                      },
                    })}
                    aria-label={`Line ${i + 1} description`}
                    aria-invalid={!!lineErr(i, 'description')}
                    title={lineErr(i, 'description') ?? values.lines?.[i]?.description}
                  />
                  <NumberInput
                    className={`form-field-box ${r.qty}`}
                    decimals={3}
                    {...register(`lines.${i}.qty`)}
                    aria-label={`Line ${i + 1} quantity`}
                  />
                  {(() => {
                    const current = String(values.lines?.[i]?.unit ?? '');
                    const reg = register(`lines.${i}.unit`);
                    return (
                      <select
                        className={`form-select-box ${r.unit}`}
                        {...reg}
                        onChange={async (e) => {
                          if (!(await chooseNewUnit(i, e.target, current))) await reg.onChange(e);
                        }}
                        aria-label={`Line ${i + 1} unit`}
                        title={current}
                      >
                        {current && !units.includes(current) && (
                          <option value={current}>{current}</option>
                        )}
                        {units.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                        <option value={NEW_ITEM}>+ Add New</option>
                      </select>
                    );
                  })()}
                  <NumberInput
                    className={`form-field-box ${r.price}`}
                    decimals={4}
                    placeholder="0.00"
                    {...register(`lines.${i}.unitPrice`)}
                    aria-label={`Line ${i + 1} price`}
                    aria-invalid={!!lineErr(i, 'unitPrice')}
                    title={lineErr(i, 'unitPrice')}
                  />
                  <input
                    className={`form-field-box ${r.mark}`}
                    {...register(`lines.${i}.mark`)}
                    placeholder="Mark"
                    aria-label={`Line ${i + 1} mark`}
                  />
                  {editable && (
                    // The last line can't go (a summary needs one), so the button clears it.
                    <button
                      type="button"
                      className={r.del}
                      onClick={() =>
                        lines.fields.length > 1
                          ? lines.remove(i)
                          : lines.update(i, blankLine(shipUnit))
                      }
                      aria-label={`Remove line ${i + 1}`}
                      title={lines.fields.length > 1 ? 'Remove row' : 'Clear this row'}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <datalist id="rs-charges">
                {charges.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {editable && (
                <button
                  type="button"
                  className={r.addItem}
                  onClick={() => lines.append(blankLine(shipUnit))}
                >
                  + Add Custom Row
                </button>
              )}
              <div className={s.totalRow}>
                <span>Total</span>
                <b>{fmtMoney(total)}</b>
              </div>
            </Panel>
            {!editable && doc && (
              <p className={s.note}>
                {doc.status === 'DRAFT'
                  ? 'Read only for your role.'
                  : doc.status === 'ISSUED'
                    ? canWrite && !canDecide
                      ? 'Submitted. To change it, use ⋯ → Revise.'
                      : 'Submitted.'
                    : 'This record summary was cancelled.'}
              </p>
            )}
          </fieldset>
        </form>
      </div>

      <Preview label="Record Summary preview">
        <div ref={sheetRef}>
          <RecordSummary d={preview} c={company.data ?? {}} />
        </div>
      </Preview>
    </section>
  );
}

/** A numbered section that folds up from its grey header bar, as in the accounting engine. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`${r.panel}${open ? ` ${r.open}` : ''}`}>
      <button
        type="button"
        className={r.panelHead}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {title}
      </button>
      {open && <div className={r.panelBody}>{children}</div>}
    </section>
  );
}
