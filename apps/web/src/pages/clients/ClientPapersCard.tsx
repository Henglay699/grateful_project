import { useState } from 'react';
import {
  AUTHORIZATION_KINDS,
  AUTHORIZATION_KIND_LABEL,
  daysUntil,
  type AuthorizationKind,
  type ClientAuthorizationRow,
  type ClientDetail,
  type ClientSignatoryRow,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useAuthorizations,
  useDeleteAuthorization,
  useDeleteSignatory,
  useSaveAuthorization,
  useSaveSignatory,
  useSignatories,
} from '../../features/workflow';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Glyph } from '../../components/workflow/glyphs';
import { fmtDate } from '../../lib/format';
import w from '../../components/workflow/Workflow.module.css';
import p from './ClientPapersCard.module.css';

const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

function Expiry({ date }: { date: string | null }) {
  if (!date) return <span className="status-tag neutral">No expiry</span>;
  const left = daysUntil(date, today())!;
  const tone = left < 0 ? 'exception' : left <= 30 ? 'pending' : 'completed';
  return (
    <span className={`status-tag ${tone}`} title={`Valid until ${fmtDate(date)}`}>
      {left < 0
        ? `Expired ${fmtDate(date)}`
        : left <= 30
          ? `${left} days left`
          : `Until ${fmtDate(date)}`}
    </span>
  );
}

/**
 * Customs papers: the CDC master list's validity, who signs the client's letters, and the
 * standing documents it has given us (authorization letters, broker ID, patent…), with expiry.
 * The import letters read the default signatory from here.
 */
export function ClientPapersCard({ client }: { client: ClientDetail }) {
  const { can } = useAuth();
  const write = can('clients:write');
  const signatories = useSignatories(client.id);
  const auths = useAuthorizations(client.id);
  const delSig = useDeleteSignatory(client.id);
  const delAuth = useDeleteAuthorization(client.id);
  const [sig, setSig] = useState<ClientSignatoryRow | 'new' | null>(null);
  const [auth, setAuth] = useState<ClientAuthorizationRow | 'new' | null>(null);

  return (
    <div className="card">
      <div className="card-header-row">
        <div>
          <h3>Customs papers</h3>
          <div className="create-header-desc" style={{ marginTop: 4 }}>
            Licence, signatory and standing letters used for this client's customs work. Expiring
            papers show in Alerts 30 days ahead.
          </div>
        </div>
      </div>
      <div className={p.grid}>
        <section className={p.block}>
          <h4>CDC master list</h4>
          {client.cdcNo || client.cdcValidUntil ? (
            <dl className={p.facts}>
              <dt>Number</dt>
              <dd>{client.cdcNo ?? '—'}</dd>
              <dt>Issued</dt>
              <dd>{fmtDate(client.cdcIssueDate)}</dd>
              <dt>Extension</dt>
              <dd>
                {client.cdcExtensionLetterNo ?? '—'}
                {client.cdcCustomsNoteDate ? ` · note ${fmtDate(client.cdcCustomsNoteDate)}` : ''}
              </dd>
              <dt>Validity</dt>
              <dd>
                <Expiry date={client.cdcValidUntil} />
              </dd>
            </dl>
          ) : (
            <p className={w.nothing}>No CDC licence recorded. Edit the client to add it.</p>
          )}
        </section>

        <section className={p.block}>
          <div className={p.blockHead}>
            <h4>Signatory</h4>
            {write && (
              <button type="button" className={w.addBtn} onClick={() => setSig('new')}>
                <Glyph name="plus" size={14} /> Add
              </button>
            )}
          </div>
          <ErrorBanner error={signatories.error ?? delSig.error} />
          {signatories.data?.length === 0 && (
            <p className={w.nothing}>
              Nobody yet. The permit package needs the owner of the goods who signs the letters.
            </p>
          )}
          <ul className={w.rows}>
            {signatories.data?.map((s) => (
              <li key={s.id} className={w.row}>
                <div className={w.rowMain}>
                  <b>
                    {s.name}
                    {s.isDefault && (
                      <span className="status-tag completed" style={{ marginLeft: 8 }}>
                        Signs letters
                      </span>
                    )}
                  </b>
                  <small>
                    {[s.title, s.passportNo && `ID ${s.passportNo}`].filter(Boolean).join(' · ') ||
                      '—'}
                  </small>
                </div>
                {write && (
                  <span className={w.rowBtns}>
                    <button type="button" aria-label="Edit signatory" onClick={() => setSig(s)}>
                      <Glyph name="edit" size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete signatory"
                      onClick={() =>
                        window.confirm(`Remove ${s.name}?`) && void delSig.mutateAsync(s.id)
                      }
                    >
                      <Glyph name="trash" size={14} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className={`${p.block} ${p.wide}`}>
          <div className={p.blockHead}>
            <h4>Standing papers</h4>
            {write && (
              <button type="button" className={w.addBtn} onClick={() => setAuth('new')}>
                <Glyph name="plus" size={14} /> Add
              </button>
            )}
          </div>
          <ErrorBanner error={auths.error ?? delAuth.error} />
          {auths.data?.length === 0 && (
            <p className={w.nothing}>
              Add the authorization letter, broker ID and patent so their expiry is tracked.
            </p>
          )}
          <ul className={w.rows}>
            {auths.data?.map((a) => (
              <li key={a.id} className={w.row}>
                <div className={w.rowMain}>
                  <b>{AUTHORIZATION_KIND_LABEL[a.kind]}</b>
                  <small>
                    {[a.reference, a.issuedOn && `issued ${fmtDate(a.issuedOn)}`, a.notes]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </small>
                </div>
                <Expiry date={a.validUntil} />
                {write && (
                  <span className={w.rowBtns}>
                    <button type="button" aria-label="Edit paper" onClick={() => setAuth(a)}>
                      <Glyph name="edit" size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete paper"
                      onClick={() =>
                        window.confirm(`Delete ${AUTHORIZATION_KIND_LABEL[a.kind]}?`) &&
                        void delAuth.mutateAsync(a.id)
                      }
                    >
                      <Glyph name="trash" size={14} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      {sig && (
        <SignatoryDialog
          clientId={client.id}
          row={sig === 'new' ? null : sig}
          onClose={() => setSig(null)}
        />
      )}
      {auth && (
        <AuthorizationDialog
          clientId={client.id}
          row={auth === 'new' ? null : auth}
          onClose={() => setAuth(null)}
        />
      )}
    </div>
  );
}

function Input({
  id,
  label,
  value,
  onChange,
  type = 'text',
  span = 1,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  span?: number;
  placeholder?: string;
}) {
  return (
    <div className="form-field-group" style={{ gridColumn: `span ${span}` }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="form-field-box"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SignatoryDialog({
  clientId,
  row,
  onClose,
}: {
  clientId: string;
  row: ClientSignatoryRow | null;
  onClose: () => void;
}) {
  const save = useSaveSignatory(clientId);
  const toast = useToast();
  const [v, setV] = useState({
    name: row?.name ?? '',
    passportNo: row?.passportNo ?? '',
    title: row?.title ?? '',
    titleKm: row?.titleKm ?? '',
    isDefault: row?.isDefault ?? false,
  });
  return (
    <Modal
      title={row ? 'Edit signatory' : 'Add signatory'}
      sub="The owner of the goods who signs the cover letter and the transfer of rights."
      onClose={onClose}
      width={560}
    >
      <div className={w.formGrid}>
        <Input
          id="sg-name"
          label="Name"
          value={v.name}
          onChange={(x) => setV({ ...v, name: x })}
          span={2}
          placeholder="LIN LEE BI JEN"
        />
        <Input
          id="sg-pp"
          label="ID / passport no."
          value={v.passportNo}
          onChange={(x) => setV({ ...v, passportNo: x })}
        />
        <Input
          id="sg-title"
          label="Title"
          value={v.title}
          onChange={(x) => setV({ ...v, title: x })}
          placeholder="GENERAL MANAGER"
        />
        <Input
          id="sg-km"
          label="Title in Khmer"
          value={v.titleKm}
          onChange={(x) => setV({ ...v, titleKm: x })}
          span={2}
        />
        <label
          className="form-field-group"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <input
            type="checkbox"
            checked={v.isDefault}
            onChange={(e) => setV({ ...v, isDefault: e.target.checked })}
          />
          Signs the letters
        </label>
      </div>
      <ErrorBanner error={save.error} />
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={v.name.trim().length < 2 || save.isPending}
          onClick={() =>
            void save.mutateAsync({ id: row?.id, body: v }).then(() => {
              toast('Signatory saved.');
              onClose();
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function AuthorizationDialog({
  clientId,
  row,
  onClose,
}: {
  clientId: string;
  row: ClientAuthorizationRow | null;
  onClose: () => void;
}) {
  const save = useSaveAuthorization(clientId);
  const toast = useToast();
  const [v, setV] = useState({
    kind: (row?.kind ?? 'AUTHORIZATION_LETTER') as AuthorizationKind,
    reference: row?.reference ?? '',
    issuedOn: row?.issuedOn ?? '',
    validUntil: row?.validUntil ?? '',
    notes: row?.notes ?? '',
  });
  return (
    <Modal title={row ? 'Edit paper' : 'Add paper'} onClose={onClose} width={560}>
      <div className={w.formGrid}>
        <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="au-kind">Kind</label>
          <select
            id="au-kind"
            className="form-select-box"
            value={v.kind}
            onChange={(e) => setV({ ...v, kind: e.target.value as AuthorizationKind })}
          >
            {AUTHORIZATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {AUTHORIZATION_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <Input
          id="au-ref"
          label="Reference"
          value={v.reference}
          onChange={(x) => setV({ ...v, reference: x })}
          span={2}
        />
        <Input
          id="au-iss"
          label="Issued on"
          type="date"
          value={v.issuedOn}
          onChange={(x) => setV({ ...v, issuedOn: x })}
        />
        <Input
          id="au-until"
          label="Valid until"
          type="date"
          value={v.validUntil}
          onChange={(x) => setV({ ...v, validUntil: x })}
        />
        <Input
          id="au-notes"
          label="Notes"
          value={v.notes}
          onChange={(x) => setV({ ...v, notes: x })}
          span={2}
          placeholder="e.g. sign & stamp 2 sets"
        />
      </div>
      <ErrorBanner error={save.error} />
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={save.isPending}
          onClick={() =>
            void save.mutateAsync({ id: row?.id, body: v }).then(() => {
              toast('Saved.');
              onClose();
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
