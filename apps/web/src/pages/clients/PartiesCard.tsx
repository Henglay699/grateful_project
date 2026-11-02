import { useState } from 'react';
import type { ClientDetail } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useAddClientConsignee,
  useDeleteConsignee,
  useDeleteSupplier,
  useSaveSupplier,
  useSetConsigneeAddress,
} from '../../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import s from './PartiesCard.module.css';

type Party =
  | { kind: 'supplier'; id: string | null; name: string; address: string | null }
  | { kind: 'consignee'; id: string; name: string; address: string | null };

/** Tiles shown before "Show all"; the search box appears past this many too. */
const PREVIEW = 12;

/**
 * Client Details: the client's Suppliers (import shippers) and Consignees, each a full-width
 * card of address tiles that wrap instead of scrolling; the INV + PL letterhead prints them
 * (Shipping Plans → Export INV + PL).
 */
export function PartiesCard({ client }: { client: ClientDetail }) {
  const { can } = useAuth();
  const editable = can('clients:write');
  /** A row, or the kind a "+ Add" creates. */
  const [open, setOpen] = useState<Party | Party['kind'] | null>(null);
  const toast = useToast();
  const delSupplier = useDeleteSupplier(client.id);
  const delConsignee = useDeleteConsignee(client.id);

  const remove = async (p: Party) => {
    const msg =
      p.kind === 'supplier'
        ? `Delete supplier ${p.name}? Its address is cleared and it leaves this list; shipments keep their Shipper Name. "+ Add" brings it back.`
        : `Delete consignee ${p.name}? It leaves this list and the consignee dropdowns; shipments that name it keep it.`;
    if (!window.confirm(msg)) return;
    if (p.kind === 'supplier') await delSupplier.mutateAsync(p.name);
    else await delConsignee.mutateAsync(p.id);
    toast(`${p.kind === 'supplier' ? 'Supplier' : 'Consignee'} deleted.`);
  };

  return (
    <>
      <PartyList
        title="Suppliers"
        sub="Shippers on this client's imports"
        rows={client.suppliers.map((x) => ({ kind: 'supplier' as const, ...x }))}
        empty="No suppliers yet. Shipper names on imports appear here."
        editable={editable}
        deleting={delSupplier.isPending}
        error={delSupplier.error}
        onAdd={() => setOpen('supplier')}
        onOpen={setOpen}
        onDelete={(p) => void remove(p)}
      />
      <PartyList
        title="Consignees"
        sub="Receivers on this client's exports"
        rows={client.consignees.map((x) => ({ kind: 'consignee' as const, ...x }))}
        empty="None linked to this client."
        editable={editable}
        deleting={delConsignee.isPending}
        error={delConsignee.error}
        onAdd={() => setOpen('consignee')}
        onOpen={setOpen}
        onDelete={(p) => void remove(p)}
      />
      {open && (
        <AddressModal
          clientId={client.id}
          party={typeof open === 'string' ? null : open}
          kind={typeof open === 'string' ? open : open.kind}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function PartyList({
  title,
  sub,
  rows,
  empty,
  editable,
  deleting,
  error,
  onAdd,
  onOpen,
  onDelete,
}: {
  title: string;
  sub: string;
  rows: Party[];
  empty: string;
  editable: boolean;
  deleting: boolean;
  error: unknown;
  onAdd: () => void;
  onOpen: (p: Party) => void;
  onDelete: (p: Party) => void;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? rows.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.address ?? '').toLowerCase().includes(needle),
      )
    : rows;
  const shown = all || needle ? matches : matches.slice(0, PREVIEW);
  const missing = rows.filter((p) => !p.address).length;

  return (
    <div className="card">
      <ErrorBanner error={error} />
      <div className={s.head}>
        <div className={s.titleBlock}>
          <h3>
            {title} <span className={s.count}>{rows.length}</span>
          </h3>
          <span className={s.sub}>
            {sub}
            {missing > 0 && <span className={s.missing}> · {missing} without address</span>}
          </span>
        </div>
        <div className={s.tools}>
          {rows.length > PREVIEW && (
            <SearchBox
              className={s.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              aria-label={`Search ${title.toLowerCase()}`}
            />
          )}
          {editable && (
            <button type="button" className="filter-btn" onClick={onAdd}>
              + Add
            </button>
          )}
        </div>
      </div>
      {rows.length === 0 && <span className={s.muted}>{empty}</span>}
      {rows.length > 0 && matches.length === 0 && (
        <span className={s.muted}>No {title.toLowerCase()} match "{q.trim()}".</span>
      )}
      <div className={s.grid}>
        {shown.map((p) => (
          <div key={`${p.kind}:${p.id ?? p.name}`} className={s.tile}>
            <button
              type="button"
              className={s.item}
              disabled={!editable}
              onClick={() => onOpen(p)}
              title={editable ? 'Set the address' : undefined}
            >
              <b>{p.name}</b>
              {p.address ? (
                <span className={s.address}>{p.address}</span>
              ) : (
                <span className={s.noAddress}>No address</span>
              )}
            </button>
            {editable && (
              <button
                type="button"
                className={s.delete}
                onClick={() => onDelete(p)}
                disabled={deleting}
                aria-label={`Delete ${p.name}`}
                title="Delete"
              >
                {icons.trash({ width: 14, height: 14 })}
              </button>
            )}
          </div>
        ))}
      </div>
      {!needle && matches.length > PREVIEW && (
        <button type="button" className={s.more} onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all ${matches.length}`}
        </button>
      )}
    </div>
  );
}

/** Set a supplier's or consignee's address; a new one also takes its name. */
function AddressModal({
  clientId,
  party,
  kind,
  onClose,
}: {
  clientId: string;
  /** null: a new one, of `kind`. */
  party: Party | null;
  kind: Party['kind'];
  onClose: () => void;
}) {
  const toast = useToast();
  const saveSupplier = useSaveSupplier(clientId);
  const setConsignee = useSetConsigneeAddress(clientId);
  const addConsignee = useAddClientConsignee(clientId);
  const [name, setName] = useState(party?.name ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [nameError, setNameError] = useState<string>();
  const supplier = kind === 'supplier';
  const label = supplier ? 'supplier' : 'consignee';
  const pending = saveSupplier.isPending || setConsignee.isPending || addConsignee.isPending;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!party && !name.trim()) return setNameError(`Enter the ${label} name`);
    if (supplier) await saveSupplier.mutateAsync({ name, address });
    else if (party?.kind === 'consignee')
      await setConsignee.mutateAsync({ id: party.id, body: { address } });
    else await addConsignee.mutateAsync({ name, address });
    toast(party ? 'Address saved.' : `${supplier ? 'Supplier' : 'Consignee'} added.`);
    onClose();
  };
  return (
    <Modal
      title={party ? party.name : `Add ${label}`}
      sub={
        supplier
          ? 'Printed under the supplier name on the import Invoice + Packing List letterhead.'
          : 'Printed under the consignee on the export Invoice + Packing List.'
      }
      onClose={onClose}
      width={560}
    >
      <ErrorBanner error={saveSupplier.error ?? setConsignee.error ?? addConsignee.error} />
      <form onSubmit={(e) => void save(e)} noValidate>
        <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr' }}>
          {!party && (
            <div className="form-field-group">
              <label htmlFor="party-name">{supplier ? 'Supplier name' : 'Consignee name'}</label>
              <input
                id="party-name"
                className="form-field-box"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(undefined);
                }}
                placeholder={
                  supplier ? 'As typed in Shipper Name on the shipment' : 'e.g. TJX AU PTY LIMITED'
                }
                aria-invalid={!!nameError}
              />
              <FieldError message={nameError} />
            </div>
          )}
          <div className="form-field-group">
            <label htmlFor="party-address">Address</label>
            <textarea
              id="party-address"
              className="form-field-box"
              rows={4}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={'Street, building\nCity, country'}
            />
          </div>
        </div>
        <div className={ui.actions}>
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={pending}>
            {pending ? 'Saving…' : party ? 'Save' : `Add ${label}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
