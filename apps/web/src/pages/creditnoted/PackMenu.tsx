import { useEffect, useRef, useState } from 'react';
import { useLookups } from '../../features/hooks';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { printInPlace } from '../../lib/printInPlace';
import { exportCreditNotePackExcel } from './creditNoteExport';
import { loadCreditNotePack, PACK_FILTERS, type PackFilters } from './creditNotePack';
import m from './PackMenu.module.css';

/**
 * Credit Noted → ⋯: the credit notes matching the list's filters (every page) as one
 * PDF (one A4 page each, through the print dialog) or one Excel workbook (one sheet each).
 */
export function PackMenu({ filters, count }: { filters: PackFilters; count: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const lookups = useLookups();
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
    printInPlace(`/print/credit-noted-pack${query ? `?${query}` : ''}`);
  };
  const excel = async () => {
    setOpen(false);
    setBusy(true);
    try {
      const docs = await loadCreditNotePack(filters);
      if (!docs.length) return toast('No credit notes match these filters.');
      const port = (id: string | null | undefined) =>
        lookups.data?.ports.find((p) => p.id === id)?.name;
      const first = docs[0]!.date;
      const last = docs[docs.length - 1]!.date;
      await exportCreditNotePackExcel(
        docs.map((doc) => ({ doc, portName: port(doc.header.portId) })),
        `CreditNoted_${first === last ? first : `${first}_to_${last}`}.xlsx`,
      );
      toast(`Excel pack saved: ${docs.length} sheet${docs.length === 1 ? '' : 's'}.`);
    } catch {
      toast('Could not build the Excel pack. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const none = count === 0;
  const label = `${count} credit note${count === 1 ? '' : 's'}`;
  return (
    <div className={m.wrap} ref={box}>
      <button
        type="button"
        className={m.dots}
        aria-label="More: PDF or Excel pack"
        aria-haspopup="menu"
        aria-expanded={open}
        title="PDF or Excel pack of the credit notes shown"
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
              <small>One page per credit note · print or save as PDF</small>
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
              <small>One sheet per credit note · .xlsx</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
