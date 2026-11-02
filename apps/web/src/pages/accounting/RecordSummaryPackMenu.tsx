import { useEffect, useRef, useState } from 'react';
import { useCompany } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { printInPlace } from '../../lib/printInPlace';
import { exportRecordSummaryPackExcel } from './recordSummaryExport';
import { loadRecordSummaryPack, PACK_FILTERS, type PackFilters } from './recordSummaryPack';
// Same look as Credit Noted's ⋯.
import m from '../creditnoted/PackMenu.module.css';

/**
 * Record Summary → ⋯: the summaries matching the list's filters (every page) as one PDF
 * (one A4 page each, through the print dialog) or one Excel workbook (one sheet each).
 */
export function RecordSummaryPackMenu({ filters, count }: { filters: PackFilters; count: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const lookups = useLookups();
  const company = useCompany();
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

  const query = new URLSearchParams(
    PACK_FILTERS.flatMap((k) => (filters[k] ? [[k, filters[k]!]] : [])),
  ).toString();
  const pdf = () => {
    setOpen(false);
    printInPlace(`/print/record-summary-pack${query ? `?${query}` : ''}`);
  };
  const excel = async () => {
    setOpen(false);
    setBusy(true);
    try {
      const docs = await loadRecordSummaryPack(filters);
      if (!docs.length) return toast('No record summaries match these filters.');
      const h = (d: (typeof docs)[number], k: string) => d.header[k] ?? undefined;
      const first = docs[0]!.date;
      const last = docs[docs.length - 1]!.date;
      await exportRecordSummaryPackExcel(
        docs.map((doc) => ({
          doc,
          port: lookups.data?.ports.find((p) => p.id === h(doc, 'portId'))?.name,
          forwarder: lookups.data?.forwarders.find((f) => f.id === h(doc, 'forwarderId'))?.name,
        })),
        company.data ?? {},
        `RecordSummary_${first === last ? first : `${first}_to_${last}`}.xlsx`,
      );
      toast(`Excel pack saved: ${docs.length} sheet${docs.length === 1 ? '' : 's'}.`);
    } catch {
      toast('Could not build the Excel pack. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const none = count === 0;
  const label = `${count} record summar${count === 1 ? 'y' : 'ies'}`;
  return (
    <div className={m.wrap} ref={box}>
      <button
        type="button"
        className={m.dots}
        aria-label="More: PDF or Excel pack"
        aria-haspopup="menu"
        aria-expanded={open}
        title="PDF or Excel pack of the record summaries shown"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <span className={m.spinner} aria-hidden /> : icons.dots({})}
      </button>
      {open && (
        <div className={m.menu} role="menu">
          <div className={m.head}>{none ? 'Nothing to export' : `${label} · current filters`}</div>
          <button type="button" role="menuitem" className={m.item} disabled={none} onClick={pdf}>
            {icons.documents({ width: 16, height: 16 })}
            <span>
              <b>PDF Pack</b>
              <small>One page per record summary · print or save as PDF</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={m.item}
            disabled={none}
            onClick={() => void excel()}
          >
            {icons.download({ width: 16, height: 16 })}
            <span>
              <b>Excel Pack</b>
              <small>One sheet per record summary · .xlsx</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
