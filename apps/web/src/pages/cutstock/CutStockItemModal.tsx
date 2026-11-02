import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import {
  CUT_STOCK_CATEGORIES,
  CUT_STOCK_CATEGORY_LABEL,
  cutStockItemInputSchema,
  type CutStockItemInput,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCutStockItem, useDeleteCutStockItem, useSaveCutStockItem } from '../../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtNum, fmtPct } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';
import g from './CutStockItemModal.module.css';

/** View an item's balance and import history; edit or create it (cutstock:write). */
export function CutStockItemModal({
  itemId,
  clientId,
  onClose,
}: {
  itemId: string | null;
  clientId: string;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const item = useCutStockItem(itemId);
  const save = useSaveCutStockItem();
  const del = useDeleteCutStockItem();
  const editable = can('cutstock:write');
  const d = item.data;

  const form = useForm<CutStockItemInput>({
    resolver: formResolver(cutStockItemInputSchema),
    values: d
      ? {
          clientId,
          declareRef: d.declareRef,
          category: d.category,
          name: d.name,
          newOrUsed: d.newOrUsed ?? '',
          unit: d.unit,
          qty: String(Number(d.qty)),
          unitPrice: String(Number(d.unitPrice)),
          remarks: d.remarks ?? '',
          openingImportedQty: String(Number(d.openingImportedQty)),
        }
      : {
          clientId,
          declareRef: '',
          category: 'MACHINERY_EQUIPMENT',
          name: '',
          newOrUsed: 'New',
          unit: 'SET',
          qty: '',
          unitPrice: '',
          remarks: '',
          openingImportedQty: '0',
        },
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  const onSubmit = handleSubmit(async (v) => {
    if (itemId) {
      const { clientId: _c, ...patch } = v;
      await save.mutateAsync({ id: itemId, body: patch });
      toast('Item saved.');
    } else {
      await save.mutateAsync({ body: v });
      toast('Item added to the master list.');
    }
    onClose();
  });

  const remove = async () => {
    if (!itemId || !window.confirm('Delete this item from the master list?')) return;
    await del.mutateAsync(itemId);
    toast('Item deleted.');
    onClose();
  };

  if (itemId && item.isLoading)
    return (
      <Modal title="Loading…" onClose={onClose}>
        <div />
      </Modal>
    );

  const input = (
    name: keyof CutStockItemInput,
    label: string,
    span?: 2 | 3,
    /** A number field (digits only, shown with commas) with at most this many decimals. */
    decimals?: number,
  ) => (
    <div className={`form-field-group ${span ? g[`span${span}`] : ''}`}>
      <label htmlFor={`cs-${name}`}>{label}</label>
      {decimals !== undefined ? (
        <NumberInput
          id={`cs-${name}`}
          className="form-field-box"
          decimals={decimals}
          {...register(name)}
          readOnly={!editable}
          aria-invalid={!!errors[name]}
        />
      ) : (
        <input
          id={`cs-${name}`}
          className="form-field-box"
          {...register(name)}
          readOnly={!editable}
          aria-invalid={!!errors[name]}
        />
      )}
      <FieldError message={errors[name]?.message} />
    </div>
  );

  return (
    <Modal
      title={d ? `${d.declareRef} · ${d.name}` : 'Add master-list item'}
      width={860}
      onClose={onClose}
      sub={
        d ? (
          <>
            Balance{' '}
            <b>
              {fmtNum(d.balance)} {d.unit}
            </b>{' '}
            ({fmtPct(d.balancePct)}) ·{' '}
            <Pill tone={d.condition === 'OK' ? 'completed' : 'exception'}>{d.condition}</Pill>
          </>
        ) : (
          'New items start with the opening imported quantity you enter.'
        )
      }
    >
      <ErrorBanner error={item.error ?? save.error ?? del.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="form-section-title">Item</div>
        <div className={g.grid}>
          {input('declareRef', 'Declare No. (e.g. I-12)')}
          <div className={`form-field-group ${g.span2}`}>
            <label htmlFor="cs-category">Category</label>
            <select
              id="cs-category"
              className="form-select-box"
              {...register('category')}
              disabled={!editable}
            >
              {CUT_STOCK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CUT_STOCK_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          {input('newOrUsed', 'New / Used')}
          {input('name', 'Item', 3)}
          {input('unit', 'Unit')}
        </div>
        <div className="form-section-title" style={{ marginTop: 16 }}>
          Quantity &amp; value
        </div>
        <div className={g.grid}>
          {input('qty', 'Licensed quantity', undefined, 3)}
          {input('openingImportedQty', 'Imported before this system', undefined, 3)}
          {input('unitPrice', 'Unit price (USD)', undefined, 4)}
          {input('remarks', 'Remarks')}
        </div>
        {editable && (
          <div className={ui.actions}>
            {d && d.movements.length === 0 && (
              <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
                Delete item
              </button>
            )}
            <button type="button" className="btn-cancel-shipment" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-create-submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : d ? 'Save item' : 'Add item'}
            </button>
          </div>
        )}
      </form>
      {d && (
        <>
          <div className="form-section-title" style={{ marginTop: 22 }}>
            Import invoice items that drew on this item
          </div>
          <div className="plans-table-scroll">
            <table className="data-table-clean">
              <thead>
                <tr>
                  <th>Invoice No.</th>
                  <th>Date</th>
                  <th>Shipment</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {d.movements.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 18 }}
                    >
                      No imports in this system yet.{' '}
                      {Number(d.openingImportedQty) > 0 &&
                        `${fmtNum(d.openingImportedQty)} ${d.unit} were imported before (from the spreadsheet).`}
                    </td>
                  </tr>
                )}
                {d.movements.map((m) => (
                  <tr key={m.id}>
                    <td className="val-bold">{m.invoiceNo}</td>
                    <td>{m.invoiceDate ? fmtDate(m.invoiceDate) : '-'}</td>
                    <td>
                      <Link
                        to={`/plans/${m.shipmentId}`}
                        onClick={onClose}
                        style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
                      >
                        {m.shipmentReference}
                      </Link>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {fmtNum(m.qty)} {d.unit}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {m.overrideReason ? `${m.overrideBy ?? ''}: ${m.overrideReason}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
