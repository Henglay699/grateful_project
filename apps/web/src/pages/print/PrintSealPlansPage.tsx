import { Fragment, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLookups, useSealPlans } from '../../features/hooks';
import { fmtDate } from '../../lib/format';
import { fmtTare, groupByMonth, monthHeading, MONTHS } from '../sealplans/sealPlanFormat';
import { useAutoPrint } from './useAutoPrint';
import s from './sealPlansPrint.module.css';

const dash = (v: string | null) => v || '-';
const title = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();

/** Seal Plans → ⋯ → Export PDF: the filtered schedule on A4 landscape, laid out like the sheet. */
export function PrintSealPlansPage() {
  const [params] = useSearchParams();
  const year = Number(params.get('year')) || new Date().getFullYear();
  const month = params.get('month') ?? '';
  const clientId = params.get('clientId') ?? '';
  const list = useSealPlans({
    year,
    month: month || undefined,
    clientId: clientId || undefined,
    q: params.get('q') || undefined,
  });
  const lookups = useLookups();
  const rows = list.data ?? [];
  const groups = groupByMonth(rows);
  const factory = lookups.data?.clients.find((c) => c.id === clientId)?.name;

  // "July – September 2026", from the months actually listed.
  const first = groups[0]?.month;
  const last = groups[groups.length - 1]?.month;
  const name = (ym: string) => title(MONTHS[Number(ym.slice(5, 7)) - 1]!);
  const period = month
    ? `${title(MONTHS[Number(month) - 1]!)} ${year}`
    : first && last && first !== last
      ? `${name(first)} – ${name(last)} ${year}`
      : first
        ? `${name(first)} ${year}`
        : String(year);

  useEffect(() => {
    document.title = `Seal Plan ${period}${factory ? ` ${factory}` : ''}`;
  }, [period, factory]);
  useAutoPrint(!!list.data && !lookups.isLoading);

  if (list.isLoading || lookups.isLoading) return <div className={s.page}>Loading…</div>;
  if (list.error) return <div className={s.page}>Could not load the seal plans.</div>;
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <b>
          {rows.length} container{rows.length === 1 ? '' : 's'}
        </b>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <div className={s.sheet}>
        <h1 className={s.title}>SEAL PLAN — CONTAINER SHIPMENT SCHEDULE</h1>
        <div className={s.period}>
          {period}
          {factory ? ` · ${factory}` : ''}
        </div>
        <table className={s.table}>
          <thead>
            <tr>
              <th>No.</th>
              <th>GS Inv No.</th>
              <th>Client</th>
              <th>Carrier</th>
              <th>SO No.</th>
              <th>Port</th>
              <th>Destination</th>
              <th>Container No.</th>
              <th>Size</th>
              <th>Carrier Seal</th>
              <th>Customs Seal</th>
              <th>Vessel</th>
              <th>Tare Weight</th>
              <th>ETD</th>
              <th>Truck By</th>
              <th>Driver Phone</th>
              <th>Truck No.</th>
              <th>Deliver To</th>
              <th>Date</th>
              <th>Depot</th>
              <th>Other</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={21} className={s.empty}>
                  No seal plans match these filters.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.month}>
                <tr className={s.month}>
                  <td colSpan={21}>{monthHeading(g.month)}</td>
                </tr>
                {g.rows.map((r, i) => (
                  <tr key={r.id ?? `${r.shipmentId}:${r.containerNo}`}>
                    <td>{i + 1}</td>
                    <td>{r.invNo ?? 'TBA'}</td>
                    <td>{r.clientName}</td>
                    <td>{dash(r.carrier)}</td>
                    <td>{dash(r.bookingNo)}</td>
                    <td>{dash(r.portName)}</td>
                    <td>{r.destination ?? dash(r.destinationCountry)}</td>
                    <td className={s.strong}>{r.containerNo}</td>
                    <td>{dash(r.size)}</td>
                    <td>{dash(r.linerSeal)}</td>
                    <td>{dash(r.customsSeal)}</td>
                    <td>{dash(r.vesselName)}</td>
                    <td className={s.num}>{fmtTare(r.tareWeightKg)}</td>
                    <td>{fmtDate(r.etd)}</td>
                    <td>{dash(r.truckBy)}</td>
                    <td>{dash(r.driverPhone)}</td>
                    <td>{dash(r.truckNo)}</td>
                    <td>{dash(r.deliverTo)}</td>
                    <td>{fmtDate(r.loadingDate)}</td>
                    <td>{dash(r.depot)}</td>
                    <td>{dash(r.other)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
