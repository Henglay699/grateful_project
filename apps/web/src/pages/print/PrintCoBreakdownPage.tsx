import { useEffect, useState } from 'react';
import { BreakdownSheet } from '../co/BreakdownSheet';
import { readPrintedBreakdown } from '../co/breakdownPrint';
import { useAutoPrint } from './useAutoPrint';
import s from './capacityPrint.module.css';

/**
 * CO → Breakdown → Print: the GSP breakdown on A4 portrait, left in this tab's session
 * storage by the page that opens this one.
 */
export function PrintCoBreakdownPage() {
  const [m] = useState(readPrintedBreakdown);
  useEffect(() => {
    if (m) document.title = `Breakdown ${m.invoiceNo}`;
  }, [m]);
  useAutoPrint(!!m);

  if (!m) return <div className={s.page}>Open CO → Breakdown and choose the invoice first.</div>;
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <b>Breakdown · {m.invoiceNo}</b>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <BreakdownSheet m={m} />
    </div>
  );
}
