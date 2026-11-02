import { lazy, Suspense, useState, type MouseEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  BILLING_PACK_TYPES,
  PAYMENT_METHOD_LABEL,
  type BillingClientMonth,
  type BillingDocSlot,
  type BillingPackType,
  type BillingShipmentRow,
  type BillingStatement,
  type OfficialReceipt,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useClientMonth, useIssueDrafts, useVoidReceipt } from '../../features/billing';
import { ErrorBanner, ExpandToggle, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import { icons } from '../../layout/icons';
import { MonthStepper, PackPrintMenu, StagePill } from './billingParts';
import {
  isMonth,
  monthDocDate,
  monthName,
  PACK_LABEL,
  periodCode,
  periodRange,
  STATEMENT_TITLE,
  thisMonth,
} from './billingUi';
import { DraftsModal, ReceiptModal } from './BillingDialogs';
import b from './Billing.module.css';
import { PrintLink } from '../../components/PrintLink';

// The print layouts load only when a row's preview is first opened.
const RowPreviewModal = lazy(() => import('./RowPreviewModal'));

/**
 * A click on a shipment row away from its declaration, documents and Print button: a click
 * that selected text, or came through a portal (the Print menu), doesn't count either.
 */
function opensPreview(e: MouseEvent<HTMLTableRowElement>): boolean {
  const t = e.target as HTMLElement;
  if (!e.currentTarget.contains(t)) return false;
  if (t.closest('a, button, input, [data-no-preview]')) return false;
  return !window.getSelection()?.toString();
}

/**
 * One client's month, in the order the work is done: (1) each shipment's tax invoice,
 * disbursement and debit note, (2) the two account statements, (3) payments and official
 * receipts — then print it all as one pack, like the Excel workbook.
 */
export function BillingClientPage() {
  const { clientId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const asked = params.get('month');
  const month = isMonth(asked) ? asked : thisMonth();
  const data = useClientMonth(clientId, month);
  const setMonth = (m: string) => setParams({ month: m }, { replace: true });

  if (data.error && !data.data)
    return (
      <section className="view active">
        <BackLink to={`/accounting/billing?month=${month}`} label="Client Billing" />
        <div style={{ marginTop: 12 }}>
          <ErrorBanner error={data.error} />
        </div>
      </section>
    );
  if (!data.data)
    return (
      <section className="view active">
        <div className="card">Loading…</div>
      </section>
    );
  return <Workspace m={data.data} month={month} setMonth={setMonth} />;
}

function Workspace({
  m,
  month,
  setMonth,
}: {
  m: BillingClientMonth;
  month: string;
  setMonth: (m: string) => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const canWrite = can('accounting:write');
  const issue = useIssueDrafts(m.client.id);
  const [drafting, setDrafting] = useState(false);
  const [paying, setPaying] = useState<BillingStatement | null>(null);
  const [preview, setPreview] = useState<BillingShipmentRow | null>(null);
  // The statements stay folded under their heading until opened.
  const [statementsOpen, setStatementsOpen] = useState(false);
  const s = m.summary;
  const here = `/accounting/billing/${m.client.id}?month=${month}`;
  const back = encodeURIComponent(here);
  const missingTotal = BILLING_PACK_TYPES.reduce((n, t) => n + s.missing[t], 0);

  const issueAll = async () => {
    if (
      !window.confirm(
        `Issue ${s.drafts} draft${s.drafts === 1 ? '' : 's'} for ${m.client.code} · ${monthName(month)}?\n\n` +
          'Check their lines first: once issued, their numbers and totals go into the Monthly Ledger and the number and date are fixed. Drafts with a $0.00 total are skipped.',
      )
    )
      return;
    const r = await issue.mutateAsync(month);
    toast(
      `Issued ${r.issued.length}.` +
        (r.skipped.length
          ? ` Skipped ${r.skipped.map((x) => `${x.number ?? PACK_LABEL[x.type]} (${x.reason})`).join(', ')}.`
          : ''),
    );
  };

  return (
    <section className={`view active ${b.page}`}>
      <div className={b.head}>
        <div className={backRow}>
          <BackLink
            to={`/accounting/billing?month=${month}`}
            label={`Client Billing · ${monthName(month)}`}
          />
          <div className={b.headTitle}>
            {m.client.legalName ?? m.client.name}
            <StagePill stage={s.stage} />
          </div>
        </div>
        <div className={b.headActions}>
          <MonthStepper month={month} onChange={setMonth} />
          <PackPrintMenu
            clientId={m.client.id}
            month={month}
            className={`new-shipment-btn ${b.printBtn}`}
          >
            {icons.download({})}
            Print month pack
          </PackPrintMenu>
        </div>
      </div>

      <ErrorBanner error={issue.error} />

      {/* 1 · Shipment documents */}
      <div className="card" id="documents">
        <div className={b.sectionHead}>
          <div>
            <div className={b.sectionTitle}>
              <span className={b.sectionNum}>1</span>
              <h3>Shipment documents</h3>
            </div>
          </div>
          {canWrite && (
            <div className={b.sectionActions}>
              <button
                type="button"
                className="cargo-btn"
                disabled={missingTotal === 0}
                onClick={() => setDrafting(true)}
                title={missingTotal ? undefined : 'Every shipment has its documents'}
              >
                {icons.plus({ width: 14, height: 14 })}
                Create missing drafts{missingTotal ? ` (${missingTotal})` : ''}
              </button>
              <Link
                className="cargo-btn"
                to={`/accounting/debit-notes/new?clientId=${m.client.id}&date=${monthDocDate(month)}&back=${back}`}
                title="A debit note that belongs to no shipment, e.g. a monthly MIH or payroll fee"
              >
                + Other debit note
              </Link>
              <button
                type="button"
                className="new-shipment-btn"
                disabled={s.drafts === 0 || issue.isPending}
                onClick={() => void issueAll()}
              >
                {issue.isPending ? 'Issuing…' : `Issue drafts${s.drafts ? ` (${s.drafts})` : ''}`}
              </button>
            </div>
          )}
        </div>
        <div className="plans-table-scroll" style={{ maxHeight: 'none' }}>
          <table className={`data-table-clean ${b.docTable}`}>
            <thead>
              <tr>
                <th>No</th>
                <th>Declaration</th>
                <th>Freight</th>
                <th>Quantity</th>
                <th>HBL · Container</th>
                {BILLING_PACK_TYPES.map((t) => (
                  <th key={t}>{PACK_LABEL[t]}</th>
                ))}
                <th>INV Date</th>
                <th className={b.actionCol}>Action</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r, i) => (
                <tr
                  key={r.recordId}
                  data-preview
                  data-active={preview?.recordId === r.recordId}
                  title="Click to preview this shipment's documents"
                  onClick={(e) => opensPreview(e) && setPreview(r)}
                >
                  <td>{i + 1}</td>
                  <td data-no-preview>
                    <span className={b.declare}>{r.declareNo}</span>
                    <span className={b.small}>
                      {r.direction === 'IMPORT' ? 'Import' : 'Export'} ·{' '}
                      <Link to={`/plans/${r.shipmentId}`}>{r.shipmentReference}</Link>
                    </span>
                  </td>
                  <td>{FREIGHT_LABEL[r.transportMode] ?? r.transportMode}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.quantity ? `${fmtNum(r.quantity)} ${r.quantityUnit ?? ''}`.trim() : '—'}
                  </td>
                  <td>
                    <span className={b.declare} style={{ fontWeight: 700 }}>
                      {r.hbl ?? '—'}
                    </span>
                    <span className={b.small} title={r.containers ?? undefined}>
                      {shortContainers(r.containers)}
                    </span>
                  </td>
                  {BILLING_PACK_TYPES.map((t) => (
                    <td key={t}>
                      <DocCell row={r} type={t} back={back} canWrite={canWrite} />
                    </td>
                  ))}
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.invDate)}</td>
                  <td className={b.actionCol}>
                    {/* The row's tax invoice, disbursement and debit note in one go. */}
                    {BILLING_PACK_TYPES.some((t) => r.docs[t].some((d) => d.status !== 'VOID')) && (
                      <PackPrintMenu
                        clientId={m.client.id}
                        month={month}
                        record={{ id: r.recordId, label: r.declareNo }}
                        className={b.rowDots}
                        title={`Print or export ${r.declareNo}'s tax invoice, disbursement and debit note (drafts marked DRAFT)`}
                      >
                        {icons.dots({ width: 16, height: 16 })}
                      </PackPrintMenu>
                    )}
                  </td>
                </tr>
              ))}
              {m.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className={ui.empty}>
                    No shipments in the Monthly Ledger for {monthName(month)}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {m.others.length > 0 && (
          <>
            <div className={b.subhead}>Not tied to a shipment</div>
            <table className={`data-table-clean ${b.docTable}`}>
              <tbody>
                {m.others.map((d) => (
                  <tr key={d.id}>
                    <td style={{ width: 110, whiteSpace: 'nowrap' }}>{fmtDate(d.date)}</td>
                    <td>
                      <span className={b.declare}>{PACK_LABEL[d.type]}</span>
                      <span className={b.small}>{d.reference || '—'}</span>
                    </td>
                    <td>
                      <DocChip d={d} back={back} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* 2 · Statements, 3 · payments */}
      <div className="card" id="statements">
        {/* The whole header opens and closes the section; the chevron button keeps keyboard use. */}
        <div
          className={`${b.sectionHead} ${b.clickableHead}`}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('button')) setStatementsOpen((o) => !o);
          }}
        >
          <div>
            <div className={b.sectionTitle}>
              <span className={b.sectionNum}>2</span>
              <h3>Account statements &amp; payments</h3>
            </div>
          </div>
          <ExpandToggle
            open={statementsOpen}
            onToggle={() => setStatementsOpen((o) => !o)}
            label="the statements and payments"
          />
        </div>
        {statementsOpen && (
          <div className={b.statements}>
            {(['INVOICE', 'DEBIT_NOTE'] as const).map((k) => (
              <StatementPanel
                key={k}
                st={m.statements[k]}
                month={month}
                clientId={m.client.id}
                canWrite={canWrite}
                onPay={() => setPaying(m.statements[k])}
              />
            ))}
          </div>
        )}
      </div>

      {drafting && (
        <DraftsModal
          clientId={m.client.id}
          clientCode={m.client.code}
          month={month}
          missing={s.missing}
          onClose={() => setDrafting(false)}
        />
      )}
      {preview && (
        <Suspense fallback={null}>
          <RowPreviewModal
            clientId={m.client.id}
            month={month}
            row={preview}
            back={back}
            onClose={() => setPreview(null)}
          />
        </Suspense>
      )}
      {paying && (
        <ReceiptModal
          clientId={m.client.id}
          clientName={m.client.legalName ?? m.client.name}
          month={month}
          statement={paying}
          onClose={() => setPaying(null)}
        />
      )}
    </section>
  );
}

/** "MAEU4417941, MAEU7075009, MRKU8475691" → "MAEU4417941 +2" (the full list on hover). */
function shortContainers(list: string | null): string {
  if (!list) return 'No container';
  const all = list.split(', ');
  return all.length > 1 ? `${all[0]} +${all.length - 1}` : list;
}

const FREIGHT_LABEL: Record<string, string> = {
  SEA: 'SEA',
  AIR: 'AIR',
  ROAD: 'TRUCK',
  RAIL: 'RAIL',
};

/** A document: number · amount · ✓ when issued; a draft is just yellow. Opens the editor. */
function DocChip({ d, back }: { d: BillingDocSlot; back: string }) {
  const draft = d.status === 'DRAFT';
  const label = `${PACK_LABEL[d.type]} ${d.number ?? ''}, ${fmtMoney(d.total)}, ${draft ? 'draft (not issued yet)' : 'issued'}`;
  return (
    <Link
      to={`/accounting/${d.type}/${d.id}?back=${back}`}
      className={b.chip}
      data-status={d.status}
      title={label}
      aria-label={label}
    >
      <b>{d.number ?? 'Draft'}</b>
      <span>{fmtMoney(d.total)}</span>
      {!draft && <em>✓</em>}
    </Link>
  );
}

/** A shipment's documents of one type: issued / draft chips, the ledger's typed number, or +. */
function DocCell({
  row,
  type,
  back,
  canWrite,
}: {
  row: BillingShipmentRow;
  type: BillingPackType;
  back: string;
  canWrite: boolean;
}) {
  const docs = row.docs[type];
  const manual = row.manual[type];
  const create = `/accounting/${type}/new?recordId=${row.recordId}&back=${back}`;
  if (docs.length)
    return (
      <div className={b.cellStack}>
        {docs.map((d) => (
          <DocChip key={d.id} d={d} back={back} />
        ))}
      </div>
    );
  if (manual) {
    const chip = (
      <>
        <b>{manual.number}</b>
        <span>{fmtMoney(manual.total)}</span>
        <em>Ledger</em>
      </>
    );
    const tip = 'Typed in the Monthly Ledger: made outside the system. It counts on the statement.';
    return canWrite ? (
      <Link
        to={create}
        className={b.chip}
        data-status="MANUAL"
        title={`${tip} Click to create it here.`}
      >
        {chip}
      </Link>
    ) : (
      <span className={b.chip} data-status="MANUAL" title={tip}>
        {chip}
      </span>
    );
  }
  return canWrite ? (
    <Link to={create} className={b.addChip}>
      + Create
    </Link>
  ) : (
    <span className={b.none}>—</span>
  );
}

function StatementPanel({
  st,
  month,
  clientId,
  canWrite,
  onPay,
}: {
  st: BillingStatement;
  month: string;
  clientId: string;
  canWrite: boolean;
  onPay: () => void;
}) {
  const toast = useToast();
  const voidReceipt = useVoidReceipt();
  const inv = st.kind === 'INVOICE';
  const due = Number(st.balance);
  const total = Number(st.total);
  const doVoid = async (r: OfficialReceipt) => {
    const reason = window.prompt(
      `Cancel receipt ${r.receiptNo} (${fmtMoney(r.amount)})? It keeps its number, and the amount becomes due again.\n\nReason (kept in the audit log):`,
    );
    if (!reason) return;
    await voidReceipt.mutateAsync({ id: r.id, reason });
    toast(`Receipt ${r.receiptNo} cancelled.`);
  };
  return (
    <div className={b.statement}>
      <div className={b.stHead}>
        <div>
          <div className={b.stTitle}>{STATEMENT_TITLE[st.kind]}</div>
          <div className={b.stRange}>Account statement · {periodRange(month)}</div>
        </div>
        <PrintLink
          className="filter-btn"
          href={`/print/billing/${clientId}?month=${month}&parts=st-${st.kind}`}
        >
          Print
        </PrintLink>
      </div>
      {st.lines.length ? (
        <div className={b.stScroll}>
          <table className={b.stTable}>
            <thead>
              <tr>
                <th>No</th>
                <th>Date</th>
                {inv ? (
                  <>
                    <th>INV No</th>
                    <th>DIS No</th>
                  </>
                ) : (
                  <th>DN No</th>
                )}
                <th>Ref</th>
                <th className={b.statusCol}>Status</th>
                <th className={b.num}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l, i) => (
                <tr key={`${l.invNo}-${l.disNo}-${l.dnNo}-${i}`}>
                  <td>{i + 1}</td>
                  <td>{fmtDate(l.date)}</td>
                  {inv ? (
                    <>
                      <td>
                        <b>{l.invNo ?? '—'}</b>
                      </td>
                      <td>{l.disNo ?? '—'}</td>
                    </>
                  ) : (
                    <td>
                      <b>{l.dnNo}</b>
                    </td>
                  )}
                  <td>
                    {l.ref ?? '—'}
                    {l.manual && (
                      <span className={b.ledgerTag} title="Number typed in the Monthly Ledger">
                        ledger
                      </span>
                    )}
                  </td>
                  <td className={b.statusCol}>
                    {l.draft && (
                      <span className={b.draftTag} title="Not issued yet">
                        draft
                      </span>
                    )}
                  </td>
                  <td className={b.num}>
                    <b>{fmtMoney(l.amount)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={b.stEmpty}>No {inv ? 'invoices or disbursements' : 'debit notes'} yet.</div>
      )}
      <div className={b.stTotal}>
        <span>BALANCE AS {periodCode(month)}</span>
        <span>{fmtMoney(st.total)}</span>
      </div>
      <div className={b.payments}>
        <span className={b.payLabel}>Payments</span>
        {st.receipts.length === 0 && <span className={b.payRow}>No payment recorded yet.</span>}
        {st.receipts.map((r) => (
          <div key={r.id} className={b.payRow} data-void={r.status === 'VOID'}>
            <b>{r.receiptNo}</b>
            <span className={b.payDesc}>
              {fmtDate(r.receiptDate)} · {PAYMENT_METHOD_LABEL[r.paymentMethod]}
              {r.paymentRef ? ` · ${r.paymentRef}` : ''}
              {r.status === 'VOID' ? ' · cancelled' : ''}
            </span>
            <span className={b.payAmount}>{fmtMoney(r.amount)}</span>
            {r.status !== 'VOID' && (
              <>
                <PrintLink className={b.linkBtn} href={`/print/receipts/${r.id}`}>
                  Print
                </PrintLink>
                {canWrite && (
                  <button
                    type="button"
                    className={b.linkBtn}
                    data-danger="true"
                    onClick={() => void doVoid(r)}
                  >
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        <div className={b.balance}>
          <span>Balance due</span>
          <span className={due > 0 ? b.due : total > 0 ? b.settled : undefined}>
            {total > 0 && due <= 0 ? `Paid · ${fmtMoney(st.balance)}` : fmtMoney(st.balance)}
          </span>
        </div>
        {due > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {canWrite && (
              <button type="button" className="btn-create-submit" onClick={onPay}>
                Record payment
              </button>
            )}
            <PrintLink
              className="filter-btn"
              href={`/print/billing/${clientId}?month=${month}&parts=rc-${st.kind}`}
              title="A receipt for the balance due, to print before the client pays (number, method and signature filled in by hand)"
            >
              Print receipt
            </PrintLink>
          </div>
        )}
      </div>
    </div>
  );
}
