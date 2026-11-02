import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { downloadFile } from '../../lib/files';
import { printInPlace } from '../../lib/printInPlace';
import { SEAL_PLAN_FILTERS } from './sealPlanFormat';
import m from '../creditnoted/PackMenu.module.css';

type Filters = Partial<Record<(typeof SEAL_PLAN_FILTERS)[number], string>>;

/** Seal Plans → ⋯: the rows matching the list's filters as an Excel workbook or a PDF. */
export function SealPlansMenu({ filters, count }: { filters: Filters; count: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
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

  const query = Object.fromEntries(
    SEAL_PLAN_FILTERS.flatMap((k) => (filters[k] ? [[k, filters[k]!]] : [])),
  );
  const pdf = () => {
    setOpen(false);
    printInPlace(`/print/seal-plans?${new URLSearchParams(query).toString()}`);
  };
  const excel = async () => {
    setOpen(false);
    setBusy(true);
    try {
      await downloadFile('/seal-plans/export.xlsx', query);
    } catch {
      toast('Export failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const none = count === 0;
  return (
    <div className={m.wrap} ref={box}>
      <button
        type="button"
        className={m.dots}
        aria-label="More: Export Excel or PDF"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export the seal plans shown"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <span className={m.spinner} aria-hidden /> : icons.dots({})}
      </button>
      {open && (
        <div className={m.menu} role="menu">
          <div className={m.head}>
            {none
              ? 'Nothing to export'
              : `${count} container${count === 1 ? '' : 's'} · current filters`}
          </div>
          <button
            type="button"
            role="menuitem"
            className={m.item}
            disabled={none}
            onClick={() => void excel()}
          >
            {icons.download({ width: 16, height: 16 })}
            <span>
              <b>Export Excel</b>
              <small>The seal plan sheet, by month · .xlsx</small>
            </span>
          </button>
          <button type="button" role="menuitem" className={m.item} disabled={none} onClick={pdf}>
            {icons.documents({ width: 16, height: 16 })}
            <span>
              <b>Export PDF</b>
              <small>A4 landscape · print or save as PDF</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
