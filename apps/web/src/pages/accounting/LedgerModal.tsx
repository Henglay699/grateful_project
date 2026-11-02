import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import {
  BILLING_DOC_LABEL,
  BILLING_DOC_TYPES,
  computeLedger,
  ledgerInputSchema,
  vatLabel,
  type LedgerEntryInput,
  type LedgerRow,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useDeclarationOptions,
  useDeleteLedger,
  useDocVatPercent,
  useSaveLedger,
} from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { DeleteInvoiceDialog } from './DeleteInvoiceDialog';
import { useToast } from '../../components/Toast';
import { CheaPill } from '../../components/StatusPill';
import { icons } from '../../layout/icons';
import { fmtDate, fmtMoney } from '../../lib/format';
import m from '../creditnoted/PackMenu.module.css';
import { formResolver } from '../../lib/zodForm';

const n = (v: string | null | undefined) =>
  v === null || v === undefined ? '' : String(Number(v));

const NUMBER_OF = {
  'tax-invoices': 'invNo',
  disbursements: 'disNo',
  'debit-notes': 'dnNo',
} as const;
/**
 * A tax invoice, DIS or debit note can be made once the shipment has that number (given when
 * its Chea payment is checked) and none is made yet; credit notes and summaries any time.
 */
const canStart = (row: LedgerRow, t: (typeof BILLING_DOC_TYPES)[number]) =>
  !(t in NUMBER_OF) ||
  (!!row[NUMBER_OF[t as keyof typeof NUMBER_OF]] &&
    !row.documents.some((d) => d.type === t && d.status !== 'VOID'));

/** Create or edit one ledger row; VAT and net profit preview with the same formulas the server uses. */
export function LedgerModal({ row, onClose }: { row: LedgerRow | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useLookups();
  const save = useSaveLedger();
  const del = useDeleteLedger();
  const editable = can('accounting:write');
  const [declQ, setDeclQ] = useState('');
  const [deleting, setDeleting] = useState(false);
  const options = useDeclarationOptions(declQ, !row);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<LedgerEntryInput>({
    resolver: formResolver(ledgerInputSchema),
    defaultValues: row
      ? {
          declarationId: row.declarationId,
          invNo: row.invNo ?? '',
          disNo: row.disNo ?? '',
          dnNo: row.dnNo ?? '',
          invDate: row.invDate,
          exchangeRate: n(row.exchangeRate),
          clearFee: n(row.clearFee),
          thc: n(row.thc),
          otherPay: n(row.otherPay),
          commission: n(row.commission),
          invRevenue: n(row.invRevenue),
          disTotal: n(row.disTotal),
          dnTotal: n(row.dnTotal),
          // Shown only: the form keeps an enum value (N/A rows have no clear fee).
          cheaStatus: row.cheaStatus === 'PAID' ? 'PAID' : 'UNPAID',
          mark: row.mark ?? '',
        }
      : {
          declarationId: '',
          cheaStatus: 'UNPAID',
          clearFee: '',
          thc: '',
          otherPay: '',
          invRevenue: '',
          disTotal: '',
          dnTotal: '',
          commission: '',
        },
  });
  const v = useWatch({ control });
  const pickedDecl = options.data?.find((o) => o.id === v.declarationId);
  const clientId = row?.clientId ?? pickedDecl?.clientId;
  const clientCm = lookups.data?.clients.find((c) => c.id === clientId)?.commissionUsd;
  // The row's VAT percent while its invoice date stays; else the one in force on the new date.
  const vatPercent = useDocVatPercent(
    v.invDate || row?.invDate,
    row ? { date: row.invDate, vatRate: row.vatRate } : null,
  );
  const preview = computeLedger(
    {
      clearFee: v.clearFee,
      thc: v.thc,
      otherPay: v.otherPay,
      commission: v.commission === '' || v.commission === undefined ? clientCm : v.commission,
      invRevenue: v.invRevenue,
      disTotal: v.disTotal,
      dnTotal: v.dnTotal,
    },
    vatPercent,
  );

  const onSubmit = handleSubmit(async (values) => {
    if (row) {
      // Numbers are given on approval and released by deleting the invoice, never typed.
      // The Chea payment status follows the month's clear fee payments.
      const {
        declarationId: _d,
        invNo: _i,
        disNo: _s,
        dnNo: _n,
        cheaStatus: _c,
        ...patch
      } = values;
      // Empty "auto" fields go back to their server defaults.
      for (const k of ['invDate', 'exchangeRate', 'commission'] as const)
        if (patch[k] === null || patch[k] === '') (patch as Record<string, unknown>)[k] = null;
      await save.mutateAsync({ id: row.id, body: patch });
      toast('Ledger entry saved.');
    } else {
      await save.mutateAsync({ body: values });
      toast('Ledger entry added.');
    }
    onClose();
  });

  const remove = async () => {
    if (!row || !window.confirm(`Delete the ledger entry for ${row.declareNo}?`)) return;
    await del.mutateAsync(row.id);
    toast('Ledger entry deleted.');
    onClose();
  };

  const money = (
    name: keyof LedgerEntryInput,
    label: string,
    hint?: string,
    decimals = 2,
    locked = false,
  ) => (
    <div className="form-field-group">
      <label htmlFor={`lg-${name}`}>{label}</label>
      <NumberInput
        id={`lg-${name}`}
        className="form-field-box"
        decimals={decimals}
        placeholder={hint ?? '0.00'}
        readOnly={!editable || locked}
        title={locked ? 'Set automatically' : undefined}
        {...register(name)}
        aria-invalid={!!errors[name]}
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );
  const text = (
    name: keyof LedgerEntryInput,
    label: string,
    hint?: string,
    type = 'text',
    locked = false,
  ) => (
    <div className="form-field-group">
      <label htmlFor={`lg-${name}`}>{label}</label>
      <input
        id={`lg-${name}`}
        type={type}
        className="form-field-box"
        placeholder={hint ?? label}
        readOnly={!editable || locked}
        title={locked ? 'Set automatically' : undefined}
        {...register(name)}
        aria-invalid={!!errors[name]}
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );

  return (
    <Modal
      width={900}
      onClose={onClose}
      title={row ? `${row.declareNo} · ${row.clientName}` : 'New ledger entry'}
      sub={
        row ? (
          <>
            Shipment{' '}
            <Link
              to={`/plans/${row.shipmentId}`}
              onClick={onClose}
              style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
            >
              {row.shipmentReference}
            </Link>{' '}
            · declared {fmtDate(row.declareDate)}
          </>
        ) : (
          'One entry per customs declaration. Leave the grey “auto” fields empty to use the defaults.'
        )
      }
    >
      <ErrorBanner error={save.error ?? del.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        {!row && (
          <div className="form-fields-grid" style={{ marginBottom: 12 }}>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="lg-q">Find declaration</label>
              <input
                id="lg-q"
                className="form-field-box"
                placeholder="Declare no., shipment or client code"
                value={declQ}
                onChange={(e) => setDeclQ(e.target.value)}
              />
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="lg-declarationId">Declaration without a ledger entry</label>
              <select
                id="lg-declarationId"
                className="form-select-box"
                {...register('declarationId')}
                aria-invalid={!!errors.declarationId}
              >
                <option value="">
                  {options.isLoading ? 'Loading…' : options.data?.length ? 'Choose…' : 'None found'}
                </option>
                {options.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.declareNo} · {o.clientCode} · {fmtDate(o.declareDate)} ·{' '}
                    {o.shipmentReference}
                  </option>
                ))}
              </select>
              <FieldError message={errors.declarationId?.message} />
            </div>
          </div>
        )}
        <div className="form-section-title">Paid out</div>
        <div className="form-fields-grid">
          {money('clearFee', 'Clear fee')}
          {money('thc', 'THC')}
          {money('otherPay', 'Other pay')}
          {money(
            'commission',
            'CM (commission)',
            clientCm !== undefined ? `auto: ${fmtMoney(clientCm)}` : 'auto',
          )}
        </div>
        <div className="form-section-title" style={{ marginTop: 16 }}>
          Billed to client
        </div>
        <div className="form-fields-grid">
          {money('invRevenue', 'INV (revenue, before VAT)')}
          {money('disTotal', 'DIS (disbursement)')}
          {money('dnTotal', 'DN total')}
          <div className="form-field-group">
            <label>Chea payment</label>
            <div
              className="form-field-box"
              title="Set by the month's clear fee payments to Chea"
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <CheaPill status={row?.cheaStatus} />
            </div>
          </div>
        </div>
        <div className="form-section-title" style={{ marginTop: 16 }}>
          Numbers &amp; dates
        </div>
        <div className="form-fields-grid">
          {text('invNo', 'INV No.', 'Given when the Chea payment is checked', 'text', true)}
          {text('disNo', 'DIS No.', 'Given when checked', 'text', true)}
          {text('dnNo', 'DN No.', 'Given when checked', 'text', true)}
          {text('invDate', 'Invoice date', 'auto: next working day', 'date', !!row)}
          {money('exchangeRate', 'USD → KHR rate', 'auto: rate on invoice date', 4, !!row)}
          {text('mark', 'Mark', 'e.g. Use 40H Truck')}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 22,
            flexWrap: 'wrap',
            marginTop: 18,
            padding: '12px 14px',
            borderRadius: 8,
            background: 'var(--bg-subtle)',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <span>
            {vatLabel(vatPercent)}: {fmtMoney(preview.vat)}
          </span>
          <span>In: {fmtMoney(preview.totalInflow)}</span>
          <span>Out: {fmtMoney(preview.totalOutflow)}</span>
          <span
            style={{
              color:
                preview.netProfit < 0 ? 'var(--status-exception-fg)' : 'var(--status-completed-fg)',
            }}
          >
            Net profit: {fmtMoney(preview.netProfit)}
          </span>
        </div>
        {row && (
          <div style={{ marginTop: 18 }}>
            <div className="form-section-title">Documents for this declaration</div>
            <DocumentsMenu row={row} editable={editable} onPick={onClose} />
          </div>
        )}
        {editable && (
          <div className={ui.actions}>
            {row && (row.invNo || row.disNo || row.dnNo) && (
              <button
                type="button"
                className="btn-delete-shipment"
                onClick={() => setDeleting(true)}
              >
                Delete invoice
              </button>
            )}
            {row && !row.documents.some((d) => d.status === 'ISSUED') && !row.invNo && (
              <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
                Delete entry
              </button>
            )}
            <button type="button" className="btn-cancel-shipment" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-create-submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : row ? 'Save entry' : 'Add entry'}
            </button>
          </div>
        )}
      </form>
      {deleting && row && (
        <DeleteInvoiceDialog
          recordId={row.id}
          declareNo={row.declareNo}
          numbers={[row.invNo, row.disNo, row.dnNo].filter((x): x is string => !!x)}
          onClose={() => setDeleting(false)}
          onDeleted={onClose}
        />
      )}
    </Modal>
  );
}

const DOC_TONE = {
  DRAFT: 'var(--status-pending-fg)',
  ISSUED: 'var(--status-completed-fg)',
  VOID: 'var(--status-exception-fg)',
} as const;

/** One button listing the declaration's documents to open and the ones that can be started. */
function DocumentsMenu({
  row,
  editable,
  onPick,
}: {
  row: LedgerRow;
  editable: boolean;
  onPick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const startable = editable ? BILLING_DOC_TYPES.filter((t) => canStart(row, t)) : [];

  return (
    <div className={m.wrap} ref={box} style={{ display: 'inline-block' }}>
      <button
        type="button"
        className="filter-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        Documents ({row.documents.length}){icons.chevronDown({ width: 14, height: 14 })}
      </button>
      {open && (
        // Opens upward: the section sits at the bottom of the modal.
        <div
          className={m.menu}
          role="menu"
          style={{ top: 'auto', bottom: 'calc(100% + 6px)', left: 0, right: 'auto', width: 300 }}
        >
          {row.documents.length > 0 && <div className={m.head}>Open</div>}
          {row.documents.map((d) => (
            <Link
              key={d.id}
              role="menuitem"
              to={`/accounting/${d.type}/${d.id}`}
              className={m.item}
              onClick={onPick}
              style={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <b style={{ fontSize: 13 }}>
                {BILLING_DOC_LABEL[d.type]} {d.number ?? ''}
              </b>
              <small style={{ color: DOC_TONE[d.status], fontWeight: 700 }}>
                {d.status.toLowerCase()}
              </small>
            </Link>
          ))}
          {startable.length > 0 && <div className={m.head}>Create</div>}
          {startable.map((t) => (
            <Link
              key={t}
              role="menuitem"
              to={`/accounting/${t}/new?recordId=${row.id}`}
              className={m.item}
              onClick={onPick}
              style={{ alignItems: 'center' }}
            >
              {icons.plus({ width: 16, height: 16 })}
              <b style={{ fontSize: 13 }}>{BILLING_DOC_LABEL[t]}</b>
            </Link>
          ))}
          {row.documents.length === 0 && startable.length === 0 && (
            <div className={m.head}>No documents yet</div>
          )}
        </div>
      )}
    </div>
  );
}
