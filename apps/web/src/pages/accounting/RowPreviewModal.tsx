import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BILLING_PACK_TYPES, type BillingDoc, type BillingShipmentRow } from '@gs/shared';
import { ErrorBanner } from '../../components/ui';
import { useBillingPack } from '../../features/billing';
import { useCompany } from '../../features/accounting';
import { fmtMoney } from '../../lib/format';
import { DebitNote, sheetClass, TaxOrDisbursement } from '../print/InvoicePrint';
import s from '../print/print.module.css';
import { PackPrintMenu } from './billingParts';
import { PACK_LABEL } from './billingUi';
import v from './RowPreviewModal.module.css';

/** An A4 sheet's width in CSS pixels (210 mm at 96 dpi). */
const SHEET_W = 794;
const STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5];

/**
 * A shipment row's tax invoice, disbursement and debit note side by side, full screen, each
 * as its printed sheet fitted to its column (or zoomed), for a quick check without opening
 * them one by one. CSS zoom, not a transform, so the text is laid out at its size and stays
 * sharp.
 */
export default function RowPreviewModal({
  clientId,
  month,
  row,
  back,
  onClose,
}: {
  clientId: string;
  month: string;
  row: BillingShipmentRow;
  back: string;
  onClose: () => void;
}) {
  const pack = useBillingPack(clientId, month, row.recordId);
  const company = useCompany();
  const c = company.data ?? {};
  const docs = pack.data?.docs ?? [];
  const hasDocs = BILLING_PACK_TYPES.some((t) => row.docs[t].some((d) => d.status !== 'VOID'));

  // "fit": a sheet as wide as its column; otherwise a fixed zoom (columns scroll).
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const fit = useColumnFit();
  const k = zoom === 'fit' ? fit.k : zoom;
  const step = (dir: 1 | -1) => {
    const i = STEPS.findIndex((x) => x >= k - 0.001);
    const next = dir > 0 ? STEPS.find((x) => x > k + 0.001) : STEPS[Math.max(0, i - 1)];
    setZoom(next ?? (dir > 0 ? STEPS[STEPS.length - 1]! : STEPS[0]!));
  };

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') step(1);
      else if (e.key === '-') step(-1);
      else if (e.key === '0') setZoom('fit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return createPortal(
    <div className={v.overlay} role="dialog" aria-modal="true" aria-labelledby="row-preview-title">
      <div className={v.bar}>
        <div className={v.titleBlock}>
          <h2 id="row-preview-title" className={v.title}>
            {row.declareNo} · {row.hbl ?? row.shipmentReference}
          </h2>
          <div className={v.sub}>Drafts marked DRAFT. Click a heading to open the document.</div>
        </div>
        <div className={v.tools}>
          <div className={v.zoom} role="group" aria-label="Zoom">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Zoom out"
              title="Zoom out (−)"
            >
              −
            </button>
            <span className={v.zoomValue}>{Math.round(k * 100)}%</span>
            <button type="button" onClick={() => step(1)} aria-label="Zoom in" title="Zoom in (+)">
              +
            </button>
            <button
              type="button"
              className={v.fitBtn}
              data-on={zoom === 'fit'}
              onClick={() => setZoom('fit')}
              title="Fit each sheet to its column (0)"
            >
              Fit
            </button>
          </div>
          {hasDocs && (
            <PackPrintMenu
              clientId={clientId}
              month={month}
              record={{ id: row.recordId, label: row.declareNo }}
              className={v.toolBtn}
            >
              Print
            </PackPrintMenu>
          )}
          <button
            type="button"
            ref={closeRef}
            className={v.close}
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
      </div>
      <ErrorBanner error={pack.error} />
      <div className={v.cols}>
        {BILLING_PACK_TYPES.map((t, i) => {
          const own = docs.filter((d) => d.type === t);
          return (
            <section key={t} className={v.col}>
              <div className={v.colHead}>
                <span className={v.colLabel}>{PACK_LABEL[t]}</span>
                {own.map((d) => (
                  <Link
                    key={d.id}
                    to={`/accounting/${t}/${d.id}?back=${back}`}
                    className={v.open}
                    data-status={d.status}
                  >
                    {d.number ?? 'Draft'} · {fmtMoney(d.totals.total)}
                    {d.status === 'DRAFT' && <em>Draft</em>} ↗
                  </Link>
                ))}
              </div>
              <div className={v.scroll} ref={i === 0 ? fit.ref : undefined}>
                {pack.isLoading || company.isLoading ? (
                  <div className={v.empty}>Loading…</div>
                ) : own.length ? (
                  own.map((d) => (
                    <div key={d.id} className={v.paper} style={{ zoom: k }}>
                      <Sheet d={d}>
                        {d.type === 'debit-notes' ? (
                          <DebitNote d={d} c={c} />
                        ) : (
                          <TaxOrDisbursement d={d} c={c} tax={d.type === 'tax-invoices'} />
                        )}
                      </Sheet>
                    </div>
                  ))
                ) : (
                  <div className={v.empty}>
                    {row.manual[t]
                      ? `${row.manual[t]!.number} was typed in the Monthly Ledger: no sheet to preview.`
                      : `No ${PACK_LABEL[t].toLowerCase()} yet.`}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

function Sheet({ d, children }: { d: BillingDoc; children: ReactNode }) {
  return (
    <div className={`${sheetClass(d.type)} ${v.sheet}`}>
      {d.status === 'DRAFT' && <div className={s.stamp}>DRAFT</div>}
      {children}
    </div>
  );
}

/** The zoom that makes an A4 sheet as wide as a column (measured on the first column). */
function useColumnFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.75);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Less the scroll area's padding and room for a scrollbar.
    const measure = () => setK(Math.max(0.3, (el.clientWidth - 28) / SHEET_W));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, k };
}
