import { useState, type ReactNode } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { companyBanks, companySchema, type CompanyInput } from '@gs/shared';
import { useApiMutation } from '../../features/admin';
import { ErrorBanner, FieldError } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { api } from '../../lib/api';
import { formResolver } from '../../lib/zodForm';
import { fi, type FormIcon } from '../plans/formIcons';
import s from './CompanyForm.module.css';

/**
 * Settings → Company: the details printed on tax invoices, disbursements and other documents,
 * in three sections (identity, address, bank), each labelled on the left with its fields on
 * the right. It opens read-only; the pencil (top right) unlocks it and shows the Save bar.
 * The bank section holds any number of accounts, printed in this order on invoices.
 */
export function CompanyForm({
  initial,
  manage,
  invalidate,
}: {
  initial: CompanyInput;
  manage: boolean;
  invalidate: Parameters<typeof useApiMutation>[1];
}) {
  const toast = useToast();
  const save = useApiMutation(
    (v: CompanyInput) => api('/settings/company', { method: 'PUT', json: v }),
    invalidate,
  );
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm<CompanyInput>({
    resolver: formResolver(companySchema),
    // Accounts saved before the list existed open as its first row.
    defaultValues: { ...initial, banks: companyBanks(initial) },
  });
  const banks = useFieldArray({ control, name: 'banks' });
  const [editing, setEditing] = useState(false);
  // The bank list opens on its first account; the toggle (top right) shows the rest.
  const [allBanks, setAllBanks] = useState(false);
  const cancel = () => {
    reset();
    setEditing(false);
  };
  const locked = !manage || !editing;
  const lockClass = `${s.fieldset}${editing ? '' : ` ${s.viewing}`}`;
  // A mistake in a folded-away account opens the list, so it can be seen.
  const hiddenError = Array.isArray(errors.banks) && errors.banks.slice(1).some(Boolean);
  const showAll = allBanks || hiddenError;
  const shown = showAll ? banks.fields : banks.fields.slice(0, 1);

  const field = (
    name: Exclude<keyof CompanyInput, 'banks'>,
    label: string,
    opts: { full?: boolean; multiline?: boolean; khmer?: boolean; placeholder?: string } = {},
  ) => (
    <div className={`${s.field}${opts.full ? ` ${s.full}` : ''}`}>
      <label htmlFor={`co-${name}`}>{label}</label>
      {opts.multiline ? (
        <textarea
          id={`co-${name}`}
          rows={2}
          className={`form-field-box ${s.textarea}${opts.khmer ? ` ${s.khmer}` : ''}`}
          placeholder={opts.placeholder}
          {...register(name)}
        />
      ) : (
        <input
          id={`co-${name}`}
          className={`form-field-box${opts.khmer ? ` ${s.khmer}` : ''}`}
          placeholder={opts.placeholder}
          aria-invalid={!!errors[name]}
          {...register(name)}
        />
      )}
      <FieldError message={errors[name]?.message} />
    </div>
  );
  const section = (
    icon: FormIcon,
    title: string,
    hint: string,
    children: ReactNode,
    cols: number | 'list' = 2,
    className = s.section,
  ) => (
    <section className={className}>
      <div className={s.sectionHead}>
        <div className={s.sectionTitle}>
          <span className="cx-title-icon">{fi[icon]({ width: 18, height: 18 })}</span>
          <h4>{title}</h4>
        </div>
        <p>{hint}</p>
      </div>
      <div className={s.fields} data-cols={cols}>
        {children}
      </div>
    </section>
  );
  const bankField = (
    i: number,
    name: 'bankName' | 'accountName' | 'accountNo',
    label: string,
    placeholder?: string,
  ) => (
    <div className={s.field}>
      <label htmlFor={`co-bank-${i}-${name}`}>{label}</label>
      <input
        id={`co-bank-${i}-${name}`}
        className="form-field-box"
        placeholder={placeholder}
        aria-invalid={!!errors.banks?.[i]?.[name]}
        {...register(`banks.${i}.${name}`)}
      />
      <FieldError message={errors.banks?.[i]?.[name]?.message} />
    </div>
  );

  return (
    <div className={s.card}>
      <header className={s.head}>
        <div className={s.headTitle}>
          <span className={`cx-title-icon ${s.headIcon}`}>{icons.company({})}</span>
          <div>
            <h3>Workspace &amp; company</h3>
            <p>Printed on tax invoices, disbursements and other documents.</p>
          </div>
        </div>
        {manage && !editing && (
          <button
            type="button"
            className={s.editBtn}
            onClick={() => setEditing(true)}
            aria-label="Edit company details"
            title="Edit company details"
          >
            {icons.edit({})}
          </button>
        )}
      </header>
      <ErrorBanner error={save.error} />
      <form
        onSubmit={(e) =>
          void handleSubmit(async (v) => {
            await save.mutateAsync(v);
            reset(v);
            setEditing(false);
            toast('Company details saved.');
          })(e)
        }
        noValidate
      >
        <fieldset disabled={locked} className={lockClass}>
          {section(
            'building',
            'Company identity',
            'The legal name in English and Khmer, as registered, with the tax number.',
            <>
              {field('nameEn', 'Company name (English)')}
              {field('nameKm', 'ឈ្មោះក្រុមហ៊ុន (Khmer)', { khmer: true })}
              {field('vattin', 'VATTIN', { placeholder: 'e.g. K008-902404873' })}
              {field('phone', 'Phone', { placeholder: 'e.g. 098 484 414' })}
            </>,
          )}
          {section(
            'pin',
            'Address',
            'The registered address, shown under the company name on each document.',
            <>
              {field('addressEn', 'Address (English)', { multiline: true })}
              {field('addressKm', 'អាស័យដ្ឋាន (Khmer)', { multiline: true, khmer: true })}
            </>,
          )}
        </fieldset>
        {/* Outside the locked fieldset so the show-all toggle works while viewing. */}
        {section(
            'bank',
            'Bank details',
            'Where clients pay; every account is printed, in this order, in the payment section of invoices.',
            <>
              {banks.fields.length === 0 && (
                <p className={s.empty}>No bank accounts yet.</p>
              )}
              {shown.map((b, i) => (
                <div key={b.id}>
                  <div className={s.bankHead}>
                    <span className={s.bankNo}>Account {i + 1}</span>
                    {i === 0 && banks.fields.length > 1 && (
                      <span className={s.bankTag}>Printed first</span>
                    )}
                    {i === 0 && banks.fields.length > 1 && (
                      <button
                        type="button"
                        className={s.bankToggle}
                        onClick={() => setAllBanks(!showAll)}
                        aria-expanded={showAll}
                      >
                        {showAll ? 'Show less' : `Show all ${banks.fields.length}`}
                        {icons.chevronDown({
                          width: 14,
                          height: 14,
                          className: showAll ? s.chevronUp : undefined,
                        })}
                      </button>
                    )}
                    {editing && (
                      <button
                        type="button"
                        className={s.bankRemove}
                        onClick={() => banks.remove(i)}
                        aria-label={`Remove account ${i + 1}`}
                        title="Remove this account"
                      >
                        {icons.trash({ width: 15, height: 15 })}
                      </button>
                    )}
                  </div>
                  <fieldset disabled={locked} className={`${lockClass} ${s.bankFields}`}>
                    {bankField(i, 'bankName', 'Bank', 'e.g. KB PRASAC BANK')}
                    {bankField(i, 'accountName', 'Account name')}
                    {bankField(i, 'accountNo', 'Account no.', 'e.g. 033 754 230 001')}
                  </fieldset>
                </div>
              ))}
              {editing && banks.fields.length < 10 && (
                <button
                  type="button"
                  className={s.addBank}
                  onClick={() => {
                    setAllBanks(true);
                    banks.append({
                      bankName: '',
                      accountName: initial.nameEn ?? '',
                      accountNo: '',
                    });
                  }}
                >
                  {icons.plus({ width: 14, height: 14 })}
                  Add bank account
                </button>
              )}
            </>,
            'list',
            `${s.section} ${s.bankSection}`,
          )}
        {manage && editing && (
          <footer className={s.foot}>
            <span className={s.status} aria-live="polite">
              {isDirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
            <button
              type="button"
              className="btn-cancel-shipment"
              disabled={save.isPending}
              onClick={cancel}
            >
              {isDirty ? 'Discard' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="btn-create-submit"
              disabled={!isDirty || save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save company details'}
            </button>
          </footer>
        )}
      </form>
    </div>
  );
}
