import type { Permission, RoleCode } from '@gs/shared';
import type { IconName } from './icons';

export interface NavItem {
  to: string;
  label: string;
  /** Page title shown in the top bar (prototype wording). */
  title: string;
  icon: IconName;
  permission: Permission;
  /** Rendered with the prototype's indented sub-item style. */
  sub?: boolean;
  badge?: 'openFollowUps' | 'creditNoteInbox' | 'recordSummaryInbox' | 'myWork';
  /** Roles that don't see this item even with the permission (they use another page for it). */
  hideFor?: RoleCode[];
  /** Exact match for NavLink active state. */
  end?: boolean;
  /** Also lit on these paths (e.g. Client Billing on its register pages). */
  alsoActive?: string[];
  /** Makes the item a dropdown of these sub-items; `to` is then only the section's root. */
  children?: NavItem[];
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    heading: 'Management',
    items: [
      {
        to: '/overview',
        label: 'Overview',
        title: 'Overview',
        icon: 'overview',
        permission: 'dashboard:read',
      },
      {
        to: '/my-work',
        label: 'My Work',
        title: 'My Work',
        icon: 'myWork',
        permission: 'shipments:read',
        badge: 'myWork',
      },
      {
        to: '/plans',
        label: 'Shipping Plans',
        title: 'Shipping Plans',
        icon: 'plans',
        permission: 'shipments:read',
      },
      {
        to: '/seal-plans',
        label: 'Seal Plans',
        title: 'Seal Plans — Container Shipment Schedule',
        icon: 'seal',
        permission: 'sealplans:read',
      },
      {
        to: '/co',
        label: 'CO',
        title: 'CO — Certificates of Origin',
        icon: 'co',
        permission: 'shipments:read',
        // The broker only looks shipments up; COs are the factory's paperwork.
        hideFor: ['CUSTOMS_BROKER'],
        children: [
          {
            to: '/co',
            label: 'CO Plans',
            title: 'CO Plans',
            icon: 'coPlans',
            permission: 'shipments:read',
            end: true,
          },
          {
            to: '/co/breakdown',
            label: 'Breakdown',
            title: 'CO Breakdown',
            icon: 'breakdown',
            permission: 'shipments:read',
          },
        ],
      },
      {
        to: '/clients',
        label: 'Clients',
        title: 'Clients',
        icon: 'clients',
        permission: 'clients:read',
      },
      {
        to: '/analytics',
        label: 'Analytics',
        title: 'Analytics — Full Operations Breakdown',
        icon: 'analytics',
        permission: 'dashboard:read',
      },
      {
        to: '/cutstock',
        label: 'CDC Master List',
        title: 'CDC Master List',
        icon: 'cutstock',
        permission: 'cutstock:read',
      },
      {
        to: '/documents',
        label: 'Documents',
        title: 'Documents',
        icon: 'documents',
        permission: 'documents:read',
      },
      {
        to: '/pdf-tools',
        label: 'PDF Tools',
        title: 'PDF Tools',
        icon: 'pdftools',
        permission: 'documents:read',
      },
      {
        to: '/followup',
        label: 'Follow Up',
        title: 'Follow Up',
        icon: 'followup',
        permission: 'followups:read',
        badge: 'openFollowUps',
      },
    ],
  },
  {
    heading: 'Finance',
    items: [
      {
        to: '/accounting',
        label: 'Accounting',
        title: 'Accounting',
        icon: 'accounting',
        permission: 'accounting:read',
        children: [
          {
            to: '/accounting',
            label: 'Monthly',
            title: 'Accounting',
            icon: 'ledger',
            permission: 'accounting:read',
            end: true,
          },
          {
            // Client Billing holds the tax invoice, disbursement, debit note and receipt registers.
            to: '/accounting/billing',
            label: 'Client Billing',
            title: 'Accounting',
            icon: 'billing',
            permission: 'accounting:read',
            alsoActive: [
              '/accounting/tax-invoices',
              '/accounting/disbursements',
              '/accounting/debit-notes',
              '/accounting/receipts',
            ],
          },
          {
            to: '/accounting/credit-notes',
            label: 'Chea Payments',
            title: 'Chea Payments',
            icon: 'creditnote',
            permission: 'accounting:read',
          },
          {
            // Accounting's check of Operations' record summaries (made in Record Summary below).
            to: '/accounting/record-summaries',
            label: 'Expense to Clients',
            title: 'Record Summary',
            icon: 'recordsummary',
            permission: 'accounting:read',
          },
        ],
      },
      {
        to: '/reports',
        label: 'Reports',
        title: 'Reports',
        icon: 'reports',
        permission: 'reports:read',
        children: [
          {
            to: '/reports',
            label: 'Payroll',
            title: 'Reports',
            icon: 'payroll',
            permission: 'reports:read',
            end: true,
          },
          {
            to: '/reports/mih',
            label: 'MIH',
            title: 'Reports',
            icon: 'mih',
            permission: 'reports:read',
          },
          {
            to: '/reports/import-export',
            label: 'Import & Export',
            title: 'Reports',
            icon: 'importExport',
            permission: 'reports:read',
          },
        ],
      },
      {
        to: '/credit-noted',
        label: 'Credit Noted',
        title: 'Credit Noted (Chea Payment)',
        icon: 'creditnote',
        permission: 'creditnotes:read',
        badge: 'creditNoteInbox',
        // An Operations tool: accountants check credit notes in Accounting → Chea Payments.
        hideFor: ['ACCOUNTANT'],
      },
      {
        // Record Summary list (its own permission, so Operations can use it).
        to: '/record-summary',
        label: 'Record Summary',
        title: 'Record Summary',
        icon: 'recordsummary',
        permission: 'recordsummaries:read',
        badge: 'recordSummaryInbox',
        // Accountants check record summaries in Accounting → Expense to Clients.
        hideFor: ['ACCOUNTANT'],
      },
      {
        to: '/quotations',
        label: 'Quotations',
        title: 'Quotations',
        icon: 'quotations',
        permission: 'quotations:read',
      },
      {
        to: '/operations',
        label: 'Operations',
        title: 'Operations',
        icon: 'operations',
        permission: 'shipments:read',
      },
    ],
  },
  {
    heading: 'Admin',
    items: [
      {
        to: '/staff',
        label: 'Staff Management',
        title: 'Staff Management',
        icon: 'staff',
        permission: 'staff:read',
        children: [
          {
            to: '/staff/members',
            label: 'Team members',
            title: 'Staff Management',
            icon: 'clients',
            permission: 'staff:read',
          },
          {
            to: '/staff/roles',
            label: 'Roles & permissions',
            title: 'Staff Management',
            icon: 'roles',
            permission: 'staff:read',
          },
        ],
      },
      {
        // The broker reaches their own details here; the others under Settings.
        to: '/settings/broker',
        label: 'Broker Details',
        title: 'Settings',
        icon: 'roles',
        permission: 'customs:write',
        hideFor: ['ADMIN', 'MANAGER', 'OPERATION_MANAGER'],
      },
      {
        to: '/settings',
        label: 'Settings',
        title: 'Settings',
        icon: 'settings',
        permission: 'settings:read',
        // One page per section (/settings/<tab>); SETTINGS_TABS in SettingsPage lists the same.
        children: (
          [
            ['profile', 'My profile', 'profile'],
            ['company', 'Company', 'company'],
            ['rates', 'Rates', 'rates'],
            ['invoice', 'Tax management', 'tax'],
            ['holidays', 'Public holidays', 'holidays'],
            ['ports', 'Ports', 'ports'],
            ['forwarders', 'Forwarders', 'forwarders'],
            ['consignees', 'Consignees', 'consignees'],
            ['lists', 'Dropdown lists', 'lists'],
            ['broker', 'Customs broker', 'roles'],
          ] as const
        ).map(([tab, label, icon]) => ({
          to: `/settings/${tab}`,
          label,
          title: 'Settings',
          icon,
          permission: 'settings:read' as const,
        })),
      },
    ],
  },
];

/** Titles for routes that are not sidebar items. Longest prefix wins. */
const EXTRA_TITLES: [string, string][] = [
  ['/accounting/credit-notes', 'Chea Payments'],
  ['/accounting/tax-invoices', 'Tax Invoice'],
  ['/accounting/record-summaries', 'Record Summary'],
  ['/accounting/disbursements', 'Disbursement'],
  ['/accounting/debit-notes', 'Debit Note'],
  ['/plans/new', 'Create Shipment'],
  ['/plans/', 'Shipment Details'],
  ['/clients/', 'Client Details'],
  ['/quotations/', 'Quotation'],
];

export function titleFor(pathname: string): string {
  const candidates: [string, string][] = [
    ...EXTRA_TITLES,
    ...NAV.flatMap((g) => g.items.map((i) => [i.to, i.title] as [string, string])),
  ];
  const match = candidates
    .filter(([to]) => pathname === to || pathname.startsWith(to.endsWith('/') ? to : `${to}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] ?? 'Grateful Solutions';
}
