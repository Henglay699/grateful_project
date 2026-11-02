import { useEffect, useState } from 'react';
import { CapacitySheet } from '../reports/CapacitySheet';
import { readPrintedCapacity } from '../reports/capacityPrint';
import { useAutoPrint } from './useAutoPrint';
import './printFonts'; // Moul / Siemreap for the Khmer headings and body
import s from './capacityPrint.module.css';

/**
 * Reports → Payroll → Capacity report → Print: the report on A4 portrait. The payroll is only
 * in the browser, so the page that opens this one leaves the finished report in this tab's
 * session storage first.
 */
export function PrintCapacityReportPage() {
  const [m] = useState(readPrintedCapacity);
  useEffect(() => {
    if (m) document.title = `Capacity Report ${m.month} ${m.profile.companyName}`.trim();
  }, [m]);
  useAutoPrint(!!m);

  if (!m)
    return (
      <div className={s.page}>
        Open Reports → Payroll, import the payroll and open the Capacity report first.
      </div>
    );
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <b>Capacity report · {m.month}</b>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <CapacitySheet m={m} />
    </div>
  );
}
