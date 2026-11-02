import { useState } from 'react';
import type { BrokerAgentInput, BrokerAgentRow } from '@gs/shared';
import { daysUntil } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useBrokerAgents, useSaveBrokerAgent } from '../../features/workflow';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate } from '../../lib/format';
import w from '../../components/workflow/Workflow.module.css';

const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/**
 * Settings → Customs broker: our broker company and its licensed agent, as printed on the
 * clients' authorization letters. The default one is used by the import letters; the agent's
 * card expiry raises an alert two months ahead.
 */
export function BrokerSettings() {
  const { can } = useAuth();
  const manage = can('customs:write');
  const list = useBrokerAgents();
  const [editing, setEditing] = useState<BrokerAgentRow | 'new' | null>(null);
  return (
    <div className="card">
      <div className="card-header-row">
        <div>
          <h3>Customs broker</h3>
          <div className="create-header-desc" style={{ marginTop: 4 }}>
            Printed on the authorization (transfer of rights) letters. The default entry is used
            when generating the import permit package.
          </div>
        </div>
        {manage && (
          <button type="button" className="new-shipment-btn" onClick={() => setEditing('new')}>
            + Add broker
          </button>
        )}
      </div>
      <ErrorBanner error={list.error} />
      <div className="plans-table-scroll">
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Company</th>
              <th>Grantee</th>
              <th>Customs agent</th>
              <th>Card</th>
              <th>Card expiry</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.map((b) => {
              const left = daysUntil(b.cardExpiry, today());
              return (
                <tr key={b.id} style={{ opacity: b.isActive ? 1 : 0.5 }}>
                  <td className="val-bold">
                    {b.company}
                    {b.isDefault && (
                      <span className="status-tag completed" style={{ marginLeft: 8 }}>
                        Default
                      </span>
                    )}
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      VAT {b.companyVattin ?? '—'}
                    </div>
                  </td>
                  <td>
                    {b.granteeName}
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      ID {b.granteeIdNo ?? '—'} · {b.granteePhone ?? '—'}
                    </div>
                  </td>
                  <td>
                    {b.agentName}
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      ID {b.agentIdNo ?? '—'} · {b.agentPhone ?? '—'}
                    </div>
                  </td>
                  <td>{b.cardNo ?? '—'}</td>
                  <td>
                    {b.cardExpiry ? (
                      <span
                        className={`status-tag ${left! < 0 ? 'exception' : left! <= 60 ? 'pending' : 'completed'}`}
                      >
                        {fmtDate(b.cardExpiry)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {manage && (
                      <button type="button" className={w.addBtn} onClick={() => setEditing(b)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={6} className={ui.empty}>
                  No broker yet. The letters use the built-in details until one is added.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <BrokerDialog
          broker={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BrokerDialog({ broker, onClose }: { broker: BrokerAgentRow | null; onClose: () => void }) {
  const save = useSaveBrokerAgent();
  const toast = useToast();
  const [v, setV] = useState({
    company: broker?.company ?? '',
    companyVattin: broker?.companyVattin ?? '',
    granteeName: broker?.granteeName ?? '',
    granteeIdNo: broker?.granteeIdNo ?? '',
    granteePhone: broker?.granteePhone ?? '',
    agentName: broker?.agentName ?? '',
    agentIdNo: broker?.agentIdNo ?? '',
    agentPhone: broker?.agentPhone ?? '',
    cardNo: broker?.cardNo ?? '',
    cardExpiry: broker?.cardExpiry ?? '',
    isDefault: broker?.isDefault ?? false,
    isActive: broker?.isActive ?? true,
  });
  const text = (k: keyof typeof v, label: string, type = 'text', span = 1) => (
    <div className="form-field-group" style={{ gridColumn: `span ${span}` }}>
      <label htmlFor={`bk-${k}`}>{label}</label>
      <input
        id={`bk-${k}`}
        className="form-field-box"
        type={type}
        value={v[k] as string}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
      />
    </div>
  );
  return (
    <Modal
      title={broker ? 'Edit customs broker' : 'Add customs broker'}
      onClose={onClose}
      width={640}
    >
      <div className={w.formGrid}>
        {text('company', 'Company', 'text', 2)}
        {text('companyVattin', 'Company VAT TIN')}
        {text('cardNo', 'Agent card no.')}
        {text('granteeName', 'Grantee (head of company)')}
        {text('granteeIdNo', 'Grantee ID no.')}
        {text('granteePhone', 'Grantee phone')}
        {text('agentName', 'Customs agent')}
        {text('agentIdNo', 'Agent ID no.')}
        {text('agentPhone', 'Agent phone')}
        {text('cardExpiry', 'Card expiry', 'date')}
        <label
          className="form-field-group"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <input
            type="checkbox"
            checked={v.isDefault}
            onChange={(e) => setV({ ...v, isDefault: e.target.checked })}
          />
          Default for letters
        </label>
        <label
          className="form-field-group"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <input
            type="checkbox"
            checked={v.isActive}
            onChange={(e) => setV({ ...v, isActive: e.target.checked })}
          />
          Active
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
          disabled={
            save.isPending || !v.company.trim() || !v.granteeName.trim() || !v.agentName.trim()
          }
          onClick={() =>
            void save.mutateAsync({ id: broker?.id, body: v as BrokerAgentInput }).then(() => {
              toast('Broker saved.');
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
