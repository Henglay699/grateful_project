/**
 * Role-based access control. Permissions are checked by the API middleware
 * (`requirePermission`) and mirrored in the web app to hide what a role can't use.
 * The database `roles.permissions` column is seeded from ROLE_DEFAULT_PERMISSIONS
 * and can be edited by an Admin (Phase 5).
 */
export const PERMISSIONS = [
  'dashboard:read',
  'shipments:read',
  'shipments:write',
  'shipments:delete',
  /** Seal Plans (container seals, trucking and depot); saving also updates the containers. */
  'sealplans:read',
  'sealplans:write',
  'clients:read',
  'clients:write',
  'cutstock:read',
  'cutstock:write',
  'cutstock:override',
  'accounting:read',
  'accounting:write',
  /** Credit Noted (Chea / customs broker payment vouchers), separate from the rest of accounting. */
  'creditnotes:read',
  'creditnotes:write',
  /** Record Summary (each shipment's summary sheet), separate so Operations can work on it. */
  'recordsummaries:read',
  'recordsummaries:write',
  'quotations:read',
  'quotations:write',
  /** Reports (Payroll, MIH, Import & Export): staff salaries, so kept apart from accounting. */
  'reports:read',
  /** Saving a report's setup (e.g. the capacity report's company details, machines, weights). */
  'reports:write',
  'documents:read',
  'documents:write',
  'followups:read',
  'followups:write',
  'staff:read',
  'staff:manage',
  'settings:read',
  'settings:manage',
  'audit:read',
  /** Customs permits, declarations, port clearance and CO work (the Broker's job). */
  'customs:read',
  'customs:write',
  /** Approve a shipment's document package and close jobs (Operation Manager). */
  'workflow:approve',
  /** Approve low-margin jobs and other finance exceptions (CEO). */
  'finance:approve',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_CODES = [
  'ADMIN',
  'MANAGER',
  'OPERATOR',
  'ACCOUNTANT',
  'VIEWER',
  'CUSTOMS_BROKER',
  'CEO',
  'OPERATION_MANAGER',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

const READ_ALL: Permission[] = PERMISSIONS.filter((p) => p.endsWith(':read'));

/** What Operations can change (shared by Operator and Operation Manager). */
const OPERATOR_WRITE: Permission[] = [
  'shipments:write',
  'sealplans:write',
  'clients:write',
  'cutstock:write',
  'recordsummaries:write',
  'documents:write',
  'followups:write',
];

export const ROLE_DEFAULT_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  MANAGER: PERMISSIONS.filter((p) => p !== 'settings:manage' && p !== 'staff:manage'),
  OPERATOR: [
    ...READ_ALL.filter(
      (p) =>
        p !== 'audit:read' &&
        p !== 'accounting:read' &&
        p !== 'creditnotes:read' &&
        p !== 'reports:read',
    ),
    ...OPERATOR_WRITE,
  ],
  ACCOUNTANT: [
    ...READ_ALL.filter((p) => p !== 'audit:read'),
    'accounting:write',
    'creditnotes:write',
    'reports:write',
    'recordsummaries:write',
    'quotations:write',
    'documents:write',
    'followups:write',
  ],
  VIEWER: READ_ALL.filter((p) => p !== 'audit:read' && p !== 'staff:read' && p !== 'reports:read'),
  /**
   * The customs broker: customs permits, declarations, port clearance and CO, the documents
   * they need, and Credit Noted vouchers. Looks shipments and clients up.
   */
  CUSTOMS_BROKER: [
    'dashboard:read',
    'shipments:read',
    'clients:read',
    'cutstock:read',
    'documents:read',
    'documents:write',
    'followups:read',
    'followups:write',
    'creditnotes:read',
    'creditnotes:write',
    'customs:read',
    'customs:write',
  ],
  /** Reviews and approves document packages, closes jobs, can do Operations' and customs work. */
  OPERATION_MANAGER: [
    ...READ_ALL.filter((p) => p !== 'audit:read' && p !== 'reports:read' && p !== 'staff:read'),
    ...OPERATOR_WRITE,
    'customs:write',
    'cutstock:override',
    'workflow:approve',
  ],
  /** Sees everything, approves finance exceptions (low-margin jobs); changes nothing else. */
  CEO: [...READ_ALL, 'workflow:approve', 'finance:approve'],
};

export const ROLE_LABEL: Record<RoleCode, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  OPERATOR: 'Operations',
  ACCOUNTANT: 'Accountant',
  VIEWER: 'Viewer',
  CUSTOMS_BROKER: 'Customs Broker',
  CEO: 'CEO',
  OPERATION_MANAGER: 'Operation Manager',
};

/** A user's permissions: their role's, plus per-user extras, minus per-user removals. */
export function effectivePermissions(
  role: readonly string[],
  add: readonly string[] = [],
  remove: readonly string[] = [],
): Permission[] {
  const removed = new Set(remove);
  return PERMISSIONS.filter((p) => (role.includes(p) || add.includes(p)) && !removed.has(p));
}

/**
 * Sections whose client access can be set apart from the person's main client access. A
 * section's own setting replaces the main one there: null = every client, a list = only those.
 * A section left out follows the main setting.
 */
export const CLIENT_SCOPE_AREAS = ['shipments', 'sealplans', 'clients', 'cutstock'] as const;
export type ClientScopeArea = (typeof CLIENT_SCOPE_AREAS)[number];
export type ClientScopes = Partial<Record<ClientScopeArea, string[] | null>>;

/** The clients a person may work with in a section (or overall); null = every client. */
export function clientsFor(
  main: string[] | null,
  scopes: ClientScopes | null | undefined,
  area?: ClientScopeArea,
): string[] | null {
  if (area && scopes && area in scopes) return scopes[area] ?? null;
  return main;
}

export function hasPermission(granted: readonly string[], needed: Permission): boolean {
  return granted.includes(needed);
}
