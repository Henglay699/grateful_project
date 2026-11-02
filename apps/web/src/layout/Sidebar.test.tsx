import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ROLE_DEFAULT_PERMISSIONS,
  hasPermission,
  type RoleCode,
  type SessionUser,
} from '@gs/shared';
import { Sidebar } from './Sidebar';

const authState: { user: SessionUser | null } = { user: null };
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: authState.user,
    can: (p: Parameters<typeof hasPermission>[1]) =>
      !!authState.user && hasPermission(authState.user.permissions, p),
    logout: vi.fn(),
  }),
}));
vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string) =>
    path.startsWith('/workflow/queue')
      ? { items: [{ shipmentId: 'a' }, { shipmentId: 'b' }], counts: {} }
      : {
          openFollowUps: 8,
          overdueFollowUps: 4,
          unreadNotifications: 0,
          creditNoteInbox: 0,
          recordSummaryInbox: 0,
        },
  ),
}));

function renderAs(role: RoleCode, path = '/overview') {
  authState.user = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'x@gs.local',
    fullName: 'Aden Whitfield',
    jobTitle: 'Customer Service Manager',
    avatarUrl: null,
    role,
    permissions: [...ROLE_DEFAULT_PERMISSIONS[role]],
    clientIds: null,
    clientScopes: {},
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar open={false} onNavigate={() => {}} onToggleCollapse={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const links = () =>
  within(screen.getByRole('navigation'))
    .getAllByRole('link')
    .map((a) => a.textContent?.replace(/\d+$/, '').trim());

describe('Sidebar', () => {
  it('shows every section to an Admin, in prototype order', () => {
    renderAs('ADMIN');
    expect(links()).toEqual([
      'Overview',
      'My Work',
      'Shipping Plans',
      'Seal Plans',
      'CO Plans',
      'Breakdown',
      'Clients',
      'Analytics',
      'CDC Master List',
      'Documents',
      'PDF Tools',
      'Follow Up',
      'Monthly',
      'Client Billing',
      'Chea Payments',
      'Expense to Clients',
      'Payroll',
      'MIH',
      'Import & Export',
      'Credit Noted',
      'Record Summary',
      'Quotations',
      'Operations',
      'Team members',
      'Roles & permissions',
      'My profile',
      'Company',
      'Rates',
      'Tax management',
      'Public holidays',
      'Ports',
      'Forwarders',
      'Consignees',
      'Dropdown lists',
      'Customs broker',
    ]);
    expect(screen.getByRole('button', { name: 'Staff Management' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('hides finance from Operators and admin pages from Viewers', () => {
    renderAs('OPERATOR');
    expect(screen.queryByRole('button', { name: 'Accounting' })).not.toBeInTheDocument();
    expect(links()).not.toContain('Monthly');
    expect(links()).not.toContain('Payroll');
    expect(links()).toContain('Shipping Plans');
  });

  it('shows Reports (payroll) to Accountants', () => {
    renderAs('ACCOUNTANT');
    expect(screen.getByRole('button', { name: 'Reports' })).toBeInTheDocument();
    expect(links()).toContain('Payroll');
  });

  it('keeps Reports (payroll) from Viewers', () => {
    renderAs('VIEWER');
    expect(screen.queryByRole('button', { name: 'Reports' })).not.toBeInTheDocument();
    expect(links()).not.toContain('Payroll');
  });

  it('leaves the Operations tools Credit Noted and Record Summary out for Accountants', () => {
    renderAs('ACCOUNTANT');
    expect(links()).toContain('Chea Payments');
    expect(links()).not.toContain('Credit Noted');
    expect(links()).not.toContain('Record Summary');
  });

  it('gives a Customs Broker their queue, lookups, documents and broker details', () => {
    renderAs('CUSTOMS_BROKER');
    expect(links()).toEqual([
      'Overview',
      'My Work',
      'Shipping Plans',
      'Clients',
      'Analytics',
      'CDC Master List',
      'Documents',
      'PDF Tools',
      'Follow Up',
      'Credit Noted',
      'Operations',
      'Broker Details',
    ]);
  });

  it('shows the My Work count', async () => {
    renderAs('OPERATOR');
    expect(await screen.findByLabelText('2 waiting')).toHaveTextContent('2');
  });

  it('hides staff management from Viewers', () => {
    renderAs('VIEWER');
    expect(links()).not.toContain('Staff Management');
    expect(screen.queryByText('Admin')).toBeInTheDocument(); // Settings still readable
  });

  it('marks the current route active', () => {
    renderAs('MANAGER', '/plans');
    expect(screen.getByRole('link', { name: 'Shipping Plans' })).toHaveClass('menu-item', 'active');
  });

  it('makes Accounting a dropdown, open while inside it', async () => {
    renderAs('ACCOUNTANT', '/accounting/tax-invoices');
    const toggle = screen.getByRole('button', { name: 'Accounting' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Client Billing' })).toHaveClass('active');
    toggle.click();
    expect(await screen.findByRole('button', { name: 'Accounting' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('renders the follow-up badge from the API', async () => {
    renderAs('MANAGER');
    expect(await screen.findByLabelText('8 open')).toHaveTextContent('8');
  });
});
