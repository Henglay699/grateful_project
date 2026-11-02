import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  CONTAINER_SIZES,
  DEFAULT_CHARGE_UNITS,
  chargeLineAmount,
  computeChargeLinesTotal,
  vatMark,
  containerUnit,
  followShipmentUnit,
  type BillingDoc,
  type CreditNoteReviewStatus,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useCompany,
  useCreditNoteMessages,
  useDoc,
  useDocAction,
  useDocVatPercent,
  usePrefill,
  useSetCreditNoteReview,
} from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { maskDeclareNo } from '../../lib/declareNo';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
import { moveInLines } from '../../lib/lineKeys';
import { initialValues, priceOrZeroResolver, type Values } from '../accounting/DocEditorPage';
import { DOC_STATUS_PILL } from '../accounting/DocsListPage';
import { REVIEW, REVIEW_PILL, ReviseModal, checkIcon } from '../accounting/CreditNotesReview';
import { CreditNote } from '../print/PrintDocPage';
import { DotsMenu, type MenuAction } from '../plans/CargoSection';
import { fi } from '../plans/formIcons';
import { SupportDocumentsModal } from '../plans/SupportDocuments';
import ps from '../print/print.module.css';
import { timeAgo } from './Inbox';
import { cnSeq } from './seq';
import { creditNoteFileName, exportCreditNoteExcel, printCreditNote } from './creditNoteExport';
import s from './CreditNotedEditor.module.css';

const TYPE = 'credit-notes' as const;
const CN_STATUS_LABEL = { DRAFT: 'Draft', ISSUED: 'Submitted', VOID: 'Discarded' } as const;
const A4_WIDTH = 794; // 210mm at 96dpi

/** The "+ Add New Item" choice in a line's description dropdown. */
const NEW_ITEM = '__new__';

/**
 * The unit the note's charges are billed in, read from the Container box ("MRKU8974303
 * (1X40'HQ)" → 40'HQ). No size there (air, LCL) → SHIP.
 */
export function creditNoteShipUnit(containerNo: unknown): string {
  const m = /\b(\d{2})\s*'?\s*(GP|HQ|HC)\b/i.exec(String(containerNo ?? ''));
  return m ? containerUnit(`${m[1]}${m[2]!.toUpperCase()}`) : 'SHIP';
}
const blankLine = (unit: string) => ({ description: '', qty: '1', unit, unitPrice: '', mark: '' });
const priceOrZero = priceOrZeroResolver(TYPE);

/** /credit-noted/:id (or /accounting/credit-notes/:id): loads the note or a fresh draft. */
export function CreditNotedRoute({ base }: { base: string }) {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const docId = id === 'new' ? undefined : id;
  const recordId = docId ? null : params.get('recordId');
  const declarationId = docId ? null : params.get('declarationId');
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
    <CreditNotedEditor
      key={`${id}-${recordId ?? ''}-${declarationId ?? ''}`}
      base={base}
      doc={doc.data}
      prefill={pre.data}
    />
  );
}

/**
 * Credit Noted (Chea / customs broker payment voucher), laid out like the accounting
 * engine: the form on the left, the A4 voucher updating live on the right.
 * "Submit to Monthly" issues it; its total becomes the declaration's Clear Fee.
 */
function CreditNotedEditor({
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
  const lookups = useLookups();
  const company = useCompany();
  const action = useDocAction(TYPE);
  // ⋯ → Revise reopens a submitted note for editing until it is resubmitted (or cancelled).
  const [reopened, setReopened] = useState(false);
  const editable =
    can('creditnotes:write') &&
    (!doc || doc.status === 'DRAFT' || (reopened && doc.status === 'ISSUED'));
  const defaults = useMemo(() => {
    const v = initialValues(TYPE, doc, prefill);
    // A blank note bills the company, as the broker's vouchers always do.
    if (!v.billTo && company.data?.nameEn) v.billTo = company.data.nameEn.toUpperCase();
    if (!v.address && company.data?.addressEn) v.address = company.data.addressEn;
    if (!v.refType) v.refType = 'HOUSE_BILL';
    // An unpriced line shows an empty box (placeholder 0.00), not a 0 to delete first.
    v.lines = v.lines.map((l) => (Number(l.unitPrice) ? l : { ...l, unitPrice: '' }));
    return v;
  }, [doc, prefill, company.data]);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<Values>({
    // An empty price is saved as 0: the item stays on the note, off the voucher until priced.
    resolver: priceOrZero as never,
    defaultValues: defaults,
  });
  const lines = useFieldArray({
    control: control as unknown as Control<Pick<Values, 'lines'>>,
    name: 'lines',
  });
  const values = useWatch({ control }) as Values;

  // Units follow the container size in the Container box (SHIP without one; SET for the
  // per-set charges) on every line not given a unit of its own (DAY, CBM…).
  const shipUnit = creditNoteShipUnit(values.containerNo);
  useEffect(() => {
    if (!editable) return;
    getValues('lines').forEach((l, i) => {
      const unit = followShipmentUnit(l, shipUnit);
      if (l.unit !== unit) setValue(`lines.${i}.unit`, unit, { shouldDirty: true });
    });
  }, [shipUnit, editable, getValues, setValue]);
  /** A line's description changed: PERMIT FEE and the like go to SET, others back to the shipment's. */
  const reunit = (i: number) => {
    const unit = followShipmentUnit(getValues(`lines.${i}`), shipUnit);
    if (unit !== getValues(`lines.${i}.unit`))
      setValue(`lines.${i}.unit`, unit, { shouldDirty: true });
  };

  // The company details may load after the form opened: fill Bill to / Address if still empty.
  useEffect(() => {
    if (!editable || !company.data) return;
    if (!getValues('billTo') && company.data.nameEn)
      setValue('billTo', company.data.nameEn.toUpperCase());
    if (!getValues('address') && company.data.addressEn)
      setValue('address', company.data.addressEn);
  }, [company.data, editable, getValues, setValue]);

  // Line descriptions come from Settings → Dropdown lists → Charge descriptions.
  const qc = useQueryClient();
  const charges = (lookups.data?.values.CHARGE ?? []).map((c) => c.label);
  // Units: the standard ones, then any added to Settings → Dropdown lists → Charge units.
  const units = [
    ...new Set([
      ...DEFAULT_CHARGE_UNITS,
      ...CONTAINER_SIZES.map(containerUnit),
      ...(lookups.data?.values.CHARGE_UNIT ?? []).map((u) => u.label),
    ]),
  ];
  /** "+ Add New" in a line's Description or Unit dropdown: ask, use it, and add it to the list. */
  const chooseNew = async (
    i: number,
    field: 'description' | 'unit',
    el: HTMLSelectElement,
    current: string,
  ) => {
    if (el.value !== NEW_ITEM) return false;
    el.value = current; // keep showing the old choice while asking
    const typed = window.prompt(field === 'unit' ? 'New unit' : 'New item description')?.trim();
    if (!typed) return true;
    const label = typed.toUpperCase();
    setValue(`lines.${i}.${field}`, label, { shouldDirty: true, shouldValidate: true });
    if (field === 'description') reunit(i);
    // Also add it to the list so it's there next time (already there = no change).
    try {
      await api(field === 'unit' ? '/lookups/charge-units' : '/lookups/charges', {
        method: 'POST',
        json: { label },
      });
      await qc.invalidateQueries({ queryKey: queryKeys.lookups });
    } catch {
      toast(
        `${field === 'unit' ? 'Unit' : 'Item'} used on this line, but it could not be added to the list.`,
      );
    }
    return true;
  };
  // The import / export processing fee carries VAT on top (see chargeLineAmount), at the percent
  // in force on the note's date; a saved note keeps its own while its date stays.
  const vatPercent = useDocVatPercent(
    values.cnDate as string | undefined,
    doc
      ? { date: doc.date, vatRate: doc.header.vatRate }
      : prefill
        ? { date: prefill.cnDate as string, vatRate: prefill.vatRate as string }
        : null,
  );
  const total = computeChargeLinesTotal(values.lines ?? [], vatPercent);

  // Live preview: the print layout fed with what's in the form right now.
  const preview: BillingDoc = {
    id: doc?.id ?? 'preview',
    type: TYPE,
    number: doc?.number ?? '',
    date: String(values.cnDate ?? ''),
    status: doc?.status ?? 'ISSUED',
    clientId: String(values.clientId ?? ''),
    clientCode: '',
    clientName: '',
    accountingRecordId: doc?.accountingRecordId ?? null,
    declareNo: String(values.declareNo ?? '') || null,
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
      else toast(doc ? 'Saved.' : `Credit Noted No. ${cnSeq(saved.number)} saved as a draft.`);
      if (!doc) navigate(`${base}/${saved.id}`, { replace: true });
    })();

  const submit = () =>
    save(async (saved) => {
      if (
        !window.confirm(
          `Submit Credit Noted No. ${cnSeq(saved.number)} to the Monthly Ledger?\n\n` +
            `${fmtMoney(saved.totals.total)} becomes the Clear Fee of declaration ${saved.declareNo ?? '(none)'}, ` +
            `and the credit note can no longer be edited.`,
        )
      )
        return;
      await action.mutateAsync({ action: 'issue', id: saved.id });
      toast(`Credit Noted No. ${cnSeq(saved.number)} submitted to the Monthly Ledger.`);
    });

  /**
   * Revise → Resubmit: the changes are saved and the note goes back to accounting as Request
   * Revise. The Monthly Ledger keeps its approved Clear Fee until accounting approves again.
   */
  const resubmit = () =>
    handleSubmit(async (v) => {
      if (!doc) return;
      if (
        !window.confirm(
          `Resubmit Credit Noted No. ${cnSeq(doc.number)} to accounting?\n\n` +
            'It goes back as Request Revise. The Monthly Ledger keeps the approved Clear Fee ' +
            'until accounting approves the revision.',
        )
      )
        return;
      await action.mutateAsync({ action: 'resubmit', id: doc.id, body: v });
      setReopened(false);
      toast(`Credit Noted No. ${cnSeq(doc.number)} resubmitted to accounting (Request Revise).`);
    })();
  const cancelRevise = () => {
    reset(defaults);
    setReopened(false);
  };

  /** Discard (cancel) a submitted note: its Clear Fee comes back out of the Monthly Ledger. */
  const discard = async () => {
    if (!doc) return;
    const reason = window.prompt(
      'Why discard this credit note? Its Clear Fee is taken back out of the Monthly Ledger.',
    );
    if (!reason) return;
    await action.mutateAsync({ action: 'void', id: doc.id, body: { reason } });
    toast('Credit Noted discarded.');
  };
  // Accounting's decision, from Accounting → Chea Payments (not the broker's own Credit Noted).
  const setReview = useSetCreditNoteReview();
  const [revising, setRevising] = useState(false);
  const reviewStatus = doc?.header.reviewStatus as CreditNoteReviewStatus | undefined;
  const canDecide =
    base.startsWith('/accounting') && can('accounting:write') && doc?.status === 'ISSUED';
  // Opening an Unchecked note marks it Reviewed, once.
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
        // Approved: into the Monthly Ledger with its INV / DIS / DN numbers.
        onSuccess: ({ numbered }) => {
          const mine = numbered.find((x) => x.declareNo === doc.declareNo);
          toast(
            mine
              ? `${doc.declareNo} approved: ${mine.numbers.map((x) => x.number).join(' · ')} in the Monthly Ledger.`
              : `${doc.declareNo ?? `Credit Noted No. ${cnSeq(doc.number)}`} approved.`,
          );
        },
      },
    );
  };
  /** Delete a draft, or a discarded note for good (it is already out of the ledger). */
  const remove = async () => {
    if (!doc) return;
    const voided = doc.status === 'VOID';
    if (
      !window.confirm(
        voided
          ? `Delete discarded Credit Noted No. ${cnSeq(doc.number)} for good? This can't be undone.`
          : 'Delete this draft?',
      )
    )
      return;
    await action.mutateAsync({ action: 'delete', id: doc.id });
    toast(voided ? 'Discarded credit note deleted.' : 'Draft deleted.');
    navigate(base);
  };
  // Print / PDF / Excel use the live preview, so what's on screen is what comes out.
  const sheetRef = useRef<HTMLDivElement>(null);
  const portName = lookups.data?.ports.find((p) => p.id === values.portId)?.name;
  const printSheet = (title: string) => {
    if (sheetRef.current) printCreditNote(sheetRef.current, title);
  };
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      await exportCreditNoteExcel(preview, portName);
    } catch {
      toast('Excel export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  // ⋯: change it (Revise, support files), then print / export, then delete.
  const [supportDocs, setSupportDocs] = useState(false);
  const deleteAction: MenuAction | null = !doc
    ? null
    : doc.status === 'ISSUED'
      ? can('accounting:write')
        ? { label: 'Delete', icon: icons.trash({}), onClick: () => void discard(), danger: true }
        : null
      : can('creditnotes:write')
        ? { label: 'Delete', icon: icons.trash({}), onClick: () => void remove(), danger: true }
        : null;
  const menuActions: MenuAction[] = [
    ...(doc?.status === 'ISSUED' && can('creditnotes:write') && !canDecide && !reopened
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
      title: 'Print the credit note as shown on the right',
      separated: true,
    },
    {
      label: 'PDF file',
      icon: fi.file({}),
      onClick: () => printSheet(creditNoteFileName(preview)),
      title: `Choose "Save as PDF" in the print window (${creditNoteFileName(preview)}.pdf)`,
    },
    {
      label: exporting ? 'Exporting…' : 'Export Excel',
      icon: icons.download({}),
      onClick: () => void exportExcel(),
      disabled: exporting,
      title: `${creditNoteFileName(preview)}.xlsx`,
    },
    ...(deleteAction ? [{ ...deleteAction, separated: true }] : []),
  ];

  const err = (name: string) =>
    (errors as Record<string, { message?: string } | undefined>)[name]?.message;
  const lineErr = (i: number, f: string) =>
    (errors.lines as unknown as Record<number, Record<string, { message?: string }>> | undefined)?.[
      i
    ]?.[f]?.message;
  // Bill to / Address come from Settings → Company and can't be typed over. Until the company
  // has them set, the box stays editable so it is never stuck empty.
  const lockBillTo = !!company.data?.nameEn;
  const lockAddress = !!company.data?.addressEn;
  const LOCKED_HINT = 'From Settings → Company. Change it there.';
  const field = (
    name: string,
    label: string,
    opts: {
      type?: string;
      span?: boolean;
      locked?: boolean;
      decimals?: number;
      onInput?: (e: ChangeEvent<HTMLInputElement>) => void;
    } = {},
  ) => {
    const reg = register(name);
    const props = {
      className: `form-field-box${opts.locked ? ` ${s.locked}` : ''}`,
      ...reg,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        opts.onInput?.(e);
        return reg.onChange(e);
      },
      readOnly: opts.locked,
      title: opts.locked ? LOCKED_HINT : undefined,
      'aria-invalid': !!err(name),
    };
    return (
      <label className={s.field} style={opts.span ? { gridColumn: '1 / -1' } : undefined}>
        <span>{label}</span>
        {opts.decimals !== undefined ? (
          <NumberInput decimals={opts.decimals} {...props} />
        ) : (
          <input type={opts.type ?? 'text'} {...props} />
        )}
        <FieldError message={err(name)} />
      </label>
    );
  };

  const wrapRef = useFillWindow();

  return (
    <section ref={wrapRef} className={`view active ${s.wrap}`}>
      <div className={s.editor}>
        <header className={s.head}>
          <div className={`${s.headText} ${backRow}`}>
            <BackLink to={base} label="Credit Noted" />
            <h2>
              Credit Noted (Chea Payment){' '}
              {doc?.number && <span className={s.number}>No. {cnSeq(doc.number)}</span>}{' '}
              {doc && (
                <Pill tone={DOC_STATUS_PILL[doc.status].tone}>{CN_STATUS_LABEL[doc.status]}</Pill>
              )}{' '}
              {reviewStatus &&
                (canDecide || (doc?.status === 'ISSUED' && reviewStatus !== 'UNCHECKED')) && (
                  <Pill tone={REVIEW_PILL[reviewStatus]}>{REVIEW[reviewStatus].label}</Pill>
                )}
            </h2>
            <p>Generate clean payment vouchers for operations &amp; finance</p>
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
                  aria-label="Revise: send back to the broker"
                  title="Revise: send back to the broker"
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
        {reopened ? (
          <div className={`${s.banner} ${s.bannerRevise}`} role="status">
            <div className={s.bannerHead}>
              <b>Revising a submitted credit note</b>
            </div>
            <p className={s.bannerHint}>
              Make the changes, then press “Resubmit”. Accounting sees it as Request Revise; the
              Monthly Ledger keeps the approved Clear Fee until they approve it.
            </p>
          </div>
        ) : (
          <ReviewBanner doc={doc} />
        )}
        <ErrorBanner error={action.error ?? setReview.error} />
        {supportDocs && doc && (
          <SupportDocumentsModal
            title={`Credit Noted No. ${cnSeq(doc.number)}`}
            link={{ creditNoteId: doc.id }}
            clientId={doc.clientId}
            onClose={() => setSupportDocs(false)}
          />
        )}
        {revising && doc && (
          <ReviseModal
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
            <section className={s.card}>
              <h3>1. Header information</h3>
              <div className={s.grid}>
                {field('billTo', 'Bill to', { span: true, locked: lockBillTo })}
                {field('cnDate', 'Date', { type: 'date' })}
                {field('declareNo', 'Declare no', {
                  onInput: maskDeclareNo,
                  // A revision stays on its declaration (its Monthly Ledger entry).
                  locked: reopened,
                })}
                <label className={s.field}>
                  <span>Client</span>
                  <select
                    className="form-select-box"
                    {...register('clientId')}
                    disabled={!!defaults.declareNo && !!defaults.clientId}
                  >
                    <option value="">Choose…</option>
                    {lookups.data?.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <FieldError message={err('clientId')} />
                </label>
                {field('shipper', 'Shipper / factory')}
                <label className={s.field} style={{ gridColumn: '1 / -1' }}>
                  <span>Address</span>
                  <textarea
                    rows={2}
                    className={`form-field-box${lockAddress ? ` ${s.locked}` : ''}`}
                    {...register('address')}
                    readOnly={lockAddress}
                    title={lockAddress ? LOCKED_HINT : undefined}
                  />
                </label>
                <label className={s.field}>
                  <span>Port</span>
                  <select className="form-select-box" {...register('portId')}>
                    <option value="">—</option>
                    {lookups.data?.ports.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {field('containerNo', 'Container')}
                <label className={s.field}>
                  <span>Ref type / number</span>
                  <div className={s.pair}>
                    <select className="form-select-box" {...register('refType')}>
                      <option value="HOUSE_BILL">House bill</option>
                      <option value="BILL_NO">Bill no.</option>
                      <option value="HAWB_NO">HAWB no.</option>
                    </select>
                    <input className="form-field-box" {...register('refNo')} />
                  </div>
                </label>
                {field('quantityText', 'Qty / unit')}
                {field('grossWeightKg', 'Gross weight (kg)', { decimals: 3 })}
                {field('cbm', 'CBM', { decimals: 3 })}
              </div>
            </section>

            <section className={s.card}>
              <h3>2. Credit noted line items</h3>
              <FieldError message={(errors.lines as { message?: string } | undefined)?.message} />
              <div className={s.lineHead}>
                <span>#</span>
                <span>Description</span>
                <span>Qty</span>
                <span>Unit</span>
                <span>Price</span>
                <span>Mark</span>
                <span />
              </div>
              {lines.fields.map((f, i) => {
                const l = values.lines?.[i];
                return (
                  <div className={s.line} key={f.id} onKeyDown={moveInLines}>
                    <span className={s.no}>{i + 1}</span>
                    {(() => {
                      const current = String(l?.description ?? '');
                      const reg = register(`lines.${i}.description`);
                      return (
                        <select
                          className="form-select-box"
                          {...reg}
                          onChange={async (e) => {
                            if (!(await chooseNew(i, 'description', e.target, current))) {
                              await reg.onChange(e);
                              reunit(i);
                            }
                          }}
                          aria-label={`Line ${i + 1} description`}
                          aria-invalid={!!lineErr(i, 'description')}
                          title={lineErr(i, 'description') ?? current}
                        >
                          <option value="">Choose…</option>
                          <option value={NEW_ITEM}>+ Add New Item</option>
                          {current && !charges.includes(current) && (
                            <option value={current}>{current}</option>
                          )}
                          {charges.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                    <NumberInput
                      className="form-field-box"
                      decimals={3}
                      {...register(`lines.${i}.qty`)}
                    />
                    {(() => {
                      const current = String(l?.unit ?? '');
                      const reg = register(`lines.${i}.unit`);
                      return (
                        <select
                          className="form-select-box"
                          {...reg}
                          onChange={async (e) => {
                            if (!(await chooseNew(i, 'unit', e.target, current)))
                              await reg.onChange(e);
                          }}
                          aria-label={`Line ${i + 1} unit`}
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
                      className="form-field-box"
                      decimals={4}
                      placeholder="0.00"
                      {...register(`lines.${i}.unitPrice`)}
                      aria-invalid={!!lineErr(i, 'unitPrice')}
                      title={lineErr(i, 'unitPrice')}
                    />
                    <input className="form-field-box" {...register(`lines.${i}.mark`)} />
                    {editable ? (
                      // The last line can't go (a note needs one), so the bin clears it instead.
                      <button
                        type="button"
                        className={s.remove}
                        onClick={() =>
                          lines.fields.length > 1
                            ? lines.remove(i)
                            : lines.update(i, blankLine(shipUnit))
                        }
                        aria-label={`Remove line ${i + 1}`}
                        title={lines.fields.length > 1 ? 'Remove item' : 'Clear this item'}
                      >
                        {icons.trash({})}
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
              {editable && (
                <button
                  type="button"
                  className={s.addLine}
                  onClick={() => lines.append(blankLine(shipUnit))}
                >
                  + Add item
                </button>
              )}
              <div className={s.totalRow}>
                <span>Total</span>
                <b>{fmtMoney(total)}</b>
              </div>
            </section>
            {!editable && doc && (
              <p className={s.note}>
                {doc.status === 'DRAFT'
                  ? 'Read only for your role.'
                  : doc.status === 'ISSUED'
                    ? can('creditnotes:write') && !canDecide
                      ? 'Submitted to the Monthly Ledger. To change it, use ⋯ → Revise.'
                      : 'Submitted to the Monthly Ledger.'
                    : 'This credit note was discarded.'}
              </p>
            )}
          </fieldset>
        </form>
      </div>

      <Preview>
        <div ref={sheetRef}>
          <CreditNote d={preview} />
        </div>
      </Preview>
    </section>
  );
}

/**
 * Ends the editor at the window's bottom wherever it starts: under the accounting tabs it
 * sits lower than on /credit-noted, so a fixed height pushed the footer buttons off screen.
 */
export function useFillWindow() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      el.style.setProperty('--cn-offset', `${Math.round(top) + 24}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return ref;
}

/** Accounting's latest word on this note: what to fix (returned as a draft), or Checked. */
function ReviewBanner({ doc }: { doc?: BillingDoc | undefined }) {
  const messages = useCreditNoteMessages(doc?.id);
  const m = messages.data?.[0];
  if (!doc || !m) return null;
  const returned = m.kind === 'REVISED' && doc.status === 'DRAFT';
  const checked =
    m.kind === 'CHECKED' && doc.status === 'ISSUED' && doc.header.reviewStatus === 'CHECKED';
  if (!returned && !checked) return null;
  return (
    <div className={`${s.banner} ${returned ? s.bannerRevise : s.bannerCheck}`} role="status">
      <div className={s.bannerHead}>
        <b>{returned ? 'Returned by accounting for revision' : 'Approved by accounting'}</b>
        <span>
          {m.senderName ?? 'Accounting'} · {timeAgo(m.createdAt)}
        </span>
      </div>
      {m.body && <p className={s.bannerBody}>{m.body}</p>}
      {returned && (
        <p className={s.bannerHint}>Make the changes, then press “Submit to Monthly” again.</p>
      )}
    </div>
  );
}

/** The A4 sheet, scaled down to fit the pane width. */
export function Preview({
  children,
  label = 'Credit Noted preview',
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, (el.clientWidth - 48) / A4_WIDTH));
      setHeight(sheet.current?.offsetHeight ?? 0);
    });
    ro.observe(el);
    if (sheet.current) ro.observe(sheet.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={s.preview} ref={pane} aria-label={label}>
      <div style={{ height: height * scale, width: A4_WIDTH * scale }}>
        <div
          ref={sheet}
          // Paper stays paper: what the print page's wrapper gives the sheet, so dark mode
          // doesn't leak in.
          data-theme="light"
          className={ps.sheet}
          style={
            {
              '--ink': '#111827',
              '--line': '#9ca3af',
              color: 'var(--ink)',
              fontFamily: "'GS Khmer', 'Helvetica', Arial, sans-serif",
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              margin: 0,
            } as React.CSSProperties
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
