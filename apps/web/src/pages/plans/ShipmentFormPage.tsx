import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FormProvider,
  useFieldArray,
  useForm,
  useController,
  useFormContext,
  useWatch,
  type FieldErrors,
} from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  CLEARANCE_STATUS_LABEL,
  clearanceStatusOf,
  CONTAINER_SIZES,
  INCOTERM_LABEL,
  INCOTERMS,
  shipmentStatusOf,
  SHIPMENT_STATUS_LABEL,
  shipmentInputSchema,
  type LookupsResponse,
  type OverImportViolation,
  type ShipmentDetail,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useAddCoForm,
  useAddConsignee,
  useAddForwarder,
  useDeleteShipment,
  useLookups,
  useSaveShipment,
  useShipment,
} from '../../features/hooks';
import { CountrySelect } from '../../components/CountrySelect';
import { ErrorBanner, FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { ApiError } from '../../lib/api';
import { downloadFile } from '../../lib/files';
import { formResolver } from '../../lib/zodForm';
import { AddNewSelect } from './AddNewSelect';
import { CargoSection, DotsMenu } from './CargoSection';
import { DeclarationsSection } from './DeclarationsSection';
import { SupportDocumentsModal } from './SupportDocuments';
import {
  blankContainer,
  cleanForSubmit,
  DEFAULT_BROKER,
  emptyForm,
  fromDetail,
  type FormValues,
} from './formModel';
import f from './ShipmentForm.module.css';
import { WorkflowPanel } from '../../components/workflow/WorkflowPanel';
import { StagePill } from '../../components/workflow/StagePill';
import { FIELD_ICON, fi, type FormIcon } from './formIcons';

interface Step {
  label: string;
  /** Top-level form fields shown in this step (used to jump to the first error). */
  fields: (keyof FormValues)[];
  render: () => ReactNode;
}

type Choice = { value: string; label: string };
/** Freight methods: named in full in the dropdown, short in the header ("By Sea"). */
const FREIGHT: (Choice & { short: string })[] = [
  { value: 'SEA', short: 'By Sea', label: 'Ocean Freight (Sea)' },
  { value: 'AIR', short: 'By Air', label: 'Air Freight' },
  { value: 'ROAD', short: 'By Truck', label: 'Road Freight (Truck)' },
  { value: 'RAIL', short: 'By Rail', label: 'Rail Freight' },
];
/** Shipping terms: spelled out in the dropdown, short in the header. */
const TERMS: (Choice & { short: string })[] = [
  { value: 'FCL', short: 'CY / CY', label: 'CY / CY (FCL, Full Container Load)' },
  { value: 'LCL', short: 'CFS / CFS (LCL)', label: 'CFS / CFS (LCL, Less Than Container Load)' },
];
/** Air freight has no CY / CY or LCL terms. */
const AIR_TERMS: Choice[] = [{ value: 'NONE', label: 'None (air freight)' }];
const DIRECTIONS: Choice[] = [
  { value: 'IMPORT', label: 'Import' },
  { value: 'EXPORT', label: 'Export' },
];

const TONE: Record<string, string> = {
  COMPLETED: 'done',
  CLEARED: 'done',
  IN_PROGRESS: 'progress',
  PENDING: 'pending',
  EXCEPTION: 'exception',
};

export function ShipmentFormPage() {
  const { id } = useParams();
  const existing = useShipment(id);
  const lookups = useLookups();
  if ((id && existing.isLoading) || lookups.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading…</div>
      </section>
    );
  if (existing.error || lookups.error)
    return (
      <section className="view active">
        <ErrorBanner error={existing.error ?? lookups.error} />
        <BackLink to="/plans" label="Back to Shipping Plans" />
      </section>
    );
  return <ShipmentForm key={id ?? 'new'} detail={existing.data} lookups={lookups.data!} />;
}

function ShipmentForm({
  detail,
  lookups,
}: {
  detail?: ShipmentDetail | undefined;
  lookups: LookupsResponse;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const save = useSaveShipment();
  const del = useDeleteShipment();
  const firstActiveClient = lookups.clients.find((c) => c.status !== 'INACTIVE')?.id ?? '';
  const methods = useForm<FormValues>({
    resolver: formResolver(shipmentInputSchema),
    defaultValues: detail ? fromDetail(detail) : emptyForm('EXPORT', firstActiveClient),
    mode: 'onTouched',
  });
  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isDirty },
  } = methods;
  const [direction, transportMode, loadType, clientId, atd, arriveFty, decls] = useWatch({
    control,
    name: [
      'direction',
      'transportMode',
      'loadType',
      'clientId',
      'atd',
      'arriveFty',
      'declarations',
    ],
  });
  const [step, setStep] = useState(0);
  // A saved shipment opens on its job workflow (?tab=workflow from links, too); the form's tabs
  // are one click away.
  const [params] = useSearchParams();
  const [showWorkflow, setShowWorkflow] = useState(!!detail && params.get('tab') !== 'form');
  const [violations, setViolations] = useState<OverImportViolation[] | null>(null);
  // A saved shipment opens for viewing; ⋯ → Edit unlocks it. New ones start editable.
  const [editing, setEditing] = useState(!detail);
  const [supportDocs, setSupportDocs] = useState(false);
  const readOnly = !can('shipments:write') || !editing;
  const clientLocked = !!detail && detail.declarations.some((d) => d.hasLedgerEntry);

  // Air has no terms (stored as NONE, so neither option shows selected).
  useEffect(() => {
    if (transportMode === 'AIR') setValue('loadType', 'NONE');
  }, [transportMode, setValue]);

  // An import's consignee starts as the client itself (its factory-side consignee) when the
  // client or direction is picked, replacing one that was blank, filled in this way, or
  // another client's own. Any other consignee chosen by hand is kept; a saved shipment is
  // left as it was until its client is changed.
  const autoConsignee = useRef<string | null>(null);
  const firstPick = useRef(true);
  useEffect(() => {
    const skip = firstPick.current && !!detail;
    firstPick.current = false;
    if (skip || direction !== 'IMPORT') return;
    // The one named as the client's legal name, else its Cambodian one, else any of its own.
    const legal = lookups.clients
      .find((c) => c.id === clientId)
      ?.legalName?.trim()
      .toLowerCase();
    const own =
      (legal && lookups.consignees.find((c) => c.name.trim().toLowerCase() === legal)) ||
      lookups.consignees.find((c) => c.clientId === clientId && c.countryIso2 === 'KH') ||
      lookups.consignees.find((c) => c.clientId === clientId);
    const now = methods.getValues('consigneeId') ?? '';
    const owner = lookups.consignees.find((c) => c.id === now)?.clientId;
    const replaceable = !now || now === autoConsignee.current || (!!owner && owner !== clientId);
    if (!replaceable) return;
    autoConsignee.current = own?.id ?? null;
    setValue('consigneeId', own?.id ?? '', { shouldDirty: !!detail });
  }, [clientId, direction, detail, lookups.clients, lookups.consignees, methods, setValue]);

  // An export's shipper is the client itself, by its legal name in English: set when the client
  // or direction is picked, replacing one that was blank or filled in this way. A saved shipment
  // is left as it was until its client is changed; an import's shipper is its supplier, typed.
  const autoShipper = useRef<string | null>(null);
  const firstShipperPick = useRef(true);
  useEffect(() => {
    const skip = firstShipperPick.current && !!detail;
    firstShipperPick.current = false;
    if (skip) return;
    const now = methods.getValues('shipperName') ?? '';
    const replaceable = !now.trim() || now === autoShipper.current;
    if (!replaceable) return;
    const client = lookups.clients.find((c) => c.id === clientId);
    const legal = direction === 'EXPORT' ? client?.legalName?.trim() || client?.name || '' : '';
    autoShipper.current = legal || null;
    if (legal !== now) setValue('shipperName', legal, { shouldDirty: !!detail });
  }, [clientId, direction, detail, lookups.clients, methods, setValue]);

  const steps = useMemo(
    () => buildSteps(direction, transportMode, lookups, detail),
    [direction, transportMode, lookups, detail],
  );
  const current = Math.min(step, steps.length - 1);
  const isLast = current === steps.length - 1;

  const onInvalid = (errs: FieldErrors<FormValues>) => {
    const keys = Object.keys(errs) as (keyof FormValues)[];
    const target = steps.findIndex((s) => s.fields.some((k) => keys.includes(k)));
    if (target >= 0) setStep(target);
    toast(`Check ${keys.length} highlighted field${keys.length === 1 ? '' : 's'} before saving.`);
  };

  const onValid = async (values: FormValues) => {
    setViolations(null);
    try {
      const saved = await save.mutateAsync({ id: detail?.id, body: values });
      toast(detail ? `${saved.reference} saved.` : `Shipment ${saved.reference} created.`);
      // A saved shipment goes back to viewing, with the saved values as the new starting point.
      if (detail) {
        methods.reset(fromDetail(saved));
        setEditing(false);
      }
      navigate(`/plans/${saved.id}`, { replace: true });
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.details as { rule?: string } | undefined)?.rule === 'CUT_STOCK_OVER_IMPORT'
      ) {
        setViolations((e.details as { violations: OverImportViolation[] }).violations);
        // The invoice items step, where the quantities and override reasons are entered.
        const itemsStep = steps.findIndex((s) => s.fields.includes('invoices'));
        if (itemsStep >= 0) setStep(itemsStep);
      }
    }
  };
  const submit = handleSubmit((v) => onValid(cleanForSubmit(v)), onInvalid);

  /** From the workflow: open the form tab holding a field (in Edit if allowed) and focus it. */
  const goToField = (field: string) => {
    if (field === '__documents') return setSupportDocs(true);
    if (field === '__client') return detail && navigate(`/clients/${detail.clientId}`);
    const target = steps.findIndex((s) => (s.fields as string[]).includes(field));
    setShowWorkflow(false);
    if (target >= 0) setStep(target);
    if (can('shipments:write')) setEditing(true);
    window.setTimeout(() => {
      const el = document.getElementById(`f-${field}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    }, 120);
  };

  const remove = async () => {
    if (
      !detail ||
      !window.confirm(
        `Delete ${detail.reference}? Its CDC lines will be released back to the cut-stock balance.`,
      )
    )
      return;
    try {
      await del.mutateAsync(detail.id);
      toast(`${detail.reference} deleted.`);
      navigate('/plans');
    } catch {
      /* shown in banner */
    }
  };

  const [exporting, setExporting] = useState(false);
  /** Why Export INV + PL can't run yet (shown as the button's tooltip), or null when it can. */
  const exportBlocked = !detail
    ? null
    : isDirty
      ? 'Save your changes first'
      : detail.invoices.length === 0
        ? detail.direction === 'EXPORT'
          ? 'Add the cargo invoices first (Cargo, Pricing & FOB)'
          : 'Add the cargo invoices first (Item, Costing & Forwarding)'
        : null;
  /**
   * JR's "INV + PL" workbook: the commercial invoice and packing list side by side; for an
   * import also the customs cover letter and the transfer of rights to the broker.
   */
  const exportInvPl = async () => {
    if (!detail) return;
    setExporting(true);
    try {
      await downloadFile(`/shipments/${detail.id}/invoice-packing-list.xlsx`);
    } catch {
      toast('Export failed. Check the cargo invoices and try again.');
    } finally {
      setExporting(false);
    }
  };

  /** ⋯ → Cancel Edit: drop the changes and go back to viewing. */
  const cancelEdit = () => {
    if (isDirty && !window.confirm('Discard your changes?')) return;
    methods.reset();
    setViolations(null);
    setEditing(false);
  };

  // Worked out from the dates and declarations as they are typed (the server does the same).
  const shipStatus = shipmentStatusOf({ direction, atd, arriveFty, declarations: decls });
  const clearStatus = clearanceStatusOf({ declarations: decls });
  const clientName =
    lookups.clients.find((c) => c.id === clientId)?.name ?? detail?.clientName ?? '';
  const metaParts = [
    clientName,
    DIRECTIONS.find((d) => d.value === direction)?.label,
    FREIGHT.find((x) => x.value === transportMode)?.short,
    TERMS.find((t) => t.value === loadType)?.short,
  ].filter(Boolean);
  // Editing an existing record: save from any step. New record: walk the steps, create at the end.
  const canSaveHere = !!detail || isLast;

  const updatedAt =
    detail &&
    new Date(detail.updatedAt).toLocaleString('en-GB', {
      timeZone: 'Asia/Phnom_Penh',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const statusBadges = detail ? (
    <>
      <StagePill direction={detail.direction} stage={detail.workflowStage} />
      <span className={f.badge} data-tone={TONE[shipStatus]}>
        {SHIPMENT_STATUS_LABEL[shipStatus]}
      </span>
      <span className={f.badge} data-tone={TONE[clearStatus]}>
        {CLEARANCE_STATUS_LABEL[clearStatus]}
      </span>
    </>
  ) : (
    <span className={f.badge} data-tone="draft">
      Draft
    </span>
  );

  // The client as the title, the shipment's details under it, and icon buttons
  // (⋯ Edit / Delete, Export INV + PL, Save, Next tab) on the right.
  const menuActions = [
    ...(detail && can('shipments:write')
      ? [
          editing
            ? { label: 'Cancel Edit', icon: icons.close({}), onClick: cancelEdit }
            : { label: 'Edit', icon: icons.edit({}), onClick: () => setEditing(true) },
        ]
      : []),
    // A saved shipment's files (each up to 10 MB), viewable without entering Edit.
    ...(detail && can('documents:read')
      ? [
          {
            label: 'Support Documents',
            icon: icons.paperclip({}),
            onClick: () => setSupportDocs(true),
          },
        ]
      : []),
    ...(detail && can('shipments:delete')
      ? [
          {
            label: 'Delete Shipment',
            icon: icons.trash({}),
            onClick: () => void remove(),
            disabled: del.isPending,
            danger: true,
          },
        ]
      : []),
  ];
  const header = (
    <div className={`${backRow} ${f.topBar}`}>
      <BackLink to="/plans" label="Shipping Plans" />
      <div className={f.header}>
        <div style={{ minWidth: 0 }}>
          <div className={f.titleRow}>
            <h2 className={`${f.title} ${f.titleCaps}`}>{clientName || 'New shipment'}</h2>
            {statusBadges}
            {isDirty && !readOnly && <span className={f.dirty}>Unsaved changes</span>}
          </div>
          <div className={`${f.meta} ${f.metaCaps}`}>
            <span className={f.metaItem}>
              <strong>{detail?.reference ?? 'New shipment'}</strong>
            </span>
            <span className={f.metaItem}>{metaParts.slice(1).join(' • ')}</span>
            {updatedAt && (
              <span className={f.metaItem}>
                {fi.clock({})}
                Updated {updatedAt}
              </span>
            )}
          </div>
        </div>
        <div className={f.toolbar}>
          {menuActions.length > 0 && (
            <DotsMenu label="More actions" className={f.iconBtn} actions={menuActions} />
          )}
          <button
            type="button"
            className={f.iconBtn}
            onClick={() => void exportInvPl()}
            disabled={!detail || exporting || !!exportBlocked}
            aria-label="Export INV + PL"
            title={
              !detail
                ? 'Export INV + PL: create the shipment first'
                : exportBlocked
                  ? `Export INV + PL: ${exportBlocked.toLowerCase()}`
                  : detail.direction === 'IMPORT'
                    ? 'Export INV + PL: invoice + packing list, customs cover letter and transfer of rights in Excel'
                    : 'Export INV + PL: invoice + packing list in Excel, one sheet per invoice'
            }
          >
            {exporting ? <span className={f.spinner} aria-hidden /> : icons.download({})}
          </button>
          <button
            type="button"
            className={f.iconBtn}
            onClick={() => void submit()}
            disabled={readOnly || save.isPending || !canSaveHere}
            aria-label={detail ? 'Save changes' : 'Create shipment'}
            title={
              !can('shipments:write')
                ? 'View only'
                : readOnly
                  ? 'Choose Edit in the ⋯ menu to make changes'
                  : !canSaveHere
                    ? 'Fill in each tab; the shipment is created on the last one'
                    : save.isPending
                      ? 'Saving…'
                      : detail
                        ? 'Save changes'
                        : 'Create shipment'
            }
          >
            {fi.save({})}
          </button>
          <button
            type="button"
            className={f.iconBtn}
            onClick={() => setStep(current + 1)}
            disabled={isLast}
            aria-label="Next tab"
            title={isLast ? 'Last tab' : `Next: ${steps[current + 1]!.label}`}
          >
            {fi.arrowRight({})}
          </button>
        </div>
      </div>
    </div>
  );

  const generalCard = (
    <Card title="General Information" icon="idCard">
      <div className="form-field-group" style={spanStyle(2)}>
        <FieldLabel name="clientId" label="Client" />
        <select
          id="f-clientId"
          className={`form-select-box ${f.clientHi}`}
          {...register('clientId')}
          disabled={clientLocked}
          title={
            clientLocked
              ? 'Locked: a declaration of this shipment is already in the ledger'
              : undefined
          }
        >
          {lookups.clients
            .filter((c) => c.status !== 'INACTIVE' || c.id === detail?.clientId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
      <div className="form-field-group" style={spanStyle(2)}>
        <FieldLabel name="reference" label="Shipment Number" />
        <input
          id="f-reference"
          className={`form-field-box ${f.refBox}`}
          value={detail?.reference ?? ''}
          placeholder="Assigned when the shipment is created"
          readOnly
          tabIndex={-1}
        />
      </div>
      <Select
        name="direction"
        label="Shipment Type"
        options={DIRECTIONS}
        onChange={() => setStep(0)}
        span={2}
      />
      <Select
        name="transportMode"
        label="Freight Method"
        options={FREIGHT}
        span={2}
        // Switching away from Air: pick CY / CY so Sea and Truck have terms.
        onChange={() => loadType === 'NONE' && setValue('loadType', 'FCL')}
      />
      <Select
        name="loadType"
        label="Shipping Terms"
        options={transportMode === 'AIR' ? AIR_TERMS : TERMS}
        disabled={transportMode === 'AIR'}
      />
      <Select
        name="incoterm"
        label="Incoterms"
        options={INCOTERMS.map((t) => ({ value: t, label: `${t} – ${INCOTERM_LABEL[t]}` }))}
        placeholder="Select incoterm"
      />
      <Field name="receivedDocumentDate" label="Received Document Date" type="date" span={2} />
    </Card>
  );

  return (
    <section className="view active">
      <FormProvider {...methods}>
        <form
          className={f.page}
          // Enter in a field moves to the next step; only the last step saves on Enter.
          onSubmit={(e) => {
            e.preventDefault();
            if (isLast) void submit();
            else setStep(current + 1);
          }}
          noValidate
        >
          {/* ---------- Header, then where the shipment has got to, then the form's tabs ---------- */}
          {header}
          {!showWorkflow && <Milestones direction={direction} />}
          <nav className={f.tabs} role="tablist" aria-label="Form sections">
            {detail && (
              <button
                type="button"
                role="tab"
                className={`${f.tab} ${f.workflowTab}`}
                aria-selected={showWorkflow}
                onClick={() => setShowWorkflow(true)}
              >
                Workflow
              </button>
            )}
            {steps.map((s, i) => (
              <button
                type="button"
                key={s.label}
                role="tab"
                className={f.tab}
                aria-selected={!showWorkflow && i === current}
                data-error={s.fields.some((k) => k in errors)}
                onClick={() => {
                  setShowWorkflow(false);
                  setStep(i);
                }}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {showWorkflow && detail ? (
            <WorkflowPanel
              shipmentId={detail.id}
              clientId={detail.clientId}
              onGoToField={goToField}
            />
          ) : (
            <fieldset
              disabled={readOnly}
              className={readOnly ? f.viewing : undefined}
              style={{ border: 'none', minWidth: 0, padding: 0 }}
            >
              <div className={f.stack}>
                {/* ---------- General information: client, shipment number and the shipment
                  choices, on the first tab only ---------- */}
                {current === 0 && generalCard}

                <ErrorBanner error={violations ? null : (save.error ?? del.error)} />
                {violations && (
                  <div
                    role="alert"
                    style={{
                      borderRadius: 8,
                      padding: '10px 14px',
                      background: 'var(--status-exception-bg)',
                      color: 'var(--status-exception-fg)',
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    These invoice items exceed the remaining CDC balance:
                    <ul style={{ margin: '6px 0 0 18px', fontWeight: 600 }}>
                      {violations.map((v) => (
                        <li key={v.cutStockItemId}>
                          {v.declareRef} {v.itemName}: balance {v.balance}, importing {v.requested}
                        </li>
                      ))}
                    </ul>
                    {can('cutstock:override')
                      ? 'Lower the quantity, or enter a reason on the item to approve it.'
                      : 'Lower the quantity, or ask a Manager to approve the extra quantity.'}
                  </div>
                )}

                {steps[current]!.render()}
              </div>
            </fieldset>
          )}
        </form>
      </FormProvider>
      {supportDocs && detail && (
        <SupportDocumentsModal
          title={detail.reference}
          link={{ shipmentId: detail.id }}
          clientId={detail.clientId}
          onClose={() => setSupportDocs(false)}
        />
      )}
    </section>
  );
}

// By air both directions track the air waybills (MAWB in the booking no., HAWB in the HBL no.).
const MILESTONES = {
  IMPORT: ['Received INV & PL', 'HBL', 'ETA Port', 'Clearance', 'Arrive Factory'],
  EXPORT: ['Received INV & PL', 'Booking', 'ETD', 'Clearance', 'Departed'],
  AIR_IMPORT: ['Received INV & PL', 'MAWB / HAWB', 'ETA Port', 'Clearance', 'Arrive Factory'],
  AIR_EXPORT: ['Received INV & PL', 'MAWB / HAWB', 'ETD', 'Clearance', 'Departed'],
};

/**
 * The shipment's progress, read from what has been filled in. Import: an invoice no., the HBL
 * no., the ETA Port date, a cleared declaration and the ETA Factory date. Export: an invoice
 * no., the booking / SO no., the ETD, a cleared declaration and the ATD. By air the second is
 * a MAWB or HAWB no. The first one still missing is the current milestone.
 */
function Milestones({ direction }: { direction: FormValues['direction'] }) {
  const { control } = useFormContext<FormValues>();
  const [invoices, hblNo, eta, arriveFty, bookingNo, etd, atd, declarations, mode] = useWatch({
    control,
    name: [
      'invoices',
      'hblNo',
      'eta',
      'arriveFty',
      'bookingNo',
      'etd',
      'atd',
      'declarations',
      'transportMode',
    ],
  });
  const isExport = direction === 'EXPORT';
  // An air export has no ATD field: it has departed once its flight date has come.
  const departed =
    !!atd || (mode === 'AIR' && !!etd && etd <= new Date().toISOString().slice(0, 10));
  const reached = [
    (invoices ?? []).some((i) => !!i.invoiceNo?.trim()),
    mode === 'AIR'
      ? !!bookingNo?.trim() || !!hblNo?.trim()
      : isExport
        ? !!bookingNo?.trim()
        : !!hblNo?.trim(),
    isExport ? !!etd : !!eta,
    clearanceStatusOf({ declarations }) === 'CLEARED',
    isExport ? departed : !!arriveFty,
  ];
  const next = reached.indexOf(false);
  return (
    <ol className={f.track} aria-label="Shipment progress">
      {MILESTONES[`${mode === 'AIR' ? 'AIR_' : ''}${isExport ? 'EXPORT' : 'IMPORT'}`].map(
        (label, i) => {
          const state = reached[i] ? 'done' : i === next ? 'current' : 'todo';
          return (
            <li
              key={label}
              className={f.mile}
              data-state={state}
              data-linked={!!reached[i] && !!reached[i + 1]}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className={f.mileDot}>{state === 'done' ? fi.check({}) : i + 1}</span>
              <span className={f.mileLabel}>{label}</span>
            </li>
          );
        },
      )}
    </ol>
  );
}

/* ------------------------------ Field helpers ------------------------------ */

type Span = number | 'full';
const spanStyle = (span?: Span): CSSProperties | undefined =>
  span === 'full' ? { gridColumn: '1 / -1' } : span ? { gridColumn: `span ${span}` } : undefined;

/** Quantity, with its unit (CTNS…) shown as a tag inside the box. */
function QuantityField() {
  const unit = useWatch<FormValues, 'quantityUnit'>({ name: 'quantityUnit' });
  return (
    <Field
      name="quantity"
      label="Quantity"
      placeholder="0"
      decimals={3}
      suffix={unit || undefined}
    />
  );
}

/** A field's label with its icon (FIELD_ICON), in the mockup's sentence case. */
function FieldLabel({ name, label }: { name: string; label: string }) {
  const icon = FIELD_ICON[name];
  return (
    <label htmlFor={`f-${name}`} className={f.label}>
      {icon && fi[icon]({})}
      {label}
    </label>
  );
}

function Field({
  name,
  label,
  type = 'text',
  span,
  placeholder,
  decimals,
  suffix,
  rows,
}: {
  name: keyof FormValues;
  label: string;
  type?: string;
  span?: Span;
  placeholder?: string;
  /** A number field (digits only, shown with commas) with at most this many decimals. */
  decimals?: number;
  /** A tag at the right end of the box, e.g. the quantity's unit. */
  suffix?: string;
  /** A text box this many lines tall (e.g. the remark), instead of a one-line field. */
  rows?: number;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <FieldLabel name={name} label={label} />
      <div className={suffix ? f.affix : f.plain}>
        {rows ? (
          <textarea
            id={`f-${name}`}
            rows={rows}
            className={`form-field-box ${f.textarea}`}
            placeholder={placeholder ?? label}
            {...register(name)}
            aria-invalid={!!err}
          />
        ) : decimals !== undefined ? (
          <NumberInput
            id={`f-${name}`}
            decimals={decimals}
            className="form-field-box"
            placeholder={placeholder ?? label}
            {...register(name)}
            aria-invalid={!!err}
          />
        ) : (
          <input
            id={`f-${name}`}
            type={type}
            className="form-field-box"
            placeholder={placeholder ?? label}
            title={type === 'text' ? undefined : label}
            {...register(name)}
            aria-invalid={!!err}
          />
        )}
        {suffix && <span className={f.suffix}>{suffix}</span>}
      </div>
      <FieldError message={err?.message} />
    </div>
  );
}

/** An export's Shipper: the client's legal name in English (an older value stays selectable). */
function ExportShipperSelect({ lookups }: { lookups: LookupsResponse }) {
  const [clientId, current] = useWatch<FormValues, ['clientId', 'shipperName']>({
    name: ['clientId', 'shipperName'],
  });
  const client = lookups.clients.find((c) => c.id === clientId);
  const legal = client?.legalName?.trim() || client?.name || '';
  const names = [legal, current ?? ''].filter(
    (v, i, all) => v.trim() && all.findIndex((x) => x === v) === i,
  );
  return (
    <Select
      name="shipperName"
      label="Shipper"
      options={names.map((v) => ({ value: v, label: v }))}
      placeholder="Select shipper"
      span={2}
    />
  );
}

/**
 * Broker: us by default, or any broker already used on a shipment; "+ Add New" types another
 * (it is kept as text on the shipment, so it joins the list once saved).
 */
function BrokerSelect({ lookups }: { lookups: LookupsResponse }) {
  const { field } = useController<FormValues, 'broker'>({ name: 'broker' });
  const current = field.value ?? '';
  const names = [DEFAULT_BROKER, ...lookups.brokers, ...(current.trim() ? [current] : [])].filter(
    (v, i, all) => all.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
  );
  return (
    <div className="form-field-group" style={spanStyle(2)}>
      <FieldLabel name="broker" label="Broker" />
      <AddNewSelect
        id="f-broker"
        label="Broker"
        placeholder="Select broker"
        addFirst
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        options={names.map((v) => ({ value: v, label: v }))}
        onCreate={async (name) => name.trim()}
      />
    </div>
  );
}

const CO_STATUSES = ['Pending', 'Draft', 'Submitted', 'Approved'];

/** CO Status: one of the four stages; an older free-text value stays selectable until changed. */
function CoStatusSelect() {
  const current = useWatch<FormValues, 'coStatus'>({ name: 'coStatus' }) ?? '';
  const options = [...CO_STATUSES, ...(current && !CO_STATUSES.includes(current) ? [current] : [])];
  return (
    <Select
      name="coStatus"
      label="CO Status"
      options={options.map((v) => ({ value: v, label: v }))}
      placeholder="Select status"
    />
  );
}

/**
 * CO Form: the MoC CO system's form list ("Form AB"…, stored as the code AB), with "+ Add New"
 * first. A code not in the list stays selectable until changed.
 */
function CoFormSelect({ lookups }: { lookups: LookupsResponse }) {
  const { field } = useController<FormValues, 'coForm'>({ name: 'coForm' });
  const { can } = useAuth();
  const addCoForm = useAddCoForm();
  const current = field.value ?? '';
  const options = lookups.values.CO_FORM.map((v) => ({ value: v.value, label: v.label }));
  if (current && !options.some((o) => o.value === current))
    options.push({ value: current, label: current });
  return (
    <div className="form-field-group">
      <FieldLabel name="coForm" label="CO Form" />
      <AddNewSelect
        id="f-coForm"
        label="CO Form"
        placeholder="Select form"
        addFirst
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        options={options}
        onCreate={
          can('shipments:write')
            ? async (label) => (await addCoForm.mutateAsync({ label })).value
            : undefined
        }
      />
    </div>
  );
}

/**
 * The import or export type (Garments…), kept in the material field. A plan workbook import
 * fills it with the CDC groups ("RAW MATERIAL, ACCESSORY"), which stays selectable until changed.
 */
function CargoTypeSelect({
  label,
  options,
}: {
  label: string;
  options: { value: string; label: string }[];
}) {
  const current = useWatch<FormValues, 'material'>({ name: 'material' }) ?? '';
  return (
    <Select
      name="material"
      label={label}
      options={
        current && !options.some((o) => o.value === current)
          ? [...options, { value: current, label: current }]
          : options
      }
      placeholder="Select type"
      span={2}
    />
  );
}

/** A country, picked from every country in the world with its flag; type to search. */
function CountryField({
  name,
  label,
  countries,
  span,
}: {
  name: 'destinationCountryIso2' | 'originCountryIso2';
  label: string;
  countries: LookupsResponse['countries'];
  span?: Span;
}) {
  const { field, fieldState } = useController<FormValues, typeof name>({ name });
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <FieldLabel name={name} label={label} />
      <CountrySelect
        id={`f-${name}`}
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        countries={countries}
        invalid={!!fieldState.error}
      />
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}

function Select({
  name,
  label,
  options,
  placeholder,
  span,
  disabled,
  onChange,
}: {
  name: keyof FormValues;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  span?: Span;
  disabled?: boolean;
  onChange?: () => void;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <FieldLabel name={name} label={label} />
      <div className={f.plain}>
        <select
          id={`f-${name}`}
          className="form-select-box"
          {...register(name, { onChange })}
          disabled={disabled}
          aria-invalid={!!err}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <FieldError message={err?.message} />
    </div>
  );
}

/** One status as a tile: what it is, its badge, and how it is worked out. */
function StatusTile({
  icon,
  label,
  tone,
  value,
  children,
}: {
  icon: FormIcon;
  label: string;
  tone: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className={f.statusTile}>
      <div className={f.statusHead}>
        <span className={f.statusIcon}>{fi[icon]({})}</span>
        <span className={f.statusLabel}>{label}</span>
        <span className={f.badge} data-tone={tone}>
          {value}
        </span>
      </div>
      <p className={f.statusHint}>{children}</p>
    </div>
  );
}

/** The shipment status is not chosen: it is shown as it follows from the shipment's data. */
function ShipmentStatusField() {
  const { control } = useFormContext<FormValues>();
  const [direction, atd, arriveFty, declarations] = useWatch({
    control,
    name: ['direction', 'atd', 'arriveFty', 'declarations'],
  });
  const status = shipmentStatusOf({ direction, atd, arriveFty, declarations });
  const done = direction === 'IMPORT' ? 'ETA Factory' : 'ATD';
  return (
    <StatusTile
      icon="activity"
      label="Status"
      tone={TONE[status]!}
      value={SHIPMENT_STATUS_LABEL[status]}
    >
      Completed once {done} is filled in, In Progress once a declaration is recorded, otherwise
      Pending.
    </StatusTile>
  );
}

/** The clearance status is not chosen either: it follows from the customs declarations. */
function ClearanceStatusField() {
  const { control } = useFormContext<FormValues>();
  const declarations = useWatch({ control, name: 'declarations' });
  const status = clearanceStatusOf({ declarations });
  return (
    <StatusTile
      icon="badge"
      label="Clearance Status"
      tone={TONE[status]!}
      value={CLEARANCE_STATUS_LABEL[status]}
    >
      Customs Cleared once a declaration has its Declare No. and Date, In Progress once a Declare
      No. is entered, otherwise Pending Review.
    </StatusTile>
  );
}

/** A titled section card; `cols` sets the grid (fields span 1 unless told otherwise). */
function Card({
  title,
  icon,
  cols = 4,
  children,
}: {
  title: string;
  icon: FormIcon;
  cols?: number;
  children: ReactNode;
}) {
  return (
    <div className="cx-card">
      <div className="cx-card-head">
        <div className="cx-title">
          <span className="cx-title-icon">{fi[icon]({ width: 18, height: 18 })}</span>
          <h3>{title}</h3>
        </div>
      </div>
      <div className={f.grid} style={{ '--cols': cols } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

function PartiesFields({
  lookups,
  which,
}: {
  lookups: LookupsResponse;
  which: 'consignee' | 'forwarder';
}) {
  const { control } = useFormContext<FormValues>();
  const { field: consignee } = useController<FormValues, 'consigneeId'>({ name: 'consigneeId' });
  const { field: forwarder } = useController<FormValues, 'forwarderId'>({ name: 'forwarderId' });
  const { can } = useAuth();
  const clientId = useWatch({ control, name: 'clientId' });
  const addConsignee = useAddConsignee();
  const addForwarder = useAddForwarder();
  if (which === 'consignee') {
    const opts = [...lookups.consignees].sort(
      (a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId),
    );
    return (
      <div className="form-field-group" style={spanStyle(2)}>
        <FieldLabel name="consigneeId" label="Consignee" />
        <AddNewSelect
          id="f-consigneeId"
          label="Consignee"
          placeholder="Consignee"
          value={consignee.value}
          onChange={consignee.onChange}
          onBlur={consignee.onBlur}
          options={opts.map((c) => ({ value: c.id, label: c.name }))}
          onCreate={
            can('shipments:write')
              ? async (name) => (await addConsignee.mutateAsync({ name })).id
              : undefined
          }
        />
      </div>
    );
  }
  return (
    <div className="form-field-group" style={spanStyle(2)}>
      <FieldLabel name="forwarderId" label="Forwarder" />
      <AddNewSelect
        id="f-forwarderId"
        label="Forwarder"
        placeholder="Forwarder"
        value={forwarder.value}
        onChange={forwarder.onChange}
        onBlur={forwarder.onBlur}
        options={lookups.forwarders.map((x) => ({ value: x.id, label: x.name }))}
        onCreate={
          can('shipments:write')
            ? async (name) => (await addForwarder.mutateAsync({ name })).id
            : undefined
        }
      />
    </div>
  );
}

/**
 * An export's schedule, dated by its departure (no ETA or ETD port). By air: the flight, its
 * check-in and cut-off, and the flight date (kept as the ETD), with no containers.
 */
function ExportSchedule() {
  const mode = useWatch<FormValues, 'transportMode'>({ name: 'transportMode' });
  if (mode === 'AIR')
    return (
      <Card title="Schedule" icon="calendar" cols={2}>
        <Field name="flightNo" label="Flight No." placeholder="e.g. CZ 3054" />
        <Field name="checkInDate" label="Check-in Date" type="date" />
        <Field name="cutOffDate" label="Cut-off" type="date" />
        <Field name="etd" label="Flight Date" type="date" />
      </Card>
    );
  return (
    <>
      <Card title="Schedule" icon="calendar" cols={2}>
        <Field name="etd" label="ETD" type="date" />
        <Field name="atd" label="ATD (Actual Departure)" type="date" />
      </Card>
      <ContainersCard />
    </>
  );
}

function ContainersCard() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const loadType = useWatch({ control, name: 'loadType' });
  const direction = useWatch({ control, name: 'direction' });
  const byTruck = useWatch({ control, name: 'transportMode' }) === 'ROAD';
  const arr = useFieldArray({ control, name: 'containers' });
  const errs = errors.containers as unknown as
    (Record<number, Record<string, { message?: string }>> & { message?: string }) | undefined;
  if (loadType !== 'FCL')
    return (
      <Card title="Containers" icon="container" cols={1}>
        <p className={f.note}>
          Containers are recorded for CY / CY (FCL) shipments only. Change Shipping Terms on the
          Shipment Information tab to add them.
        </p>
      </Card>
    );
  return (
    <Card title="Containers" icon="container" cols={1}>
      <div>
        {arr.fields.length > 0 && (
          <div className="cdc-lines-wrap">
            <table className="cdc-lines-table">
              <thead>
                <tr>
                  <th>Container No.</th>
                  <th>Size</th>
                  <th>Liner Seal</th>
                  {direction === 'EXPORT' && <th>Customs Seal</th>}
                  {byTruck && <th>Truck No.</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {arr.fields.map((row, i) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        className="form-field-box"
                        placeholder="e.g. MRKU8974303"
                        {...register(`containers.${i}.containerNo`)}
                        aria-invalid={!!errs?.[i]?.containerNo}
                      />
                      <FieldError message={errs?.[i]?.containerNo?.message} />
                    </td>
                    <td>
                      <select className="form-field-box" {...register(`containers.${i}.size`)}>
                        <option value="">Size</option>
                        {CONTAINER_SIZES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/^(\d\d)/, "$1'")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="form-field-box"
                        placeholder="Liner Seal"
                        {...register(`containers.${i}.linerSeal`)}
                      />
                    </td>
                    {direction === 'EXPORT' && (
                      <td>
                        <input
                          className="form-field-box"
                          placeholder="Customs Seal"
                          {...register(`containers.${i}.customsSeal`)}
                        />
                      </td>
                    )}
                    {byTruck && (
                      <td>
                        <input
                          className="form-field-box"
                          placeholder="e.g. 3A-1234"
                          {...register(`containers.${i}.truckNo`)}
                        />
                      </td>
                    )}
                    <td>
                      <button
                        type="button"
                        className="cdc-remove-line-btn"
                        title="Remove container"
                        onClick={() => arr.remove(i)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <FieldError message={errs?.message} />
        <button
          type="button"
          className="cdc-add-line-btn"
          onClick={() => arr.append(blankContainer())}
        >
          + Add Container
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------ Steps ------------------------------ */

function buildSteps(
  direction: FormValues['direction'],
  mode: FormValues['transportMode'],
  lookups: LookupsResponse,
  detail: ShipmentDetail | undefined,
): Step[] {
  const ports = lookups.ports.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
  const units = lookups.values.QUANTITY_UNIT.map((v) => ({ value: v.value, label: v.label }));
  const materials = lookups.values.MATERIAL.map((v) => ({ value: v.value, label: v.label }));

  const statusCard = (
    <Card title="Shipment Status" icon="activity" cols={2}>
      <ShipmentStatusField />
      <ClearanceStatusField />
    </Card>
  );
  const thcCard = (
    <Card title="Invoice / THC" icon="receipt">
      <Field name="thcHblNo" label="Invoice / THC No." span={2} />
      <Field name="thcHblDate" label="Invoice / THC Date" type="date" />
      <Field name="thcHblAmount" label="Amount (USD)" placeholder="0.00" decimals={2} />
    </Card>
  );
  // By air there is no vessel, voyage or container, and the bills are air waybills.
  const air = mode === 'AIR';
  const remarkCard = (
    <Card title="Remark" icon="message" cols={1}>
      <Field name="remark" label="Remark" span="full" placeholder="Optional note" rows={5} />
    </Card>
  );

  if (direction === 'EXPORT') {
    // The same four tabs as an import: the shipment, its cargo invoices, its booking and
    // departure, then customs.
    return [
      {
        label: 'Shipment Information',
        fields: [
          'clientId',
          'shipperName',
          'consigneeId',
          'forwarderId',
          'broker',
          'destinationCountryIso2',
          'quantity',
          'quantityUnit',
          'material',
          'receivedDocumentDate',
        ],
        render: () => (
          <>
            <Card title="Parties & Destination" icon="users">
              <ExportShipperSelect lookups={lookups} />
              <PartiesFields lookups={lookups} which="consignee" />
              <PartiesFields lookups={lookups} which="forwarder" />
              <BrokerSelect lookups={lookups} />
            </Card>
            {/* Laid out like an import's: destination and export type, then quantity and unit. */}
            <Card title="Cargo" icon="box">
              <CountryField
                name="destinationCountryIso2"
                label="Destination Country"
                countries={lookups.countries}
                span={2}
              />
              <CargoTypeSelect label="Export Type" options={materials} />
              <QuantityField />
              <Select name="quantityUnit" label="Unit" options={units} placeholder="Select unit" />
            </Card>
          </>
        ),
      },
      {
        label: 'Cargo, Pricing & FOB',
        fields: ['invoices', 'thcHblNo', 'thcHblDate', 'thcHblAmount'],
        render: () => (
          <>
            <CargoSection shipmentId={detail?.id} />
            {thcCard}
          </>
        ),
      },
      {
        label: air ? 'Air Waybill & Schedule' : 'Booking, Schedule & Vessel',
        fields: [
          'bookingNo',
          'crd',
          'hblNo',
          'clearancePortId',
          'etd',
          'atd',
          'flightNo',
          'checkInDate',
          'cutOffDate',
          'containers',
          'loadType',
          'vesselName',
          'voyageNo',
          'coForm',
          'coNumber',
          'coStatus',
        ],
        render: () => (
          <>
            <ExportSchedule />
            <Card title="Booking & Clearance" icon="file">
              <Field name="bookingNo" label={air ? 'MAWB No.' : 'Booking / SO No.'} span={2} />
              <Field name="hblNo" label={air ? 'HAWB No.' : 'HBL No.'} span={2} />
              <Field name="crd" label="CRD" type="date" span={2} />
              <Select
                name="clearancePortId"
                label="Clearance Port"
                options={ports}
                placeholder="Select port"
                span={2}
              />
            </Card>
            <Card
              title={air ? 'Certificate of Origin' : 'Vessel & Certificate of Origin'}
              icon={air ? 'file' : 'ship'}
            >
              {!air && <Field name="vesselName" label="Vessel Name" span={2} />}
              {!air && <Field name="voyageNo" label="Voyage No." span={2} />}
              <CoFormSelect lookups={lookups} />
              <Field name="coNumber" label="CO Number" span={2} />
              <CoStatusSelect />
            </Card>
          </>
        ),
      },
      {
        label: 'Customs Declaration',
        fields: ['declarations', 'remark'],
        render: () => (
          <>
            <DeclarationsSection original={detail} />
            {remarkCard}
            {statusCard}
          </>
        ),
      },
    ];
  }

  return [
    {
      label: 'Shipment Information',
      fields: [
        'clientId',
        'shipperName',
        'consigneeId',
        'quantity',
        'quantityUnit',
        'forwarderId',
        'broker',
        'originCountryIso2',
        'material',
        'receivedDocumentDate',
      ],
      render: () => (
        <>
          <Card title="Parties" icon="users">
            <Field name="shipperName" label="Shipper Name" span={2} placeholder="Supplier name" />
            <PartiesFields lookups={lookups} which="consignee" />
            <PartiesFields lookups={lookups} which="forwarder" />
            <BrokerSelect lookups={lookups} />
          </Card>
          {/* Origin and import type on one row; quantity and unit share the half below. */}
          <Card title="Cargo" icon="box">
            <CountryField
              name="originCountryIso2"
              label="Origin Country"
              countries={lookups.countries}
              span={2}
            />
            <CargoTypeSelect label="Import Type" options={materials} />
            <QuantityField />
            <Select name="quantityUnit" label="Unit" options={units} placeholder="Select unit" />
          </Card>
        </>
      ),
    },
    {
      label: 'Item, Costing & Forwarding',
      fields: ['invoices', 'thcHblNo', 'thcHblDate', 'thcHblAmount'],
      render: () => (
        <>
          <CargoSection shipmentId={detail?.id} />
          {thcCard}
        </>
      ),
    },
    {
      label: air ? 'Origin, Destination & Air Waybill' : 'Origin, Destination & Vessel',
      fields: [
        'bookingNo',
        'hblNo',
        'doDate',
        'eta',
        'arriveFty',
        'vesselName',
        'voyageNo',
        'containers',
        'loadType',
      ],
      render: () => (
        <>
          <Card title="Schedule" icon="calendar" cols={2}>
            <Field name="eta" label="ETA Port" type="date" />
            <Field name="arriveFty" label="ETA Factory" type="date" />
          </Card>
          {!air && <ContainersCard />}
          <Card
            title={air ? 'Air Waybill & Delivery Order' : 'Bill of Lading & Delivery Order'}
            icon={air ? 'plane' : 'file'}
            cols={air ? 3 : 2}
          >
            {air && <Field name="bookingNo" label="MAWB No." />}
            <Field name="hblNo" label={air ? 'HAWB No.' : 'HBL No.'} />
            <Field name="doDate" label="DO / EDO Date" type="date" />
          </Card>
          {/* The clearance port is with the customs declarations (last tab). */}
          {!air && (
            <Card title="Vessel" icon="ship">
              <Field name="vesselName" label="Vessel Name" span={2} />
              <Field name="voyageNo" label="Voyage No." span={2} />
            </Card>
          )}
        </>
      ),
    },
    {
      label: 'Weights & Declaration',
      fields: ['clearancePortId', 'declarations', 'remark'],
      render: () => (
        <>
          <DeclarationsSection
            original={detail}
            port={
              <Select
                name="clearancePortId"
                label="Clearance Port"
                options={ports}
                placeholder="Select port"
              />
            }
          />
          {remarkCard}
          {statusCard}
        </>
      ),
    },
  ];
}
