import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import { useAuth } from '../../auth/AuthProvider';
import { useClient, useDeleteClient, useLookups, useSaveClient } from '../../features/hooks';
import { Pill } from '../../components/StatusPill';
import { ErrorBanner, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
import { CLIENT_STATUS_PILL } from '../ClientsPage';
import { ClientFormModal } from './ClientFormModal';
import { PartiesCard } from './PartiesCard';
import { RemarksCard } from './RemarksCard';
import { ClientPapersCard } from './ClientPapersCard';
import s from './ClientDetailPage.module.css';

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useClient(id);
  const lookups = useLookups();
  const save = useSaveClient();
  const del = useDeleteClient();
  const [editing, setEditing] = useState(false);
  const c = client.data;

  if (client.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading client…</div>
      </section>
    );
  if (client.error || !c)
    return (
      <section className="view active">
        <ErrorBanner error={client.error} />
        <BackLink to="/clients" label="Back to clients" />
      </section>
    );

  const toggleActive = async () => {
    const next = c.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    if (
      next === 'INACTIVE' &&
      !window.confirm(
        `Deactivate ${c.name}? Existing shipments stay; new shipments can't be created for this client.`,
      )
    )
      return;
    await save.mutateAsync({ id: c.id, body: { status: next } });
    await client.refetch();
    toast(next === 'INACTIVE' ? 'Client deactivated.' : 'Client reactivated.');
  };
  const remove = async () => {
    if (
      !window.confirm(
        `Delete ${c.name}? This only works for clients without shipments or cut-stock items.`,
      )
    )
      return;
    await del.mutateAsync(c.id);
    toast('Client deleted.');
    navigate('/clients');
  };

  const country =
    lookups.data?.countries.find((x) => x.iso2 === c.countryIso2)?.name ?? c.countryIso2;
  return (
    <section className="view active">
      <div className={s.head}>
        <div className={backRow}>
          <BackLink to="/clients" label="Clients" />
          <div className={s.title}>{c.name}</div>
          <div className={s.sub}>
            {c.code} · {country} ·{' '}
            <Pill tone={CLIENT_STATUS_PILL[c.status].tone}>
              {CLIENT_STATUS_PILL[c.status].label}
            </Pill>
          </div>
          {/* Where to go from here: the client's shipments and CDC master list. */}
          <div className={s.quickLinks}>
            <Link to={`/plans?clientId=${c.id}`} className={s.quickLink}>
              {icons.plans({ width: 14, height: 14 })}
              Shipping Plans
            </Link>
            {c.cutStockItems ? (
              <Link to={`/cutstock?clientId=${c.id}`} className={s.quickLink}>
                {icons.cutstock({ width: 14, height: 14 })}
                CDC master list <span className={s.quickCount}>{c.cutStockItems}</span>
              </Link>
            ) : (
              <span
                className={`${s.quickLink} ${s.quickLinkOff}`}
                title="Import one from the Cut Stock page"
              >
                {icons.cutstock({ width: 14, height: 14 })}
                No CDC master list
              </span>
            )}
          </div>
        </div>
        {can('clients:write') && (
          <div className={ui.toolbar}>
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={() => void toggleActive()}
              disabled={save.isPending}
            >
              {c.status === 'INACTIVE' ? 'Reactivate' : 'Deactivate'}
            </button>
            {c.shipmentCount === 0 && c.cutStockItems === 0 && (
              <button
                type="button"
                className={ui.dangerBtn}
                onClick={() => void remove()}
                disabled={del.isPending}
              >
                Delete
              </button>
            )}
            <button type="button" className="new-shipment-btn" onClick={() => setEditing(true)}>
              Edit client
            </button>
          </div>
        )}
      </div>
      <ErrorBanner error={save.error ?? del.error} />

      {/* One strip; Imports and Exports open the client's shipments in Shipping Plans. */}
      <div className={s.stats}>
        <div className={s.stat} title="In progress or pending">
          <div className={s.statLabel}>Active shipments</div>
          <div className={s.statValue}>{c.activeShipments}</div>
        </div>
        <Link to={`/plans?clientId=${c.id}&direction=IMPORT`} className={`${s.stat} ${s.statLink}`}>
          <div className={s.statLabel}>Imports →</div>
          <div className={s.statValue}>{c.importCount}</div>
        </Link>
        <Link to={`/plans?clientId=${c.id}&direction=EXPORT`} className={`${s.stat} ${s.statLink}`}>
          <div className={s.statLabel}>Exports →</div>
          <div className={s.statValue}>{c.exportCount}</div>
        </Link>
        {c.netProfitYtd !== undefined ? (
          <div className={s.stat}>
            <div className={s.statLabel}>Net profit this year</div>
            <div className={s.statValue}>{fmtMoney(c.netProfitYtd)}</div>
          </div>
        ) : (
          <div className={s.stat}>
            <div className={s.statLabel}>Total shipments</div>
            <div className={s.statValue}>{c.shipmentCount}</div>
          </div>
        )}
      </div>

      <div className={s.layout}>
        <div className={s.column}>
          <div className="card">
            <div className="card-header-row">
              <h3>Details</h3>
            </div>
            <dl className={s.facts}>
              <dt>Legal name</dt>
              <dd>{c.legalName ?? '-'}</dd>
              {c.legalNameKm && (
                <>
                  <dt>Khmer name</dt>
                  <dd>{c.legalNameKm}</dd>
                </>
              )}
              <dt>VATTIN</dt>
              <dd>{c.vattin ?? '-'}</dd>
              <dt>Address</dt>
              <dd>{c.address ?? '-'}</dd>
              {c.addressKm && (
                <>
                  <dt>Khmer address</dt>
                  <dd>{c.addressKm}</dd>
                </>
              )}
              <dt>Contact</dt>
              <dd>
                {[c.contactName, c.contactEmail, c.contactPhone].filter(Boolean).join(' · ') || '-'}
              </dd>
              <dt>Commission (CM)</dt>
              <dd>{fmtMoney(c.commissionUsd)} per declaration</dd>
              <dt>Client since</dt>
              <dd>{fmtDate(c.createdAt)}</dd>
            </dl>
          </div>
        </div>
        <div className={s.column}>
          <RemarksCard clientId={c.id} />
        </div>
      </div>

      <div className={s.parties}>
        <ClientPapersCard client={c} />
      </div>

      <div className={s.parties}>
        <PartiesCard client={c} />
      </div>
      {editing && (
        <ClientFormModal
          client={c}
          onClose={() => {
            setEditing(false);
            void client.refetch();
          }}
        />
      )}
    </section>
  );
}
