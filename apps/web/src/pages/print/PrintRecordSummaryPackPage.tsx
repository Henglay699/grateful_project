import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useCompany } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { loadRecordSummaryPack, packFilters } from '../accounting/recordSummaryPack';
import { RecordSummary, sheetClass } from './PrintDocPage';
import { useAutoPrint } from './useAutoPrint';
import s from './print.module.css';
import p from './billingPrint.module.css';

/**
 * Record Summary → ⋯ → PDF Pack: every record summary matching the list's filters, one A4
 * page each, for one print / PDF.
 */
export function PrintRecordSummaryPackPage() {
  const [params] = useSearchParams();
  const filters = packFilters(params);
  const pack = useQuery({
    queryKey: ['record-summary-pack', filters],
    queryFn: () => loadRecordSummaryPack(filters),
  });
  const company = useCompany();
  const lookups = useLookups();
  useEffect(() => {
    const list = pack.data;
    if (!list?.length) return;
    const first = list[0]!.date;
    const last = list[list.length - 1]!.date;
    document.title = `Record Summary ${first === last ? first : `${first} – ${last}`} (${list.length})`;
  }, [pack.data]);
  const docs = pack.data ?? [];
  useAutoPrint(!!pack.data && pack.data.length > 0 && !lookups.isLoading && !company.isLoading);

  if (pack.isLoading || lookups.isLoading || company.isLoading)
    return <div className={s.page}>Loading…</div>;
  if (pack.error) return <div className={s.page}>Could not load the record summaries.</div>;
  const c = company.data ?? {};
  return (
    <div className={s.page}>
      <div className={p.toolbar}>
        <b>
          {docs.length} record summar{docs.length === 1 ? 'y' : 'ies'}
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
              {/* Drafts print plain, as from the editor; only a cancelled summary is marked. */}
              {d.status === 'VOID' && <div className={s.stamp}>CANCELLED</div>}
              <RecordSummary d={d} c={c} />
            </div>
          ))}
        </div>
      ) : (
        <div className={p.hint}>No record summaries match these filters.</div>
      )}
    </div>
  );
}
