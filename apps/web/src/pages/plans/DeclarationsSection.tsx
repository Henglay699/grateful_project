import type { ReactNode } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { type ShipmentDetail } from '@gs/shared';
import { FieldError } from '../../components/ui';
import { maskDeclareNo } from '../../lib/declareNo';
import { FIELD_ICON, fi } from './formIcons';
import sf from './ShipmentForm.module.css';
import { blankDeclaration, type FormValues } from './formModel';

/**
 * Customs declarations (the CDC master list is drawn down by the import invoice items).
 * `port`: the shipment's Clearance Port field, shown first on the first row (every
 * declaration clears there), with the column kept on the other rows so they line up.
 */
export function DeclarationsSection({
  original,
  port,
}: {
  original?: ShipmentDetail | undefined;
  port?: ReactNode;
}) {
  const {
    control,
    register,
    getValues,
    formState: { errors },
  } = useFormContext<FormValues>();
  const decls = useFieldArray({ control, name: 'declarations' });
  const direction = useWatch({ control, name: 'direction' });
  const transportMode = useWatch({ control, name: 'transportMode' });
  const watched = useWatch({ control, name: 'declarations' });
  const isImport = direction === 'IMPORT';
  // Air clears before customs numbers the declaration: the date can go in with the no. pending.
  const isAir = transportMode === 'AIR';

  const declErr = errors.declarations;
  return (
    <div className="cx-card">
      <div className="cx-card-head">
        <div className="cx-title">
          <span className="cx-title-icon">{fi.badge({ width: 18, height: 18 })}</span>
          <h3>Customs Declarations</h3>
        </div>
        <div className="cargo-actions">
          <button
            type="button"
            className="cargo-btn cargo-btn-primary"
            onClick={() => decls.append(blankDeclaration(getValues('clearancePortId') ?? ''))}
          >
            + Add Declaration
          </button>
        </div>
      </div>
      {typeof declErr?.message === 'string' && <FieldError message={declErr.message} />}
      {!decls.fields.length && (
        <p className="create-header-desc">
          No declaration yet. Add one when customs has issued the declaration number.
        </p>
      )}
      {decls.fields.map((f, di) => {
        const e = Array.isArray(declErr)
          ? (declErr[di] as Record<string, { message?: string }> | undefined)
          : undefined;
        const ledger = original?.declarations.find(
          (d) => d.id === watched?.[di]?.id,
        )?.hasLedgerEntry;
        return (
          <div
            key={f.id}
            style={{
              borderTop: di ? '1px solid var(--border-subtle)' : undefined,
              paddingTop: di ? 16 : 0,
              marginTop: di ? 16 : 0,
            }}
          >
            <input type="hidden" {...register(`declarations.${di}.id`)} />
            {/* A later declaration: its number, and Remove (or why it can't be removed). */}
            {di > 0 && (
              <div className={sf.declHead}>
                <span>Declaration {di + 1}</span>
                {ledger ? (
                  <span className="create-header-desc">
                    Has a ledger entry in Accounting, so it can't be removed here.
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-delete-shipment"
                    onClick={() => decls.remove(di)}
                  >
                    Remove declaration
                  </button>
                )}
              </div>
            )}
            {/* Equal columns across the card; declarations take the Clearance Port on save. */}
            <div className={sf.declGrid} data-cols={port ? 3 : 2}>
              {port && (di === 0 ? port : <div aria-hidden="true" />)}
              <div className="form-field-group">
                <label htmlFor={`d-${di}-no`} className={sf.label}>
                  {fi[FIELD_ICON.declareNo!]({})}
                  Declare No.
                </label>
                <input
                  id={`d-${di}-no`}
                  className="form-field-box"
                  placeholder={isAir ? 'Pending' : isImport ? 'e.g. I 122050' : 'e.g. E 41001'}
                  {...register(`declarations.${di}.declareNo`)}
                  onChange={(ev) => {
                    maskDeclareNo(ev);
                    void register(`declarations.${di}.declareNo`).onChange(ev);
                  }}
                  aria-invalid={!!e?.declareNo}
                />
                <FieldError message={e?.declareNo?.message} />
              </div>
              <div className="form-field-group">
                <label htmlFor={`d-${di}-date`} className={sf.label}>
                  {fi[FIELD_ICON.declareDate!]({})}
                  Declare Date
                </label>
                <input
                  id={`d-${di}-date`}
                  type="date"
                  className="form-field-box"
                  {...register(`declarations.${di}.declareDate`)}
                  aria-invalid={!!e?.declareDate}
                />
                <FieldError message={e?.declareDate?.message} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
