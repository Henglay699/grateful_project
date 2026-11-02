import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  OWNER_LABEL,
  OWNER_PERMISSION,
  stageLabel,
  type DocumentCategory,
  type RequirementStatus,
  type ShipmentWorkflow,
  type StageDef,
  type WorkflowIssue,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useAdvanceStage, useSendBack, useWorkflow } from '../../features/workflow';
import { downloadFile } from '../../lib/files';
import { fmtDate, fmtMoney } from '../../lib/format';
import { DocumentUploadModal } from '../DocumentUpload';
import { ErrorBanner, Modal, ui } from '../ui';
import { useToast } from '../Toast';
import { FiguresCard, PermitsCard, VendorInvoicesCard, WCard } from './WorkflowCards';
import { Glyph, ownerTone } from './glyphs';
import w from './Workflow.module.css';

/** Where each check is fixed: a field on the shipment form, or a card of this panel. */
const FIX: Record<string, { field?: string; card?: string; label: string }> = {
  HAS_CARGO_LINES: { field: 'invoices', label: 'Add cargo lines' },
  HAS_HBL_NO: { field: 'hblNo', label: 'Enter HBL no.' },
  HAS_BOOKING_NO: { field: 'bookingNo', label: 'Enter booking no.' },
  HAS_ETA: { field: 'eta', label: 'Enter ETA' },
  HAS_DO_DATE: { field: 'doDate', label: 'Enter DO date' },
  HAS_ARRIVE_FTY: { field: 'arriveFty', label: 'Enter arrival date' },
  HAS_ATD: { field: 'atd', label: 'Enter ATD' },
  DECLARED: { field: 'declarations', label: 'Add declaration' },
  CO_DONE: { field: 'coStatus', label: 'Update CO' },
  HAS_BOOKED_FIGURES: { card: 'wf-figures', label: 'Enter booking' },
  HAS_MEASURED: { card: 'wf-figures', label: 'Enter measured' },
  VALID_PERMIT: { card: 'wf-permits', label: 'Record permit' },
  VENDOR_INVOICES: { card: 'wf-vendor', label: 'Add invoice' },
  VENDOR_INVOICES_PAID: { card: 'wf-vendor', label: 'Mark paid' },
  NO_BLOCKING_ISSUES: { card: 'wf-issues', label: 'See issues' },
};

const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

/**
 * The job workflow of one shipment: where it is, who has it, what is still missing before it
 * can move on, the cross-check findings, and the records each stage needs (permits, vendor
 * invoices, booked / measured figures) — with the actions for the signed-in user's role.
 */
export function WorkflowPanel({
  shipmentId,
  clientId,
  onGoToField,
}: {
  shipmentId: string;
  clientId: string;
  /** Opens the shipment form on the tab that holds this field. */
  onGoToField: (field: string) => void;
}) {
  const q = useWorkflow(shipmentId);
  if (q.isLoading)
    return (
      <div className={w.loading} aria-busy="true">
        <div className={w.skeletonBar} />
        <div className={w.skeletonGrid}>
          <div className={w.skeletonCard} />
          <div className={w.skeletonCard} />
        </div>
      </div>
    );
  if (q.error || !q.data) return <ErrorBanner error={q.error} />;
  return <Panel wf={q.data} clientId={clientId} onGoToField={onGoToField} />;
}

function Panel({
  wf,
  clientId,
  onGoToField,
}: {
  wf: ShipmentWorkflow;
  clientId: string;
  onGoToField: (field: string) => void;
}) {
  const closed = wf.stage === 'CLOSED';
  const current = wf.stages[wf.stageIndex];
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory | null>(null);
  const errors = wf.issues.filter((i) => i.severity === 'ERROR').length;

  return (
    <div className={w.panel}>
      <Stepper wf={wf} />

      <div className={w.layout}>
        <div className={w.main}>
          {closed ? (
            <ClosedCard wf={wf} />
          ) : (
            <StageCard
              wf={wf}
              stage={current!}
              onUpload={setUploadCategory}
              onGoToField={onGoToField}
            />
          )}
          <IssuesCard issues={wf.issues} errors={errors} onGoToField={onGoToField} />
          <HistoryCard wf={wf} />
        </div>
        <aside className={w.side}>
          {wf.margin && <MarginCard wf={wf} />}
          {wf.direction === 'EXPORT' && <FiguresCard wf={wf} />}
          {(wf.direction === 'IMPORT' || wf.permits.length > 0) && <PermitsCard wf={wf} />}
          <VendorInvoicesCard wf={wf} />
          <GeneratedDocsCard wf={wf} />
        </aside>
      </div>

      {uploadCategory && (
        <DocumentUploadModal
          shipmentId={wf.shipmentId}
          clientId={clientId}
          defaultCategory={uploadCategory}
          maxMb={10}
          onClose={() => setUploadCategory(null)}
        />
      )}
    </div>
  );
}

/* ---------- The stage track ---------- */

function Stepper({ wf }: { wf: ShipmentWorkflow }) {
  const list = useRef<HTMLOListElement>(null);
  // On narrow screens the track scrolls: bring the current stage into view.
  useEffect(() => {
    const el = list.current;
    const cur = el?.querySelector<HTMLElement>('[data-state="current"]');
    if (el && cur && el.scrollWidth > el.clientWidth)
      el.scrollLeft = cur.offsetLeft - el.clientWidth / 2 + cur.offsetWidth / 2;
  }, [wf.stage]);
  const total = wf.stages.length;
  const done = Math.min(wf.stageIndex, total);
  const pct = Math.round((done / total) * 100);
  return (
    <div className={w.track} aria-label="Workflow stages">
      <div className={w.trackHead}>
        <div>
          <span className={w.eyebrow}>
            {wf.direction === 'IMPORT' ? 'Import job' : 'Export job'}
          </span>
          <h3 className={w.trackTitle}>
            {wf.stage === 'CLOSED' ? 'Job closed' : `Step ${wf.stageIndex + 1} of ${total}`}
            <span className={w.trackStage}>
              {wf.stage === 'CLOSED' ? '' : ` · ${stageLabel(wf.direction, wf.stage)}`}
            </span>
          </h3>
        </div>
        <div className={w.progress} title={`${pct}% of the stages done`}>
          <div className={w.progressBar}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <b>{pct}%</b>
        </div>
      </div>
      <ol className={w.steps} ref={list}>
        {wf.stages.map((s) => {
          const state =
            s.index < wf.stageIndex ? 'done' : s.index === wf.stageIndex ? 'current' : 'todo';
          return (
            <li
              key={s.key}
              className={w.step}
              data-state={state}
              title={`${s.label} — ${OWNER_LABEL[s.owner]}`}
            >
              <span className={w.dot} data-tone={ownerTone(s.owner)}>
                {state === 'done' ? <Glyph name="check" /> : s.index + 1}
              </span>
              <span className={w.stepLabel}>{s.label}</span>
              <span className={w.stepOwner}>{OWNER_LABEL[s.owner]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------- The current stage: what's needed and the actions ---------- */

function StageCard({
  wf,
  stage,
  onUpload,
  onGoToField,
}: {
  wf: ShipmentWorkflow;
  stage: StageDef & { index: number };
  onUpload: (c: DocumentCategory) => void;
  onGoToField: (field: string) => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const adv = useAdvanceStage(wf.shipmentId);
  const [dialog, setDialog] = useState<'override' | 'back' | null>(null);
  const next = wf.stages[wf.stageIndex + 1];
  const met = wf.requirements.filter((r) => r.met).length;
  const days = wf.stageChangedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(wf.stageChangedAt)) / 86_400_000))
    : null;
  const mine = can(OWNER_PERMISSION[stage.owner]);

  const complete = () =>
    void adv
      .mutateAsync({ from: wf.stage })
      .then((r) =>
        toast(
          r.stage === 'CLOSED'
            ? 'Job closed.'
            : `${stage.approval ? 'Approved' : 'Done'} — now at ${stageLabel(r.direction, r.stage)}.`,
        ),
      );

  const primaryLabel = wf.can.financeApprove
    ? 'Approve low margin & close'
    : stage.key === 'CLOSING'
      ? 'Close job'
      : stage.approval
        ? `Approve → ${next?.label ?? 'Close'}`
        : `Complete → ${next?.label ?? 'Close'}`;

  return (
    <section
      className={`cx-card ${w.stageCard}`}
      data-mine={mine || undefined}
      aria-labelledby="wf-stage"
    >
      <header className={w.stageHead}>
        <div>
          <div className={w.stageMeta}>
            <span className={w.ownerChip} data-tone={ownerTone(stage.owner)}>
              {OWNER_LABEL[stage.owner]}
            </span>
            {stage.approval && <span className={w.approvalChip}>Approval</span>}
            {days !== null && (
              <span className={w.age} data-late={days > 5 || undefined}>
                {days === 0 ? 'Since today' : `${days} day${days === 1 ? '' : 's'} in this stage`}
              </span>
            )}
          </div>
          <h3 id="wf-stage" className={w.stageTitle}>
            {stage.label}
          </h3>
          <p className={w.hint}>{stage.hint}</p>
        </div>
        {wf.requirements.length > 0 && (
          <div className={w.ring} title={`${met} of ${wf.requirements.length} done`}>
            <Ring value={met / wf.requirements.length} />
            <span>
              {met}/{wf.requirements.length}
            </span>
          </div>
        )}
      </header>

      {wf.requirements.length > 0 ? (
        <ul className={w.reqs}>
          {wf.requirements.map((r) => (
            <Requirement
              key={r.key}
              r={r}
              onUpload={onUpload}
              onGoToField={onGoToField}
              canUpload={can('documents:write')}
            />
          ))}
        </ul>
      ) : (
        <p className={w.nothing}>Nothing to check here — complete it when the work is done.</p>
      )}

      {wf.needsCeoApproval && (
        <div className={w.ceoNote} role="note">
          <Glyph name="alert" /> Margin is below {Math.round(0.1 * 100)}% of revenue
          {wf.margin ? ` (${fmtMoney(wf.margin.netProfit)} on ${fmtMoney(wf.margin.revenue)})` : ''}
          . The CEO approves closing this job.
        </div>
      )}

      <ErrorBanner error={adv.error} />
      <footer className={w.actions}>
        <button
          type="button"
          className="btn-create-submit"
          disabled={!wf.can.advance || adv.isPending}
          onClick={complete}
          title={wf.blockedReason ?? undefined}
        >
          {adv.isPending ? 'Saving…' : primaryLabel}
        </button>
        {wf.can.override && (
          <button type="button" className={w.secondaryBtn} onClick={() => setDialog('override')}>
            Move on anyway…
          </button>
        )}
        {wf.can.sendBack && (
          <button type="button" className={w.ghostBtn} onClick={() => setDialog('back')}>
            Send back…
          </button>
        )}
        {!wf.can.advance && wf.blockedReason && (
          <span className={w.blocked}>
            <Glyph name="lock" /> {wf.blockedReason}
          </span>
        )}
      </footer>

      {dialog === 'override' && (
        <OverrideDialog wf={wf} stage={stage} onClose={() => setDialog(null)} />
      )}
      {dialog === 'back' && <SendBackDialog wf={wf} onClose={() => setDialog(null)} />}
    </section>
  );
}

function Requirement({
  r,
  onUpload,
  onGoToField,
  canUpload,
}: {
  r: RequirementStatus;
  onUpload: (c: DocumentCategory) => void;
  onGoToField: (field: string) => void;
  canUpload: boolean;
}) {
  const fix = FIX[r.key];
  return (
    <li className={w.req} data-met={r.met}>
      <span className={w.reqIcon}>
        {r.met ? <Glyph name="check" /> : <span className={w.reqDot} />}
      </span>
      <span className={w.reqText}>
        {r.label}
        {r.detail && <small>{r.detail}</small>}
      </span>
      {!r.met && r.kind === 'DOCUMENT' && r.category && canUpload && (
        <button type="button" className={w.reqBtn} onClick={() => onUpload(r.category!)}>
          <Glyph name="upload" /> Upload
        </button>
      )}
      {!r.met && r.kind === 'CHECK' && fix && (
        <button
          type="button"
          className={w.reqBtn}
          onClick={() => (fix.field ? onGoToField(fix.field) : scrollTo(fix.card!))}
        >
          {fix.label} →
        </button>
      )}
      {!r.met && r.key === 'LEDGER_ENTRY' && (
        <Link className={w.reqBtn} to="/accounting">
          Open ledger →
        </Link>
      )}
    </li>
  );
}

function Ring({ value }: { value: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r={r} className={w.ringTrack} />
      <circle
        cx="20"
        cy="20"
        r={r}
        className={w.ringValue}
        strokeDasharray={`${c * value} ${c}`}
        transform="rotate(-90 20 20)"
      />
    </svg>
  );
}

function OverrideDialog({
  wf,
  stage,
  onClose,
}: {
  wf: ShipmentWorkflow;
  stage: StageDef;
  onClose: () => void;
}) {
  const adv = useAdvanceStage(wf.shipmentId);
  const toast = useToast();
  const [reason, setReason] = useState('');
  const unmet = wf.requirements.filter((r) => !r.met);
  return (
    <Modal
      title={`Move on from "${stage.label}"`}
      sub="Some requirements are not met. Your reason is kept in the stage history."
      onClose={onClose}
      width={520}
    >
      <ul className={w.unmetList}>
        {unmet.map((r) => (
          <li key={r.key}>{r.label}</li>
        ))}
      </ul>
      <div className="form-field-group">
        <label htmlFor="wf-reason">Reason</label>
        <textarea
          id="wf-reason"
          className="form-field-box"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Original HBL arrives with the vessel; customer confirmed by email"
        />
      </div>
      <ErrorBanner error={adv.error} />
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={reason.trim().length < 5 || adv.isPending}
          onClick={() =>
            void adv.mutateAsync({ from: wf.stage, overrideReason: reason.trim() }).then(() => {
              toast('Moved on. The reason is in the history.');
              onClose();
            })
          }
        >
          {adv.isPending ? 'Saving…' : 'Move on'}
        </button>
      </div>
    </Modal>
  );
}

function SendBackDialog({ wf, onClose }: { wf: ShipmentWorkflow; onClose: () => void }) {
  const back = useSendBack(wf.shipmentId);
  const toast = useToast();
  const earlier = wf.stages.filter((s) => s.index < wf.stageIndex);
  const [to, setTo] = useState(earlier[earlier.length - 1]?.key ?? '');
  const [note, setNote] = useState('');
  return (
    <Modal
      title="Send back"
      sub="The stage's owner sees your note in the workflow and the history."
      onClose={onClose}
      width={520}
    >
      <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="form-field-group">
          <label htmlFor="wf-to">Back to</label>
          <select
            id="wf-to"
            className="form-select-box"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {earlier.map((s) => (
              <option key={s.key} value={s.key}>
                {s.index + 1}. {s.label} — {OWNER_LABEL[s.owner]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field-group">
          <label htmlFor="wf-note">What needs fixing</label>
          <textarea
            id="wf-note"
            className="form-field-box"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Invoice quantity doesn't match the packing list (797 vs 795 rolls)"
          />
        </div>
      </div>
      <ErrorBanner error={back.error} />
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={note.trim().length < 3 || !to || back.isPending}
          onClick={() =>
            void back.mutateAsync({ from: wf.stage, to, note: note.trim() }).then(() => {
              toast('Sent back.');
              onClose();
            })
          }
        >
          {back.isPending ? 'Sending…' : 'Send back'}
        </button>
      </div>
    </Modal>
  );
}

function ClosedCard({ wf }: { wf: ShipmentWorkflow }) {
  const last = wf.history[0];
  const [back, setBack] = useState(false);
  return (
    <section className={`cx-card ${w.closedCard}`}>
      <span className={w.closedIcon}>
        <Glyph name="check" />
      </span>
      <div>
        <h3 className={w.stageTitle}>Job closed</h3>
        <p className={w.hint}>
          {last
            ? `Closed by ${last.userName ?? 'someone'} on ${fmtDate(last.createdAt)}.`
            : 'Every stage of this job is done.'}
        </p>
      </div>
      {wf.can.sendBack && (
        <button type="button" className={w.ghostBtn} onClick={() => setBack(true)}>
          Reopen…
        </button>
      )}
      {back && <SendBackDialog wf={wf} onClose={() => setBack(false)} />}
    </section>
  );
}

/* ---------- Cross-checks ---------- */

const SEVERITY_LABEL = { ERROR: 'Blocking', WARNING: 'Check', INFO: 'Note' } as const;

function IssuesCard({
  issues,
  errors,
  onGoToField,
}: {
  issues: WorkflowIssue[];
  errors: number;
  onGoToField: (field: string) => void;
}) {
  return (
    <WCard
      id="wf-issues"
      title="Cross-checks"
      sub={
        issues.length
          ? `${issues.length} finding${issues.length > 1 ? 's' : ''}${errors ? ` · ${errors} blocking` : ''}`
          : 'Invoice, packing list, B/L, permit, CDC and vendor bills agree.'
      }
      icon="shield"
    >
      {issues.length === 0 ? (
        <div className={w.allGood}>
          <Glyph name="check" /> No mismatches found
        </div>
      ) : (
        <ul className={w.issues}>
          {issues.map((i, k) => (
            <li key={`${i.code}-${k}`} className={w.issue} data-severity={i.severity}>
              <span className={w.issueTag}>{SEVERITY_LABEL[i.severity]}</span>
              <span className={w.issueText}>{i.message}</span>
              {i.fix && (
                <button
                  type="button"
                  className={w.issueFix}
                  onClick={() => fixIssue(i.fix!, onGoToField)}
                >
                  {i.fix} →
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </WCard>
  );
}

function fixIssue(fix: string, onGoToField: (field: string) => void) {
  if (fix.startsWith('Workflow → Booked')) return scrollTo('wf-figures');
  if (fix === 'Customs permit') return scrollTo('wf-permits');
  if (fix === 'Vendor invoices') return scrollTo('wf-vendor');
  if (fix.startsWith('Origin')) return onGoToField('atd');
  if (fix === 'Documents') return onGoToField('__documents');
  if (fix.startsWith('Settings')) return void (window.location.href = '/settings/broker');
  if (fix.startsWith('Client')) return onGoToField('__client');
  return undefined;
}

/* ---------- History ---------- */

const ACTION_LABEL = {
  ADVANCE: 'completed',
  APPROVE: 'approved',
  OVERRIDE: 'moved on without',
  RETURN: 'sent back',
} as const;

function HistoryCard({ wf }: { wf: ShipmentWorkflow }) {
  const [all, setAll] = useState(false);
  const rows = all ? wf.history : wf.history.slice(0, 5);
  return (
    <WCard title="History" sub="Every move between stages, newest first." icon="history">
      {wf.history.length === 0 ? (
        <p className={w.nothing}>No moves yet.</p>
      ) : (
        <ol className={w.timeline}>
          {rows.map((h) => (
            <li key={h.id} data-action={h.action}>
              <span className={w.tlDot} />
              <div>
                <div className={w.tlHead}>
                  <b>{h.userName ?? 'Someone'}</b>{' '}
                  {h.action === 'RETURN' ? (
                    <>
                      sent it back to <b>{stageLabel(wf.direction, h.toStage)}</b>
                    </>
                  ) : h.action === 'OVERRIDE' ? (
                    <>
                      moved on from <b>{stageLabel(wf.direction, h.fromStage)}</b> with requirements
                      open
                    </>
                  ) : (
                    <>
                      {ACTION_LABEL[h.action]} <b>{stageLabel(wf.direction, h.fromStage)}</b>
                    </>
                  )}
                  <time>
                    {new Date(h.createdAt).toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </time>
                </div>
                {(h.note || h.overrideReason) && (
                  <p className={w.tlNote}>{h.overrideReason ?? h.note}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {wf.history.length > 5 && (
        <button type="button" className={w.linkBtn} onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show all ${wf.history.length}`}
        </button>
      )}
    </WCard>
  );
}

/* ---------- Side cards ---------- */

function MarginCard({ wf }: { wf: ShipmentWorkflow }) {
  const m = wf.margin!;
  return (
    <WCard title="Job margin" sub="From the ledger rows of this shipment." icon="money">
      <div className={w.margin} data-low={m.low || undefined}>
        <div>
          <span>Net profit</span>
          <b>{fmtMoney(m.netProfit)}</b>
        </div>
        <div>
          <span>Margin</span>
          <b>{m.ratio === null ? '—' : `${(m.ratio * 100).toFixed(1)}%`}</b>
        </div>
        <div>
          <span>Revenue</span>
          <b>{fmtMoney(m.revenue)}</b>
        </div>
        <div>
          <span>Cost</span>
          <b>{fmtMoney(m.cost)}</b>
        </div>
      </div>
      {m.low && <p className={w.lowNote}>Low margin — closing needs CEO approval.</p>}
    </WCard>
  );
}

function GeneratedDocsCard({ wf }: { wf: ShipmentWorkflow }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const docs = useMemo(
    () =>
      wf.direction === 'EXPORT'
        ? [
            {
              key: 'BOOKING_FORM',
              label: 'Booking form',
              path: `/workflow/shipments/${wf.shipmentId}/docs/BOOKING_FORM.xlsx`,
            },
            {
              key: 'WAREHOUSE_CHECKLIST',
              label: 'Warehouse checklist',
              path: `/workflow/shipments/${wf.shipmentId}/docs/WAREHOUSE_CHECKLIST.xlsx`,
            },
            {
              key: 'CARGO_DO',
              label: 'Cargo delivery order',
              path: `/workflow/shipments/${wf.shipmentId}/docs/CARGO_DO.xlsx`,
            },
            {
              key: 'INV',
              label: 'Invoice + packing list',
              path: `/shipments/${wf.shipmentId}/invoice-packing-list.xlsx`,
            },
          ]
        : [
            {
              key: 'INV',
              label: 'Permit package (INV/PL, cover letter, authorization)',
              path: `/shipments/${wf.shipmentId}/invoice-packing-list.xlsx`,
            },
          ],
    [wf.direction, wf.shipmentId],
  );
  return (
    <WCard
      title="Generate documents"
      sub="Filled in from this shipment, ready to print."
      icon="download"
    >
      <div className={w.docBtns}>
        {docs.map((d) => (
          <button
            key={d.key}
            type="button"
            className={w.docBtn}
            disabled={busy === d.key}
            onClick={() => {
              setBusy(d.key);
              downloadFile(d.path)
                .catch(() => toast('Could not build the file. Add the cargo invoice lines first.'))
                .finally(() => setBusy(null));
            }}
          >
            <Glyph name="file" />
            <span>{d.label}</span>
            <small>{busy === d.key ? 'Building…' : '.xlsx'}</small>
          </button>
        ))}
      </div>
    </WCard>
  );
}
