import { useState, type ReactNode } from 'react';
import type {
  CustomsPermitInput,
  CustomsPermitRow,
  ShipmentWorkflow,
  VendorInvoiceInput,
  VendorInvoiceRow,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useDeletePermit,
  useDeleteVendorInvoice,
  useSaveFigures,
  useSavePermit,
  useSaveVendorInvoice,
} from '../../features/workflow';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import { ErrorBanner, Modal, ui } from '../ui';
import { useToast } from '../Toast';
import { Glyph, type GlyphName } from './glyphs';
import w from './Workflow.module.css';

/** A card of the workflow panel. */
export function WCard({
  id,
  title,
  sub,
  icon,
  action,
  children,
}: {
  id?: string;
  title: string;
  sub?: ReactNode;
  icon: GlyphName;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`cx-card ${w.card}`} id={id}>
      <div className={w.cardHead}>
        <div className="cx-title">
          <span className="cx-title-icon">
            <Glyph name={icon} />
          </span>
          <div>
            <h3>{title}</h3>
            {sub && <p>{sub}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function AddButton({ onClick, label = 'Add' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className={w.addBtn} onClick={onClick}>
      <Glyph name="plus" size={14} /> {label}
    </button>
  );
}

/** Text / date / number field for the small forms here. */
function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  span,
  suffix,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'number';
  placeholder?: string;
  span?: number;
  suffix?: string;
}) {
  return (
    <div className="form-field-group" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label htmlFor={id}>{label}</label>
      <div className={w.inputWrap}>
        <input
          id={id}
          className="form-field-box"
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          step={type === 'number' ? 'any' : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className={w.suffix}>{suffix}</span>}
      </div>
    </div>
  );
}

/* ---------- Booked and measured (exports) ---------- */

export function FiguresCard({ wf }: { wf: ShipmentWorkflow }) {
  const { can } = useAuth();
  const toast = useToast();
  const save = useSaveFigures(wf.shipmentId);
  const initial = {
    bookedQty: wf.booked.qty ?? '',
    bookedGrossWeightKg: wf.booked.grossWeightKg ?? '',
    bookedCbm: wf.booked.cbm ?? '',
    measuredCbm: wf.measured.cbm ?? '',
    measuredGrossWeightKg: wf.measured.grossWeightKg ?? '',
  };
  const [v, setV] = useState(initial);
  const [editing, setEditing] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const empty = Object.values(initial).every((x) => !x);
  return (
    <WCard
      id="wf-figures"
      title="Booked & measured"
      sub="Compared with the final packing list and the forwarder's bill."
      icon="scale"
      action={
        can('shipments:write') && !editing ? (
          <button type="button" className={w.addBtn} onClick={() => setEditing(true)}>
            <Glyph name="edit" size={14} /> {empty ? 'Enter' : 'Edit'}
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <>
          <div className={w.formGrid}>
            <Field
              id="f-bq"
              label="Booked qty"
              value={v.bookedQty}
              onChange={set('bookedQty')}
              type="number"
              suffix="pcs"
            />
            <Field
              id="f-bg"
              label="Booked G.W."
              value={v.bookedGrossWeightKg}
              onChange={set('bookedGrossWeightKg')}
              type="number"
              suffix="kg"
            />
            <Field
              id="f-bc"
              label="Booked CBM"
              value={v.bookedCbm}
              onChange={set('bookedCbm')}
              type="number"
              suffix="m³"
            />
            <Field
              id="f-mc"
              label="Measured CBM (CFS)"
              value={v.measuredCbm}
              onChange={set('measuredCbm')}
              type="number"
              suffix="m³"
            />
            <Field
              id="f-mg"
              label="Measured G.W. (CFS)"
              value={v.measuredGrossWeightKg}
              onChange={set('measuredGrossWeightKg')}
              type="number"
              suffix="kg"
            />
          </div>
          <ErrorBanner error={save.error} />
          <div className={w.formActions}>
            <button
              type="button"
              className="btn-cancel-shipment"
              onClick={() => {
                setV(initial);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-create-submit"
              disabled={save.isPending}
              onClick={() =>
                void save.mutateAsync(v).then(() => {
                  toast('Saved. The cross-checks are updated.');
                  setEditing(false);
                })
              }
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        <dl className={w.figures}>
          <div>
            <dt>Booked</dt>
            <dd>
              {wf.booked.qty ? `${fmtNum(wf.booked.qty)} pcs` : '—'}
              <small>
                {wf.booked.grossWeightKg ? `${fmtNum(wf.booked.grossWeightKg, 2)} kg` : ''}
                {wf.booked.cbm ? ` · ${fmtNum(wf.booked.cbm)} m³` : ''}
              </small>
            </dd>
          </div>
          <div>
            <dt>Measured at CFS</dt>
            <dd>
              {wf.measured.cbm ? `${fmtNum(wf.measured.cbm)} m³` : '—'}
              <small>
                {wf.measured.grossWeightKg ? `${fmtNum(wf.measured.grossWeightKg, 2)} kg` : ''}
              </small>
            </dd>
          </div>
        </dl>
      )}
    </WCard>
  );
}

/* ---------- Customs permits ---------- */

function daysTone(days: number | null) {
  if (days === null) return 'neutral';
  if (days < 0) return 'exception';
  if (days <= 7) return 'pending';
  return 'completed';
}

export function PermitsCard({ wf }: { wf: ShipmentWorkflow }) {
  const { can } = useAuth();
  const write = can('customs:write');
  const del = useDeletePermit(wf.shipmentId);
  const [editing, setEditing] = useState<CustomsPermitRow | 'new' | null>(null);
  return (
    <WCard
      id="wf-permits"
      title="Customs permits"
      sub="GDCE permit number and validity (NSW)."
      icon="stamp"
      action={write ? <AddButton onClick={() => setEditing('new')} /> : undefined}
    >
      {wf.permits.length === 0 ? (
        <p className={w.nothing}>No permit recorded yet.</p>
      ) : (
        <ul className={w.rows}>
          {wf.permits.map((p) => (
            <li key={p.id} className={w.row}>
              <div className={w.rowMain}>
                <b className={w.mono}>{p.permitNo}</b>
                <small>
                  {p.issueDate ? `Issued ${fmtDate(p.issueDate)}` : 'Issue date —'}
                  {p.office ? ` · ${p.office}` : ''}
                </small>
              </div>
              <span className={`status-tag ${daysTone(p.daysLeft)}`}>
                {p.validUntil === null
                  ? 'No expiry'
                  : p.daysLeft! < 0
                    ? `Expired ${fmtDate(p.validUntil)}`
                    : p.daysLeft === 0
                      ? 'Expires today'
                      : `${p.daysLeft} days left`}
              </span>
              {write && (
                <span className={w.rowBtns}>
                  <button type="button" aria-label="Edit permit" onClick={() => setEditing(p)}>
                    <Glyph name="edit" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete permit"
                    onClick={() =>
                      window.confirm(`Delete permit ${p.permitNo}?`) && void del.mutateAsync(p.id)
                    }
                  >
                    <Glyph name="trash" size={14} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <PermitDialog
          shipmentId={wf.shipmentId}
          permit={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </WCard>
  );
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function PermitDialog({
  shipmentId,
  permit,
  onClose,
}: {
  shipmentId: string;
  permit: CustomsPermitRow | null;
  onClose: () => void;
}) {
  const save = useSavePermit(shipmentId);
  const toast = useToast();
  const [v, setV] = useState<Record<keyof CustomsPermitInput, string>>({
    permitNo: permit?.permitNo ?? '',
    issueDate: permit?.issueDate ?? '',
    validFrom: permit?.validFrom ?? '',
    validUntil: permit?.validUntil ?? '',
    office: permit?.office ?? '',
    remark: permit?.remark ?? '',
    documentId: permit?.documentId ?? '',
  });
  const set = (k: keyof typeof v) => (x: string) => {
    const next = { ...v, [k]: x };
    // GDCE permits run one month from issue: fill the validity when the issue date is typed.
    if (k === 'issueDate' && x && !v.validFrom) next.validFrom = x;
    if (k === 'issueDate' && x && !v.validUntil) next.validUntil = addDays(x, 30);
    setV(next);
  };
  return (
    <Modal
      title={permit ? 'Edit customs permit' : 'Record customs permit'}
      sub="Upload the permit PDF under Documents as “Customs Permit”."
      onClose={onClose}
      width={560}
    >
      <div className={w.formGrid}>
        <Field
          id="p-no"
          label="Permit no."
          value={v.permitNo}
          onChange={set('permitNo')}
          placeholder="PRT20260914GDCE168890"
          span={2}
        />
        <Field
          id="p-issue"
          label="Issue date"
          value={v.issueDate}
          onChange={set('issueDate')}
          type="date"
        />
        <Field
          id="p-office"
          label="Office"
          value={v.office}
          onChange={set('office')}
          placeholder="CHQ42"
        />
        <Field
          id="p-from"
          label="Valid from"
          value={v.validFrom}
          onChange={set('validFrom')}
          type="date"
        />
        <Field
          id="p-until"
          label="Valid until"
          value={v.validUntil}
          onChange={set('validUntil')}
          type="date"
        />
        <Field id="p-remark" label="Remark" value={v.remark} onChange={set('remark')} span={2} />
      </div>
      <ErrorBanner error={save.error} />
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={v.permitNo.trim().length < 3 || save.isPending}
          onClick={() =>
            void save.mutateAsync({ permitId: permit?.id, body: v }).then(() => {
              toast(permit ? 'Permit updated.' : 'Permit recorded.');
              onClose();
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Vendor invoices ---------- */

export function VendorInvoicesCard({ wf }: { wf: ShipmentWorkflow }) {
  const { can } = useAuth();
  const write = can('accounting:write');
  const save = useSaveVendorInvoice(wf.shipmentId);
  const del = useDeleteVendorInvoice(wf.shipmentId);
  const toast = useToast();
  const [editing, setEditing] = useState<VendorInvoiceRow | 'new' | null>(null);
  const rows = wf.vendorInvoices.rows;
  const markPaid = (v: VendorInvoiceRow) =>
    void save
      .mutateAsync({
        invoiceId: v.id,
        body: { ...toInput(v), paidOn: new Date().toISOString().slice(0, 10) },
      })
      .then(() => toast(`${v.invoiceNo} marked paid.`));
  return (
    <WCard
      id="wf-vendor"
      title="Vendor invoices"
      sub={
        wf.vendorInvoices.count
          ? `${wf.vendorInvoices.count} invoice${wf.vendorInvoices.count > 1 ? 's' : ''}${wf.vendorInvoices.total ? ` · ${fmtMoney(wf.vendorInvoices.total)}` : ''}${wf.vendorInvoices.unpaid ? ` · ${wf.vendorInvoices.unpaid} unpaid` : ' · all paid'}`
          : 'Forwarder and destination agent bills (our cost).'
      }
      icon="receipt"
      action={write ? <AddButton onClick={() => setEditing('new')} /> : undefined}
    >
      {wf.vendorInvoices.count === 0 ? (
        <p className={w.nothing}>None entered yet.</p>
      ) : !rows ? (
        <p className={w.nothing}>
          {wf.vendorInvoices.unpaid
            ? `${wf.vendorInvoices.unpaid} still to be paid by Accounting.`
            : 'All paid.'}
        </p>
      ) : (
        <ul className={w.rows}>
          {rows.map((v) => (
            <li key={v.id} className={w.row}>
              <div className={w.rowMain}>
                <b>
                  {v.vendorName} <span className={w.mono}>{v.invoiceNo}</span>
                </b>
                <small>
                  {v.description ?? ''}
                  {v.billedCbm ? ` · billed ${fmtNum(v.billedCbm)} m³` : ''}
                </small>
              </div>
              <span className={w.amount}>{fmtMoney(v.total)}</span>
              {v.paidOn ? (
                <span className="status-tag completed">Paid {fmtDate(v.paidOn)}</span>
              ) : write ? (
                <button type="button" className={w.payBtn} onClick={() => markPaid(v)}>
                  Mark paid
                </button>
              ) : (
                <span className="status-tag pending">Unpaid</span>
              )}
              {write && (
                <span className={w.rowBtns}>
                  <button type="button" aria-label="Edit invoice" onClick={() => setEditing(v)}>
                    <Glyph name="edit" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete invoice"
                    onClick={() =>
                      window.confirm(`Delete ${v.vendorName} ${v.invoiceNo}?`) &&
                      void del.mutateAsync(v.id)
                    }
                  >
                    <Glyph name="trash" size={14} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <VendorDialog
          shipmentId={wf.shipmentId}
          invoice={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </WCard>
  );
}

function toInput(v: VendorInvoiceRow): Record<keyof VendorInvoiceInput, string> {
  return {
    vendorName: v.vendorName,
    invoiceNo: v.invoiceNo,
    invoiceDate: v.invoiceDate ?? '',
    description: v.description ?? '',
    amount: v.amount,
    vat: v.vat,
    billedCbm: v.billedCbm ?? '',
    billedGrossWeightKg: v.billedGrossWeightKg ?? '',
    dueDate: v.dueDate ?? '',
    paidOn: v.paidOn ?? '',
    paymentRef: v.paymentRef ?? '',
    documentId: v.documentId ?? '',
  };
}

function VendorDialog({
  shipmentId,
  invoice,
  onClose,
}: {
  shipmentId: string;
  invoice: VendorInvoiceRow | null;
  onClose: () => void;
}) {
  const save = useSaveVendorInvoice(shipmentId);
  const toast = useToast();
  const [v, setV] = useState<Record<keyof VendorInvoiceInput, string>>(
    invoice
      ? toInput(invoice)
      : {
          vendorName: '',
          invoiceNo: '',
          invoiceDate: new Date().toISOString().slice(0, 10),
          description: '',
          amount: '',
          vat: '0',
          billedCbm: '',
          billedGrossWeightKg: '',
          dueDate: '',
          paidOn: '',
          paymentRef: '',
          documentId: '',
        },
  );
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const total = (Number(v.amount) || 0) + (Number(v.vat) || 0);
  return (
    <Modal
      title={invoice ? 'Edit vendor invoice' : 'Add vendor invoice'}
      sub="Billed CBM / weight are compared with what was declared and measured."
      onClose={onClose}
      width={620}
    >
      <div className={w.formGrid}>
        <Field
          id="v-vendor"
          label="Vendor"
          value={v.vendorName}
          onChange={set('vendorName')}
          placeholder="e.g. CF Global"
        />
        <Field
          id="v-no"
          label="Invoice no."
          value={v.invoiceNo}
          onChange={set('invoiceNo')}
          placeholder="TICF20262941"
        />
        <Field
          id="v-date"
          label="Invoice date"
          value={v.invoiceDate}
          onChange={set('invoiceDate')}
          type="date"
        />
        <Field
          id="v-due"
          label="Due date"
          value={v.dueDate}
          onChange={set('dueDate')}
          type="date"
        />
        <Field
          id="v-desc"
          label="Description"
          value={v.description}
          onChange={set('description')}
          placeholder="THC, CFS, BL fee…"
          span={2}
        />
        <Field
          id="v-amt"
          label="Amount (before VAT)"
          value={v.amount}
          onChange={set('amount')}
          type="number"
          suffix="USD"
        />
        <Field
          id="v-vat"
          label="VAT"
          value={v.vat}
          onChange={set('vat')}
          type="number"
          suffix="USD"
        />
        <Field
          id="v-cbm"
          label="Billed CBM"
          value={v.billedCbm}
          onChange={set('billedCbm')}
          type="number"
          suffix="m³"
        />
        <Field
          id="v-gw"
          label="Billed G.W."
          value={v.billedGrossWeightKg}
          onChange={set('billedGrossWeightKg')}
          type="number"
          suffix="kg"
        />
        <Field id="v-paid" label="Paid on" value={v.paidOn} onChange={set('paidOn')} type="date" />
        <Field
          id="v-ref"
          label="Payment ref."
          value={v.paymentRef}
          onChange={set('paymentRef')}
          placeholder="ABA transfer…"
        />
      </div>
      <div className={w.totalLine}>
        Total <b>{fmtMoney(total)}</b>
      </div>
      <ErrorBanner error={save.error} />
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={
            !v.vendorName.trim() || !v.invoiceNo.trim() || v.amount === '' || save.isPending
          }
          onClick={() =>
            void save.mutateAsync({ invoiceId: invoice?.id, body: v }).then(() => {
              toast(invoice ? 'Invoice updated.' : 'Invoice added.');
              onClose();
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
