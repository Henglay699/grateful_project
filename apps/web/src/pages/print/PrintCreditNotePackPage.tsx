import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLookups } from '../../features/hooks';
import { loadCreditNotePack, packFilters } from '../creditnoted/creditNotePack';
import { CreditNote, sheetClass } from './PrintDocPage';
import { useAutoPrint } from './useAutoPrint';
import s from './print.module.css';
import p from './billingPrint.module.css';

/**
 * Credit Noted → ⋯ → PDF Pack: every credit note matching the list's filters, one A4 page
 * each, for one print / PDF.
 */
export function PrintCreditNotePackPage() {
  const [params] = useSearchParams();
  const filters = packFilters(params);
  const pack = useQuery({
    queryKey: ['credit-note-pack', filters],
    queryFn: () => loadCreditNotePack(filters),
  });
  const lookups = useLookups();
  useEffect(() => {
    const list = pack.data;
    if (!list?.length) return;
    const first = list[0]!.date;
    const last = list[list.length - 1]!.date;
    document.title = `Credit Noted ${first === last ? first : `${first} – ${last}`} (${list.length})`;
  }, [pack.data]);
  const docs = pack.data ?? [];
  useAutoPrint(!!pack.data && pack.data.length > 0 && !lookups.isLoading);

  if (pack.isLoading || lookups.isLoading) return <div className={s.page}>Loading…</div>;
  if (pack.error) return <div className={s.page}>Could not load the credit notes.</div>;
  return (
    <div className={s.page}>
      <div className={p.toolbar}>
        <b>
          {docs.length} credit note{docs.length === 1 ? '' : 's'}
        </b>
        <div className={p.buttons}>
          <button type="button" className={s.btn} onClick={() => window.close()}>
            Close
          </button>
          <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>
      {docs.length ? (
        <div className={p.pack}>
          {docs.map((d) => (
            <div className={sheetClass(d.type)} key={d.id}>
              {/* Drafts print plain, as from the editor; only a discarded note is marked. */}
              {d.status === 'VOID' && <div className={s.stamp}>DISCARDED</div>}
              <CreditNote d={d} />
            </div>
          ))}
        </div>
      ) : (
        <div className={p.hint}>No credit notes match these filters.</div>
      )}
    </div>
  );
}
