import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import {
  CONTAINER_SIZES,
  sealPlanStandaloneSchema,
  type SealPlanRow,
  type SealPlanShipment,
  type SealPlanStandaloneInput,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useDeleteSealPlan,
  useLookups,
  useSaveSealPlan,
  useSaveStandaloneSealPlan,
  useSealPlanShipment,
} from '../../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { useToast } from '../../components/Toast';
import { fmtDate } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';

/** What the editor opens on: a listed row, a shipment picked in "+ New Seal Plan", or blank. */
export type SealPlanTarget =
  { kind: 'row'; row: SealPlanRow } | { kind: 'shipment'; shipmentId: string } | { kind: 'blank' };

const NEW = '__new';
/** A shipment's container: the factory and the rest come from the shipment (the API ignores them). */
const linkedSchema = sealPlanStandaloneSchema.extend({ clientId: z.string() });

export function SealPlanModal({
  target,
  onClose,
}: {
  target: SealPlanTarget;
  onClose: () => void;
}) {
  const shipment = useSealPlanShipment(target.kind === 'shipment' ? target.shipmentId : null);
  const [picked, setPicked] = useState<string | null>(null);

  if (target.kind === 'row')
    return (
      <SealPlanForm
        row={target.row}
        shipment={null}
        standalone={!target.row.shipmentId}
        onClose={onClose}
      />
    );
  if (target.kind === 'blank')
    return <SealPlanForm row={null} shipment={null} standalone onClose={onClose} />;

  const s = shipment.data;
  if (!s)
    return (
      <Modal title="Loading…" onClose={onClose}>
        <ErrorBanner error={shipment.error} />
      </Modal>
    );
  // Open on the first container without a plan; a shipment without containers adds one.
  const sel = picked ?? s.rows.find((r) => !r.id)?.containerNo ?? s.rows[0]?.containerNo ?? NEW;
  return (
    <SealPlanForm
      key={sel}
      row={s.rows.find((r) => r.containerNo === sel) ?? null}
      shipment={s}
      selected={sel}
      onSelect={setPicked}
      standalone={false}
      onClose={onClose}
    />
  );
}

/** Edit a container's seals, trucking, loading date and depot (sealplans:write). */
function SealPlanForm({
  row,
  shipment,
  selected,
  onSelect,
  standalone,
  onClose,
}: {
  row: SealPlanRow | null;
  /** Set when the container is chosen from a picked shipment. */
  shipment: SealPlanShipment | null;
  selected?: string;
  onSelect?: (containerNo: string) => void;
  /** A plan without a shipment: factory, SO no., port, vessel and ETD are typed here. */
  standalone: boolean;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useLookups();
  const saveLinked = useSaveSealPlan();
  const saveStandalone = useSaveStandaloneSealPlan();
  const del = useDeleteSealPlan();
  const editable = can('sealplans:write');
  const s = (v: string | null | undefined) => v ?? '';
  const shipmentId = row?.shipmentId ?? shipment?.id ?? null;
  const addingContainer = !!shipment && selected === NEW;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SealPlanStandaloneInput>({
    resolver: formResolver(standalone ? sealPlanStandaloneSchema : linkedSchema),
    defaultValues: {
      clientId: s(row?.clientId),
      containerNo: s(row?.containerNo),
      bookingNo: s(row?.bookingNo),
      portId: s(row?.portId),
      vesselName: s(row?.vesselName),
      etd: s(row?.etd),
      size: row?.size ?? '',
      linerSeal: s(row?.linerSeal),
      customsSeal: s(row?.customsSeal),
      carrier: s(row?.carrier),
      destination: s(row?.destination),
      tareWeightKg: row?.tareWeightKg ? String(Number(row.tareWeightKg)) : '',
      truckBy: s(row?.truckBy),
      driverPhone: s(row?.driverPhone),
      truckNo: s(row?.truckNo),
      deliverTo: s(row?.deliverTo),
      loadingDate: s(row?.loadingDate),
      depot: s(row?.depot),
      other: s(row?.other),
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    if (standalone) await saveStandalone.mutateAsync({ id: row?.id, body: v });
    else
      await saveLinked.mutateAsync({
        shipmentId: shipmentId!,
        // The saved no. addresses the container; a changed one in the body renames it.
        containerNo: row?.containerNo ?? String(v.containerNo),
        body: v,
      });
    toast(addingContainer ? 'Container added to the shipment and saved.' : 'Seal plan saved.');
    onClose();
  });

  const remove = async () => {
    if (
      !row?.id ||
      !window.confirm(
        standalone
          ? 'Delete this seal plan?'
          : `Delete the seal plan of ${row.containerNo}? Its carrier, destination, tare weight, trucking, date, depot and other details are cleared. The container and its seals stay on ${row.shipmentReference ?? 'the shipping plan'}.`,
      )
    )
      return;
    await del.mutateAsync(row.id);
    toast('Seal plan deleted.');
    onClose();
  };

  const field = (
    name: keyof SealPlanStandaloneInput,
    label: string,
    opts: { span?: number; type?: 'date'; decimals?: number; placeholder?: string } = {},
  ) => (
    <div
      className="form-field-group"
      style={opts.span ? { gridColumn: `span ${opts.span}` } : undefined}
    >
      <label htmlFor={`sp-${name}`}>{label}</label>
      {opts.decimals !== undefined ? (
        <NumberInput
          id={`sp-${name}`}
          className="form-field-box"
          decimals={opts.decimals}
          {...register(name)}
          readOnly={!editable}
          aria-invalid={!!errors[name]}
        />
      ) : (
        <input
          id={`sp-${name}`}
          className="form-field-box"
          type={opts.type ?? 'text'}
          placeholder={opts.placeholder}
          {...register(name)}
          readOnly={!editable}
          aria-invalid={!!errors[name]}
        />
      )}
      <FieldError message={errors[name]?.message} />
    </div>
  );

  const select = (
    name: keyof SealPlanStandaloneInput,
    label: string,
    options: { value: string; label: string }[],
    empty: string,
    span?: number,
  ) => (
    <div className="form-field-group" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label htmlFor={`sp-${name}`}>{label}</label>
      <select
        id={`sp-${name}`}
        className="form-select-box"
        {...register(name)}
        disabled={!editable}
        aria-invalid={!!errors[name]}
      >
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError message={errors[name]?.message} />
    </div>
  );
  const sizes = CONTAINER_SIZES.map((v) => ({ value: v, label: v }));

  const ref = row?.shipmentReference ?? shipment?.reference;
  const info = row ?? shipment;
  const title = shipment
    ? `New Seal Plan · ${shipment.reference}`
    : row
      ? `${row.containerNo}${row.size ? ` · ${row.size}` : ''}`
      : 'New Seal Plan';
  const pending = saveLinked.isPending || saveStandalone.isPending;

  return (
    <Modal
      title={title}
      width={860}
      onClose={onClose}
      sub={
        standalone ? (
          'Not linked to a shipping plan: enter the shipment details here.'
        ) : (
          <>
            <Link
              to={`/plans/${shipmentId}`}
              onClick={onClose}
              style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
            >
              {ref}
            </Link>{' '}
            · {info?.clientName} · SO {info?.bookingNo ?? '-'} · {info?.vesselName ?? 'Vessel TBA'}{' '}
            · ETD {fmtDate(info?.etd)}
          </>
        )
      }
    >
      <ErrorBanner error={saveLinked.error ?? saveStandalone.error ?? del.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        {standalone && (
          <>
            <div className="form-section-title">Shipment</div>
            <div className="form-fields-grid">
              {select(
                'clientId',
                'Client',
                (lookups.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name })),
                'Choose…',
                2,
              )}
              {field('bookingNo', 'SO No.')}
              {select(
                'portId',
                'Port',
                (lookups.data?.ports ?? []).map((p) => ({ value: p.id, label: p.name })),
                '-',
              )}
              {field('vesselName', 'Vessel', { span: 2 })}
              {field('etd', 'ETD', { type: 'date' })}
            </div>
          </>
        )}
        <div className="form-section-title" style={standalone ? { marginTop: 18 } : undefined}>
          Container &amp; seals
        </div>
        <div className="form-fields-grid">
          {shipment && (
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="sp-pick">Container</label>
              <select
                id="sp-pick"
                className="form-select-box"
                value={selected}
                onChange={(e) => onSelect?.(e.target.value)}
              >
                {shipment.rows.map((r) => (
                  <option key={r.containerNo} value={r.containerNo}>
                    {r.containerNo}
                    {r.id ? ' (has a seal plan)' : ''}
                  </option>
                ))}
                <option value={NEW}>+ Add a container to this shipment</option>
              </select>
            </div>
          )}
          {/* From the picker, the Container dropdown above already names an existing one. */}
          {(!shipment || addingContainer) &&
            field('containerNo', 'Container no.', { placeholder: 'e.g. MRKU8974303' })}
          {select('size', 'Size', sizes, '-')}
          {field('linerSeal', 'Carrier seal')}
          {field('customsSeal', 'Customs seal')}
        </div>
        <div className="form-section-title" style={{ marginTop: 18 }}>
          Carrier &amp; destination
        </div>
        <div className="form-fields-grid">
          {field('carrier', 'Carrier', { placeholder: 'e.g. MAERSK' })}
          {field('destination', 'Destination', {
            span: 2,
            placeholder:
              row?.destinationCountry ?? shipment?.destinationCountry ?? 'e.g. LOS ANGELES, CA',
          })}
          {field('tareWeightKg', 'Tare weight (kg)', { decimals: 3 })}
        </div>
        <div className="form-section-title" style={{ marginTop: 18 }}>
          Trucking &amp; loading
        </div>
        <div className="form-fields-grid">
          {field('truckBy', 'Truck by')}
          {field('driverPhone', 'Driver phone')}
          {field('truckNo', 'Truck no.')}
          {field('loadingDate', 'Date', { type: 'date' })}
          {field('deliverTo', 'Deliver to', { span: 2 })}
          {field('depot', 'Depot', { span: 2 })}
          {field('other', 'Other', { span: 4 })}
        </div>
        {editable && (
          <div className={ui.actions}>
            {row?.id && (
              <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
                Delete seal plan
              </button>
            )}
            <button type="button" className="btn-cancel-shipment" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-create-submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
