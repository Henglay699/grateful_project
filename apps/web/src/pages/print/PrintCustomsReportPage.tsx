import { useEffect, useState } from 'react';
import { CustomsSheet } from '../reports/CustomsSheet';
import { readPrintedCustoms } from '../reports/customsPrint';
import { useAutoPrint } from './useAutoPrint';
import './printFonts'; // Moul / Siemreap for the Khmer headings
import s from './capacityPrint.module.css';

/**
 * Reports → Import & Export → Print: the report on A4 portrait, left in this tab's session
 * storage by the page that opens this one.
 */
export function PrintCustomsReportPage() {
  const [m] = useState(readPrintedCustoms);
  useEffect(() => {
    if (m) document.title = m.fileName.replace(/_/g, ' ');
  }, [m]);
  useAutoPrint(!!m);

  if (!m)
    return (
      <div className={s.page}>Open Reports → Import &amp; Export and build the report first.</div>
    );
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <b>
          {m.direction === 'IMPORT' ? 'Import' : 'Export'} report · {m.from}
          {m.from === m.to ? '' : ` to ${m.to}`}
        </b>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <CustomsSheet m={m} />
    </div>
  );
}
