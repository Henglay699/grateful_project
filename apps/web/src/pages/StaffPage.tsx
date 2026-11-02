import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import {
  CLIENT_SCOPE_AREAS,
  PERMISSIONS,
  ROLE_CODES,
  ROLE_LABEL,
  STAFF_STATUSES,
  staffInputSchema,
  staffUpdateSchema,
  type ClientScopeArea,
  type ClientScopes,
  type Permission,
  type RoleCode,
  type StaffMember,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useRoles, useStaff } from '../features/admin';
import { useLookups } from '../features/hooks';
import { ErrorBanner, FieldError, Modal, TableState, ui } from '../components/ui';
import { Pill } from '../components/StatusPill';
import { Avatar } from '../components/Avatar';
import { SearchBox } from '../components/SearchBox';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { formResolver } from '../lib/zodForm';
import st from './StaffPage.module.css';

const STATUS = {
  ACTIVE: { tone: 'completed', label: 'Active' },
  ON_LEAVE: { tone: 'pending', label: 'On leave' },
  INACTIVE: { tone: 'exception', label: 'Inactive' },
} as const;
const PERM_GROUPS = [...new Set(PERMISSIONS.map((p) => p.split(':')[0]!))];
/** Plain names for the permission areas and actions shown in the staff form. */
const AREAS: Record<string, { label: string; desc: string }> = {
  dashboard: { label: 'Dashboard', desc: 'Overview and Analytics' },
  shipments: { label: 'Shipments', desc: 'Shipping Plans and shipment forms' },
  sealplans: { label: 'Seal Plans', desc: 'Container seals, trucking and depot' },
  clients: { label: 'Clients', desc: 'Client list and details' },
  cutstock: { label: 'CDC Master List', desc: 'Licensed items and balances' },
  accounting: { label: 'Accounting', desc: 'Ledger, invoices and notes' },
  creditnotes: { label: 'Credit Noted', desc: 'Customs broker credit notes' },
  recordsummaries: { label: 'Record Summary', desc: 'Shipment record summaries' },
  quotations: { label: 'Quotations', desc: 'Quotation builder' },
  reports: { label: 'Reports', desc: 'Payroll, MIH and Import & Export' },
  documents: { label: 'Documents', desc: 'Uploaded files' },
  followups: { label: 'Follow-ups', desc: 'Tasks and reminders' },
  staff: { label: 'Staff', desc: 'Team members and roles' },
  settings: { label: 'Settings', desc: 'Ports, rates and lists' },
  audit: { label: 'Audit log', desc: 'History of every change' },
  customs: { label: 'Customs', desc: 'Permits, declarations, clearance and CO' },
  workflow: { label: 'Workflow approvals', desc: 'Approve document packages and close jobs' },
  finance: { label: 'Finance approvals', desc: 'Approve low-margin jobs (CEO)' },
};
const ACTIONS: Record<string, string> = {
  read: 'View',
  write: 'Edit',
  delete: 'Delete',
  manage: 'Manage',
  override: 'Override balance',
  approve: 'Approve',
};
const svg = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
const ICONS = {
  user: svg('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'),
  clients: svg('M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1'),
  shield: svg('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4'),
  check: svg('m5 12 5 5L20 7'),
};

export function StaffPage() {
  const { can, user } = useAuth();
  const staff = useStaff();
  // Picked from the Staff Management dropdown in the sidebar: /staff/members or /staff/roles.
  const tab = useParams().tab === 'roles' ? 'roles' : 'members';
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const manage = can('staff:manage');
  const lookups = useLookups();
  const clientCode = new Map(lookups.data?.clients.map((c) => [c.id, c.code]));
  // Filters run on the loaded list (the whole team is one small request).
  const [filter, setFilter] = useState({ q: '', role: '', client: '', status: '' });
  const q = filter.q.trim().toLowerCase();
  const shown = (staff.data ?? []).filter((m) => {
    const status = m.isActive ? m.status : 'INACTIVE';
    if (q && !`${m.fullName} ${m.email}`.toLowerCase().includes(q)) return false;
    if (filter.role && m.role !== filter.role) return false;
    if (filter.status && status !== filter.status) return false;
    if (filter.client === 'ALL' && m.clientIds) return false;
    if (filter.client && filter.client !== 'ALL' && !m.clientIds?.includes(filter.client))
      return false;
    return true;
  });
  return (
    <section className="view active">
      {tab === 'members' ? (
        <div className="card">
          <div className="card-header-row">
            <h3>Staff &amp; Role Management</h3>
            <div className={ui.toolbar}>
              <SearchBox
                placeholder="Search name or email…"
                value={filter.q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
                aria-label="Search staff"
              />
              <select
                className={ui.input}
                value={filter.role}
                onChange={(e) => setFilter({ ...filter, role: e.target.value })}
                aria-label="Role"
              >
                <option value="">All roles</option>
                {ROLE_CODES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <select
                className={ui.input}
                value={filter.client}
                onChange={(e) => setFilter({ ...filter, client: e.target.value })}
                aria-label="Client access"
              >
                <option value="">Any client access</option>
                <option value="ALL">All clients</option>
                {lookups.data?.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} only
                  </option>
                ))}
              </select>
              <select
                className={ui.input}
                value={filter.status}
                onChange={(e) => setFilter({ ...filter, status: e.target.value })}
                aria-label="Status"
              >
                <option value="">All statuses</option>
                {STAFF_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s].label}
                  </option>
                ))}
              </select>
              {manage && (
                <button
                  type="button"
                  className="new-shipment-btn"
                  onClick={() => setEditing('new')}
                >
                  + Add Staff
                </button>
              )}
            </div>
          </div>
          <div className="plans-table-scroll">
            <table className="data-table-clean">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Clients</th>
                  <th>Department</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  cols={6}
                  loading={staff.isLoading}
                  error={staff.error}
                  empty={shown.length === 0}
                  emptyText={staff.data?.length ? 'No staff match these filters.' : 'No staff yet.'}
                />
                {shown.map((m) => (
                  <tr
                    key={m.id}
                    className={manage ? 'plans-row-clickable' : undefined}
                    tabIndex={manage ? 0 : undefined}
                    onClick={() => manage && setEditing(m)}
                    onKeyDown={(e) => manage && e.key === 'Enter' && setEditing(m)}
                  >
                    <td>
                      <div className={st.member}>
                        <Avatar name={m.fullName} src={m.avatarUrl} muted={!m.isActive} />
                        <div>
                          <div className="val-bold">
                            {m.fullName}
                            {m.id === user?.id ? ' (you)' : ''}
                          </div>
                          <div
                            style={{
                              fontSize: 11.5,
                              color: 'var(--text-tertiary)',
                              fontWeight: 700,
                            }}
                          >
                            {m.email}
                            {m.jobTitle ? ` · ${m.jobTitle}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {ROLE_LABEL[m.role]}
                      {(m.permissionsAdd.length > 0 || m.permissionsRemove.length > 0) && (
                        <span className={st.custom} title="Permissions changed for this person">
                          {' '}
                          · custom
                        </span>
                      )}
                    </td>
                    <td>
                      {m.clientIds ? (
                        m.clientIds.map((id) => clientCode.get(id) ?? '?').join(', ')
                      ) : (
                        <span className={st.muted}>All clients</span>
                      )}
                    </td>
                    <td>{m.department ?? '-'}</td>
                    <td>{m.lastLoginAt ? fmtDate(m.lastLoginAt) : 'Never'}</td>
                    <td>
                      <Pill tone={STATUS[m.isActive ? m.status : 'INACTIVE'].tone}>
                        {STATUS[m.isActive ? m.status : 'INACTIVE'].label}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <RolesMatrix editable={manage} />
      )}
      {editing && (
        <StaffModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

function StaffModal({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const lookups = useLookups();
  const save = useApiMutation(
    (v: Record<string, unknown>) =>
      member
        ? api(`/staff/${member.id}`, { method: 'PATCH', json: v })
        : api('/staff', { method: 'POST', json: v }),
    [['staff']],
  );
  const reset = useApiMutation(
    (password: string) =>
      api(`/staff/${member!.id}/reset-password`, { method: 'POST', json: { password } }),
    [['staff']],
  );
  const remove = useApiMutation(
    () => api(`/staff/${member!.id}`, { method: 'DELETE' }),
    [['staff']],
  );
  const roles = useRoles();
  const schema = member ? staffUpdateSchema : staffInputSchema;
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Record<string, string>>({
    resolver: formResolver(schema) as never,
    defaultValues: member
      ? {
          fullName: member.fullName,
          role: member.role,
          jobTitle: member.jobTitle ?? '',
          department: member.department ?? '',
          phone: member.phone ?? '',
          status: member.isActive ? member.status : 'INACTIVE',
        }
      : { role: 'OPERATOR', status: 'ACTIVE' },
  });
  const self = member?.id === user?.id;

  // Client access: null = every client, otherwise only the chosen ones.
  const [clientIds, setClientIds] = useState<string[] | null>(member?.clientIds ?? null);
  const toggleClient = (id: string) =>
    setClientIds((cur) => (cur?.includes(id) ? cur.filter((x) => x !== id) : [...(cur ?? []), id]));
  // Sections with their own client access, replacing the main one there (a section left out
  // follows it). Opened from the Clients button on the section's permission row.
  const [scopes, setScopes] = useState<ClientScopes>(member?.clientScopes ?? {});
  const [scopeOpen, setScopeOpen] = useState<ClientScopeArea | null>(null);
  const setScope = (area: ClientScopeArea, ids: string[] | null | undefined) =>
    setScopes((cur) => {
      const next = { ...cur };
      if (ids === undefined) delete next[area];
      else next[area] = ids;
      return next;
    });
  const toggleScopeClient = (area: ClientScopeArea, id: string) => {
    const cur = scopes[area] ?? [];
    setScope(area, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const clientCode = (id: string) => lookups.data?.clients.find((c) => c.id === id)?.code ?? '?';
  const scopeLabel = (area: ClientScopeArea) => {
    if (!(area in scopes)) return 'Same as main';
    const ids = scopes[area];
    if (!ids) return 'All clients';
    if (!ids.length) return 'None chosen';
    const codes = ids.map(clientCode);
    return codes.length > 2
      ? `${codes.slice(0, 2).join(', ')} +${codes.length - 2}`
      : codes.join(', ');
  };
  const emptyScope = CLIENT_SCOPE_AREAS.find((a) => scopes[a]?.length === 0);
  // Permissions: the role's set, plus extras, minus removals - for this person only.
  const role = useWatch({ control, name: 'role' }) as RoleCode | undefined;
  const rolePerms = useMemo(
    () => new Set(roles.data?.find((r) => r.code === role)?.permissions ?? []),
    [roles.data, role],
  );
  const [add, setAdd] = useState<Set<Permission>>(() => new Set(member?.permissionsAdd ?? []));
  const [removed, setRemoved] = useState<Set<Permission>>(
    () => new Set(member?.permissionsRemove ?? []),
  );
  const has = (p: Permission) => (rolePerms.has(p) || add.has(p)) && !removed.has(p);
  const togglePerm = (p: Permission) => {
    const flip = (set: Set<Permission>) => {
      const n = new Set(set);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    };
    if (rolePerms.has(p)) setRemoved(flip);
    else setAdd(flip);
  };
  // Only keep tweaks that still differ from the (possibly changed) role.
  const permissionsAdd = [...add].filter((p) => !rolePerms.has(p));
  const permissionsRemove = [...removed].filter((p) => rolePerms.has(p));
  const noClients = clientIds !== null && clientIds.length === 0;
  const changes = permissionsAdd.length + permissionsRemove.length;

  const submit = handleSubmit(async (v) => {
    if (noClients || emptyScope) {
      if (emptyScope) setScopeOpen(emptyScope);
      return;
    }
    await save.mutateAsync(
      self ? v : { ...v, permissionsAdd, permissionsRemove, clientIds, clientScopes: scopes },
    );
    toast(
      member ? 'Staff member updated.' : 'Staff member added. Give them their temporary password.',
    );
    onClose();
  });
  const doReset = async () => {
    const pw = window.prompt(
      'New temporary password (at least 10 characters with a number). They should change it after signing in.',
    );
    if (!pw) return;
    await reset.mutateAsync(pw);
    toast('Password reset. Their other sessions were signed out.');
  };
  const doRemove = async () => {
    if (
      !window.confirm(
        `Remove ${member!.fullName}? They can no longer sign in. Their past work stays in the records.`,
      )
    )
      return;
    await remove.mutateAsync(undefined);
    toast('Staff member removed.');
    onClose();
  };
  const f = (name: string, label: string, type = 'text', span?: number) => (
    <div className="form-field-group" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label htmlFor={`st-${name}`}>{label}</label>
      <input
        id={`st-${name}`}
        type={type}
        className="form-field-box"
        {...register(name)}
        aria-invalid={!!errors[name]}
        autoComplete="off"
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );
  return (
    <Modal
      title={member ? member.fullName : 'Add staff member'}
      sub={
        member ? member.email : 'They sign in with this email and the temporary password you set.'
      }
      onClose={onClose}
      width={1800}
    >
      <ErrorBanner error={save.error ?? reset.error ?? remove.error} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        {/* Wide layout: profile and clients on the left, permissions on the right. */}
        <div className={st.columns}>
          <div className={st.col}>
            <section className={st.panel} aria-labelledby="st-profile">
              <header className={st.panelHead}>
                <span className={st.panelIcon}>{ICONS.user}</span>
                <div>
                  <h4 id="st-profile">Profile</h4>
                  <p>Name, role and contact details.</p>
                </div>
              </header>
              <div className={st.profileGrid}>
                {f('fullName', 'Full name')}
                <div className="form-field-group">
                  <label htmlFor="st-role">Role</label>
                  <select
                    id="st-role"
                    className="form-select-box"
                    {...register('role')}
                    disabled={self}
                  >
                    {ROLE_CODES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field-group">
                  <label htmlFor="st-status">Status</label>
                  <select
                    id="st-status"
                    className="form-select-box"
                    {...register('status')}
                    disabled={self}
                  >
                    {STAFF_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS[s].label}
                      </option>
                    ))}
                  </select>
                </div>
                {f('jobTitle', 'Job title')}
                <div className="form-field-group">
                  <label htmlFor="st-department">Department</label>
                  <select
                    id="st-department"
                    className="form-select-box"
                    {...register('department')}
                  >
                    <option value="">—</option>
                    {lookups.data?.values.DEPARTMENT.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                {f('phone', 'Phone')}
                {member ? (
                  <div className="form-field-group">
                    <label htmlFor="st-email">Email address</label>
                    <input
                      id="st-email"
                      type="email"
                      className="form-field-box"
                      value={member.email}
                      readOnly
                      title="The sign-in email can't be changed"
                    />
                  </div>
                ) : (
                  <>
                    {f('email', 'Email address', 'email')}
                    {f('password', 'Temporary password')}
                  </>
                )}
              </div>
            </section>

            <fieldset
              className={`${st.panel} ${st.grow}`}
              disabled={self}
              aria-labelledby="st-clients"
            >
              <header className={st.panelHead}>
                <span className={st.panelIcon}>{ICONS.clients}</span>
                <div>
                  <h4 id="st-clients">Client access</h4>
                  <p>
                    They only see shipments, CDC items, documents, accounting and reports of these
                    clients. Shipments, Seal Plans, Clients and CDC Master List can have their own
                    under Permissions.
                  </p>
                </div>
                <div className={st.segment} role="radiogroup" aria-label="Client access">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={clientIds === null}
                    onClick={() => setClientIds(null)}
                  >
                    All clients
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={clientIds !== null}
                    onClick={() => setClientIds(clientIds ?? [])}
                  >
                    Only these
                  </button>
                </div>
              </header>
              {clientIds === null ? (
                <p className={st.allNote}>
                  Works with every client, including clients added later.
                </p>
              ) : (
                <>
                  <div className={st.clientGrid}>
                    {lookups.data?.clients.map((c) => (
                      <label key={c.id} className={st.clientCard}>
                        <input
                          type="checkbox"
                          checked={clientIds.includes(c.id)}
                          onChange={() => toggleClient(c.id)}
                        />
                        <span className={st.clientCode}>{c.code}</span>
                        <span className={st.clientName}>{c.name}</span>
                        <span className={st.tick} aria-hidden="true">
                          {ICONS.check}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className={st.count}>
                    {clientIds.length} of {lookups.data?.clients.length ?? 0} clients selected
                  </div>
                </>
              )}
              {noClients && (
                <FieldError message="Choose at least one client, or allow all clients." />
              )}
            </fieldset>
          </div>

          <div className={st.col}>
            <fieldset
              className={`${st.panel} ${st.grow}`}
              disabled={self}
              aria-labelledby="st-perms"
            >
              <header className={st.panelHead}>
                <span className={st.panelIcon}>{ICONS.shield}</span>
                <div>
                  <h4 id="st-perms">Permissions</h4>
                  <p>
                    Based on the <b>{role ? ROLE_LABEL[role] : ''}</b> role. Changes apply to this
                    person only.
                  </p>
                </div>
                {changes > 0 && (
                  <div className={st.changes}>
                    <span>
                      {changes} {changes === 1 ? 'change' : 'changes'}
                    </span>
                    <button
                      type="button"
                      className={st.resetLink}
                      onClick={() => {
                        setAdd(new Set());
                        setRemoved(new Set());
                      }}
                    >
                      Reset to role
                    </button>
                  </div>
                )}
              </header>
              <div className={st.permList}>
                {PERM_GROUPS.map((g) => {
                  const scopeArea = CLIENT_SCOPE_AREAS.find((a) => a === g);
                  return (
                    <div key={g} className={st.permBlock}>
                      <div className={st.permRow}>
                        <div className={st.area}>
                          <b>{AREAS[g]?.label ?? g}</b>
                          <span>{AREAS[g]?.desc}</span>
                        </div>
                        <div className={st.toggles}>
                          {scopeArea && (
                            <button
                              type="button"
                              className={st.scopeBtn}
                              data-own={scopeArea in scopes || undefined}
                              aria-expanded={scopeOpen === scopeArea}
                              onClick={() =>
                                setScopeOpen(scopeOpen === scopeArea ? null : scopeArea)
                              }
                              title="Which clients they can work with here"
                            >
                              {ICONS.clients}
                              {scopeLabel(scopeArea)}
                              <span className={st.caret} aria-hidden="true">
                                ▾
                              </span>
                            </button>
                          )}
                          {PERMISSIONS.filter((p) => p.startsWith(`${g}:`)).map((p) => {
                            const custom = has(p) !== rolePerms.has(p);
                            const action = p.split(':')[1]!;
                            return (
                              <label
                                key={p}
                                className={st.toggle}
                                data-custom={custom || undefined}
                                title={custom ? 'Changed for this person' : undefined}
                              >
                                <input
                                  type="checkbox"
                                  checked={has(p)}
                                  onChange={() => togglePerm(p)}
                                />
                                <span className={st.toggleTick} aria-hidden="true">
                                  {ICONS.check}
                                </span>
                                {ACTIONS[action] ?? action}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      {scopeArea && scopeOpen === scopeArea && (
                        <div className={st.scopePanel}>
                          <div className={st.scopeHead}>
                            <span>Clients in {AREAS[g]?.label}</span>
                            <div
                              className={st.segment}
                              role="radiogroup"
                              aria-label={`Clients in ${AREAS[g]?.label}`}
                            >
                              <button
                                type="button"
                                role="radio"
                                aria-checked={!(scopeArea in scopes)}
                                onClick={() => setScope(scopeArea, undefined)}
                              >
                                Same as main
                              </button>
                              <button
                                type="button"
                                role="radio"
                                aria-checked={scopeArea in scopes && scopes[scopeArea] === null}
                                onClick={() => setScope(scopeArea, null)}
                              >
                                All clients
                              </button>
                              <button
                                type="button"
                                role="radio"
                                aria-checked={!!scopes[scopeArea]}
                                onClick={() => setScope(scopeArea, scopes[scopeArea] ?? [])}
                              >
                                Only these
                              </button>
                            </div>
                          </div>
                          {!(scopeArea in scopes) ? (
                            <p className={st.allNote}>
                              Follows Client access:{' '}
                              {clientIds
                                ? clientIds.map(clientCode).join(', ') || 'none'
                                : 'all clients'}
                              .
                            </p>
                          ) : scopes[scopeArea] === null ? (
                            <p className={st.allNote}>
                              Every client here, including clients added later, whatever Client
                              access says.
                            </p>
                          ) : (
                            <div className={st.clientGrid}>
                              {lookups.data?.clients.map((c) => (
                                <label key={c.id} className={st.clientCard}>
                                  <input
                                    type="checkbox"
                                    checked={!!scopes[scopeArea]?.includes(c.id)}
                                    onChange={() => toggleScopeClient(scopeArea, c.id)}
                                  />
                                  <span className={st.clientCode}>{c.code}</span>
                                  <span className={st.clientName}>{c.name}</span>
                                  <span className={st.tick} aria-hidden="true">
                                    {ICONS.check}
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                          {scopes[scopeArea]?.length === 0 && (
                            <FieldError message="Choose at least one client, or allow all clients." />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </div>
        {self && (
          <p className={st.selfNote}>
            You can't change your own role, status, client access or permissions. Ask another Admin.
          </p>
        )}
        <div className={`${ui.actions} ${st.footer}`}>
          {member && !self && (
            <button type="button" className="btn-delete-shipment" onClick={() => void doRemove()}>
              Remove
            </button>
          )}
          {member && (
            <button type="button" className="btn-cancel-shipment" onClick={() => void doReset()}>
              Reset password
            </button>
          )}
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : member ? 'Save' : 'Add staff'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RolesMatrix({ editable }: { editable: boolean }) {
  const roles = useRoles();
  const toast = useToast();
  const save = useApiMutation(
    ({ code, permissions }: { code: RoleCode; permissions: Permission[] }) =>
      api(`/staff/roles/${code}`, { method: 'PUT', json: { permissions } }),
    [['staff', 'roles']],
  );
  const toggle = async (code: RoleCode, perm: Permission, on: boolean) => {
    const role = roles.data?.find((r) => r.code === code);
    if (!role) return;
    await save.mutateAsync({
      code,
      permissions: on ? [...role.permissions, perm] : role.permissions.filter((p) => p !== perm),
    });
    toast(
      `${ROLE_LABEL[code]} updated. Members get the change at their next sign-in or within 15 minutes.`,
    );
  };
  return (
    <div className={`card ${st.matrixCard}`}>
      <div className="card-header-row">
        <h3>Roles &amp; permissions</h3>
      </div>
      <ErrorBanner error={save.error} />
      <div className={`plans-table-scroll ${st.matrixWrap}`}>
        <table className={st.matrix}>
          <thead>
            <tr>
              <th>Area &amp; action</th>
              {roles.data?.map((r) => (
                <th key={r.code}>
                  {r.name}
                  <span>
                    {r.members} {r.members === 1 ? 'person' : 'people'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {PERM_GROUPS.map((g) => (
            <tbody key={g}>
              <tr className={st.groupRow}>
                <th colSpan={(roles.data?.length ?? 0) + 1} scope="rowgroup">
                  <b>{AREAS[g]?.label ?? g}</b>
                  <span>{AREAS[g]?.desc}</span>
                </th>
              </tr>
              {PERMISSIONS.filter((p) => p.startsWith(`${g}:`)).map((p) => {
                const action = ACTIONS[p.split(':')[1]!] ?? p;
                return (
                  <tr key={p}>
                    <th scope="row" className={st.actionCell}>
                      {action}
                    </th>
                    {roles.data?.map((r) => {
                      const locked = !editable || r.code === 'ADMIN';
                      return (
                        <td key={r.code}>
                          <label className={st.cell} data-locked={locked || undefined}>
                            <input
                              type="checkbox"
                              aria-label={`${r.name}: ${AREAS[g]?.label ?? g} · ${action}`}
                              checked={r.permissions.includes(p)}
                              disabled={locked || save.isPending}
                              onChange={(e) => void toggle(r.code, p, e.target.checked)}
                            />
                            <span className={st.box} aria-hidden="true">
                              {ICONS.check}
                            </span>
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className={ui.dialogSub} style={{ marginTop: 10 }}>
        Admin always has every permission. The server enforces these on every request.
      </p>
    </div>
  );
}
