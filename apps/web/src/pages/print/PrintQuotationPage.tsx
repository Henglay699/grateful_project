import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuotation } from '../../features/admin';
import { useCompany } from '../../features/accounting';
import { fmtDate } from '../../lib/format';
import s from './print.module.css';
import { useAutoPrint } from './useAutoPrint';

export function PrintQuotationPage() {
  const { id = '' } = useParams();
  const q = useQuotation(id);
  const company = useCompany();
  useEffect(() => {
    if (q.data) document.title = `${q.data.quoteNo} v${q.data.version} — Quotation`;
  }, [q.data]);
  useAutoPrint(!!q.data && !company.isLoading);
  if (q.isLoading || company.isLoading) return <div className={s.page}>Loading…</div>;
  if (!q.data) return <div className={s.page}>Quotation not found.</div>;
  const d = q.data;
  const c = company.data ?? {};
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <div className={s.sheet}>
        {d.status === 'DRAFT' && <div className={s.stamp}>DRAFT</div>}
        <div className={s.head}>
          <img src="/logo.png" alt="" className={s.logo} />
          <div className={s.company}>
            <div className={s.companyEn}>{c.nameEn}</div>
            <div className={s.companyMeta}>{c.addressEn}</div>
            <div className={s.companyMeta}>
              Tel: {c.phone} · VATTIN {c.vattin}
            </div>
          </div>
        </div>
        <div className={s.title}>
          <div className={s.titleEn}>{d.docTitle}</div>
        </div>
        <div className={s.grid2}>
          <dl className={s.kv}>
            <dt>To:</dt>
            <dd>
              <b>{d.toName}</b>
            </dd>
            <dt>Attn:</dt>
            <dd>{d.attn ?? '-'}</dd>
          </dl>
          <dl className={s.kv}>
            <dt>Quotation No:</dt>
            <dd>
              <b>
                {d.quoteNo}
                {d.version > 1 ? ` (rev. ${d.version})` : ''}
              </b>
            </dd>
            <dt>Date:</dt>
            <dd>{fmtDate(d.quoteDate)}</dd>
          </dl>
        </div>
        <table className={s.table}>
          <thead>
            <tr>
              <th>No</th>
              {d.columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((r, i) => (
              <tr key={i}>
                <td className={s.center}>{i + 1}</td>
                {d.columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.type === 'num' ? s.num : undefined}
                    style={col.type === 'remark' ? { fontSize: 9 } : undefined}
                  >
                    {r[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {d.notes && (
          <div className={s.note} style={{ whiteSpace: 'pre-wrap' }}>
            <b>Notes:</b>
            <br />
            {d.notes}
          </div>
        )}
        {(d.paymentTermDays !== null || d.latePenaltyPctPerDay) && (
          <div className={s.note}>
            {d.paymentTermDays !== null && (
              <>Payment term: {d.paymentTermDays} days after invoice. </>
            )}
            {d.latePenaltyPctPerDay && (
              <>Late payment: {Number(d.latePenaltyPctPerDay)}% per day.</>
            )}
          </div>
        )}
        <div className={s.signs}>
          <div>
            Prepared by
            <br />
            {c.nameEn}
          </div>
          <div>
            Accepted by
            <br />
            {d.toName}
          </div>
        </div>
      </div>
    </div>
  );
}
