import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import type { Permission } from '@gs/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { AppLayout } from './layout/AppLayout';
import { RedirectRoles, RequireAuth, RequirePermission } from './auth/guards';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AccountingLayout } from './pages/accounting/AccountingLayout';
import { useAuth } from './auth/AuthProvider';
import { NAV } from './layout/nav';

const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const MyWorkPage = lazy(() =>
  import('./pages/MyWorkPage').then((m) => ({ default: m.MyWorkPage })),
);
const ShippingPlansPage = lazy(() =>
  import('./pages/ShippingPlansPage').then((m) => ({ default: m.ShippingPlansPage })),
);
const ShipmentFormPage = lazy(() =>
  import('./pages/plans/ShipmentFormPage').then((m) => ({ default: m.ShipmentFormPage })),
);
const SealPlansPage = lazy(() =>
  import('./pages/SealPlansPage').then((m) => ({ default: m.SealPlansPage })),
);
const ClientsPage = lazy(() =>
  import('./pages/ClientsPage').then((m) => ({ default: m.ClientsPage })),
);
const ClientDetailPage = lazy(() =>
  import('./pages/clients/ClientDetailPage').then((m) => ({ default: m.ClientDetailPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
);
const CutStockPage = lazy(() =>
  import('./pages/CutStockPage').then((m) => ({ default: m.CutStockPage })),
);
const DocumentsPage = lazy(() =>
  import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);
const PdfToolsPage = lazy(() =>
  import('./pages/PdfToolsPage').then((m) => ({ default: m.PdfToolsPage })),
);
const FollowUpPage = lazy(() =>
  import('./pages/FollowUpPage').then((m) => ({ default: m.FollowUpPage })),
);
const QuotationsPage = lazy(() =>
  import('./pages/QuotationsPage').then((m) => ({ default: m.QuotationsPage })),
);
const OperationsPage = lazy(() =>
  import('./pages/OperationsPage').then((m) => ({ default: m.OperationsPage })),
);
const StaffPage = lazy(() => import('./pages/StaffPage').then((m) => ({ default: m.StaffPage })));
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
/** Each page is its own chunk (charts load only on the dashboards). */
const LedgerPage = lazy(() =>
  import('./pages/accounting/LedgerPage').then((m) => ({ default: m.LedgerPage })),
);
const DocsListPage = lazy(() =>
  import('./pages/accounting/DocsListPage').then((m) => ({ default: m.DocsListPage })),
);
const DocEditorPage = lazy(() =>
  import('./pages/accounting/DocEditorPage').then((m) => ({ default: m.DocEditorPage })),
);
const BillingPage = lazy(() =>
  import('./pages/accounting/BillingPage').then((m) => ({ default: m.BillingPage })),
);
const BillingClientPage = lazy(() =>
  import('./pages/accounting/BillingClientPage').then((m) => ({ default: m.BillingClientPage })),
);
const ReceiptsPage = lazy(() =>
  import('./pages/accounting/ReceiptsPage').then((m) => ({ default: m.ReceiptsPage })),
);
const PrintPackPage = lazy(() =>
  import('./pages/print/PrintBillingPage').then((m) => ({ default: m.PrintPackPage })),
);
const PrintReceiptPage = lazy(() =>
  import('./pages/print/PrintBillingPage').then((m) => ({ default: m.PrintReceiptPage })),
);
const CreditNotesReview = lazy(() =>
  import('./pages/accounting/CreditNotesReview').then((m) => ({ default: m.CreditNotesReview })),
);
const CreditNotedList = lazy(() =>
  import('./pages/creditnoted/CreditNotedList').then((m) => ({ default: m.CreditNotedList })),
);
const CreditNotedRoute = lazy(() =>
  import('./pages/creditnoted/CreditNotedEditor').then((m) => ({ default: m.CreditNotedRoute })),
);
const ExpenseToClients = lazy(() =>
  import('./pages/accounting/ExpenseToClients').then((m) => ({ default: m.ExpenseToClients })),
);
const RecordSummariesList = lazy(() =>
  import('./pages/accounting/RecordSummariesList').then((m) => ({
    default: m.RecordSummariesList,
  })),
);
const RecordSummaryRoute = lazy(() =>
  import('./pages/accounting/RecordSummaryEditor').then((m) => ({
    default: m.RecordSummaryRoute,
  })),
);
const ReportsLayout = lazy(() =>
  import('./pages/reports/ReportsLayout').then((m) => ({ default: m.ReportsLayout })),
);
const ImportExportPage = lazy(() =>
  import('./pages/reports/ImportExportPage').then((m) => ({ default: m.ImportExportPage })),
);
const PayrollPage = lazy(() =>
  import('./pages/reports/PayrollPage').then((m) => ({ default: m.PayrollPage })),
);
const MihPage = lazy(() => import('./pages/reports/MihPage').then((m) => ({ default: m.MihPage })));
const PrintCapacityReportPage = lazy(() =>
  import('./pages/print/PrintCapacityReportPage').then((m) => ({
    default: m.PrintCapacityReportPage,
  })),
);
const PrintCustomsReportPage = lazy(() =>
  import('./pages/print/PrintCustomsReportPage').then((m) => ({
    default: m.PrintCustomsReportPage,
  })),
);
const CoLayout = lazy(() => import('./pages/co/CoLayout').then((m) => ({ default: m.CoLayout })));
const CoPlansPage = lazy(() =>
  import('./pages/co/CoPlansPage').then((m) => ({ default: m.CoPlansPage })),
);
const BreakdownPage = lazy(() =>
  import('./pages/co/BreakdownPage').then((m) => ({ default: m.BreakdownPage })),
);
const PrintCoBreakdownPage = lazy(() =>
  import('./pages/print/PrintCoBreakdownPage').then((m) => ({
    default: m.PrintCoBreakdownPage,
  })),
);
const QuotationEditorPage = lazy(() =>
  import('./pages/quotations/QuotationEditorPage').then((m) => ({
    default: m.QuotationEditorPage,
  })),
);
const PrintQuotationPage = lazy(() =>
  import('./pages/print/PrintQuotationPage').then((m) => ({ default: m.PrintQuotationPage })),
);
const PrintDocPage = lazy(() =>
  import('./pages/print/PrintDocPage').then((m) => ({ default: m.PrintDocPage })),
);
const PrintCreditNotePackPage = lazy(() =>
  import('./pages/print/PrintCreditNotePackPage').then((m) => ({
    default: m.PrintCreditNotePackPage,
  })),
);
const PrintRecordSummaryPackPage = lazy(() =>
  import('./pages/print/PrintRecordSummaryPackPage').then((m) => ({
    default: m.PrintRecordSummaryPackPage,
  })),
);
const PrintSealPlansPage = lazy(() =>
  import('./pages/print/PrintSealPlansPage').then((m) => ({ default: m.PrintSealPlansPage })),
);
const guard = (permission: Permission, el: ReactNode) => (
  <RequirePermission permission={permission}>
    <Suspense fallback={<PageLoading />}>{el}</Suspense>
  </RequirePermission>
);

function PageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ padding: 24, color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 700 }}
    >
      Loading…
    </div>
  );
}

/**
 * Credit notes open in the two-pane Credit Noted editor, record summaries in the two-pane
 * Record Summary editor; other types in the generic one.
 */
function DocEditorRoute() {
  const { type = '' } = useParams();
  if (type === 'record-summaries')
    return (
      <RequirePermission permission="recordsummaries:read">
        <RecordSummaryRoute base="/accounting/record-summaries" />
      </RequirePermission>
    );
  return type === 'credit-notes' ? (
    <CreditNotedRoute base="/accounting/credit-notes" />
  ) : (
    <DocEditorPage />
  );
}

/** Credit notes print for anyone with Credit Noted access (the customs broker too). */
function PrintDocRoute() {
  const { type } = useParams();
  return (
    <RequirePermission
      permission={
        type === 'credit-notes'
          ? 'creditnotes:read'
          : type === 'record-summaries'
            ? 'recordsummaries:read'
            : 'accounting:read'
      }
    >
      <Suspense fallback={null}>
        <PrintDocPage />
      </Suspense>
    </RequirePermission>
  );
}

/** "/" lands on the first sidebar page the role can open (a broker has no dashboard). */
/** Roles that work a queue land on My Work; the others on the first page they can open. */
const QUEUE_ROLES = new Set(['OPERATOR', 'ACCOUNTANT', 'CUSTOMS_BROKER', 'OPERATION_MANAGER']);

function HomeRedirect() {
  const { can, user } = useAuth();
  if (user && QUEUE_ROLES.has(user.role) && can('shipments:read'))
    return <Navigate to="/my-work" replace />;
  const first = NAV.flatMap((g) => g.items).find((i) => can(i.permission));
  return <Navigate to={first?.to ?? '/overview'} replace />;
}

function DocsListRoute() {
  const { type = '' } = useParams();
  // Accounting's Credit Noted tab checks the broker's submitted notes.
  if (type === 'credit-notes') return <CreditNotesReview />;
  // Expense to Clients: accounting's check of Operations' submitted record summaries.
  if (type === 'record-summaries') return <ExpenseToClients />;
  return <DocsListPage type={type} key={type} />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/print/quotation/:id',
    element: (
      <RequireAuth>
        <RequirePermission permission="quotations:read">
          <Suspense fallback={null}>
            <PrintQuotationPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // A client's month pack (documents, statements, receipts, checklist) for printing.
    path: '/print/billing/:clientId',
    element: (
      <RequireAuth>
        <RequirePermission permission="accounting:read">
          <Suspense fallback={null}>
            <PrintPackPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    path: '/print/receipts/:id',
    element: (
      <RequireAuth>
        <RequirePermission permission="accounting:read">
          <Suspense fallback={null}>
            <PrintReceiptPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // Credit Noted → ⋯ → PDF Pack: every credit note matching the list's filters.
    path: '/print/credit-noted-pack',
    element: (
      <RequireAuth>
        <RequirePermission permission="creditnotes:read">
          <Suspense fallback={null}>
            <PrintCreditNotePackPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // Record Summary → ⋯ → PDF Pack: every record summary matching the list's filters.
    path: '/print/record-summary-pack',
    element: (
      <RequireAuth>
        <RequirePermission permission="recordsummaries:read">
          <Suspense fallback={null}>
            <PrintRecordSummaryPackPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // Seal Plans → ⋯ → Export PDF: the filtered schedule on A4 landscape.
    path: '/print/seal-plans',
    element: (
      <RequireAuth>
        <RequirePermission permission="sealplans:read">
          <Suspense fallback={null}>
            <PrintSealPlansPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // Reports → Payroll → Capacity report → Print: the report left in session storage.
    path: '/print/capacity-report',
    element: (
      <RequireAuth>
        <RequirePermission permission="reports:read">
          <Suspense fallback={null}>
            <PrintCapacityReportPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // Reports → Import & Export → Print: the report left in session storage.
    path: '/print/customs-report',
    element: (
      <RequireAuth>
        <RequirePermission permission="reports:read">
          <Suspense fallback={null}>
            <PrintCustomsReportPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // CO → Breakdown → Print: the sheet left in session storage.
    path: '/print/co-breakdown',
    element: (
      <RequireAuth>
        <RequirePermission permission="shipments:read">
          <Suspense fallback={null}>
            <PrintCoBreakdownPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // Printable documents: full page, no sidebar.
    path: '/print/:type/:id',
    element: (
      <RequireAuth>
        <PrintDocRoute />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'overview', element: guard('dashboard:read', <OverviewPage />) },
      { path: 'my-work', element: guard('shipments:read', <MyWorkPage />) },
      { path: 'plans', element: guard('shipments:read', <ShippingPlansPage />) },
      { path: 'plans/new', element: guard('shipments:write', <ShipmentFormPage />) },
      { path: 'plans/:id', element: guard('shipments:read', <ShipmentFormPage />) },
      { path: 'seal-plans', element: guard('sealplans:read', <SealPlansPage />) },
      {
        // CO: CO Plans and Breakdown, the sidebar dropdown.
        path: 'co',
        element: guard('shipments:read', <CoLayout />),
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={null}>
                <CoPlansPage />
              </Suspense>
            ),
          },
          {
            path: 'breakdown',
            element: (
              <Suspense fallback={null}>
                <BreakdownPage />
              </Suspense>
            ),
          },
        ],
      },
      { path: 'clients', element: guard('clients:read', <ClientsPage />) },
      { path: 'clients/:id', element: guard('clients:read', <ClientDetailPage />) },
      { path: 'analytics', element: guard('dashboard:read', <AnalyticsPage />) },
      { path: 'cutstock', element: guard('cutstock:read', <CutStockPage />) },
      { path: 'documents', element: guard('documents:read', <DocumentsPage />) },
      { path: 'pdf-tools', element: guard('documents:read', <PdfToolsPage />) },
      { path: 'followup', element: guard('followups:read', <FollowUpPage />) },
      {
        path: 'accounting',
        element: guard('accounting:read', <AccountingLayout />),
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={null}>
                <LedgerPage />
              </Suspense>
            ),
          },
          {
            path: 'billing',
            element: (
              <Suspense fallback={null}>
                <BillingPage />
              </Suspense>
            ),
          },
          {
            path: 'billing/:clientId',
            element: (
              <Suspense fallback={null}>
                <BillingClientPage />
              </Suspense>
            ),
          },
          {
            path: 'receipts',
            element: (
              <Suspense fallback={null}>
                <ReceiptsPage />
              </Suspense>
            ),
          },
          {
            path: ':type',
            element: (
              <Suspense fallback={null}>
                <DocsListRoute />
              </Suspense>
            ),
          },
          {
            path: ':type/:id',
            element: (
              <Suspense fallback={null}>
                <DocEditorRoute />
              </Suspense>
            ),
          },
        ],
      },
      {
        // Reports: Payroll, MIH and Import & Export: the sidebar dropdown.
        path: 'reports',
        element: guard('reports:read', <ReportsLayout />),
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={null}>
                <PayrollPage />
              </Suspense>
            ),
          },
          {
            path: 'mih',
            element: (
              <Suspense fallback={null}>
                <MihPage />
              </Suspense>
            ),
          },
          {
            path: 'import-export',
            element: (
              <Suspense fallback={null}>
                <ImportExportPage />
              </Suspense>
            ),
          },
        ],
      },
      // Credit Noted and Record Summary are Operations tools: accountants use the Accounting
      // tabs Chea Payments and Expense to Clients for the same records.
      {
        path: 'credit-noted',
        element: (
          <RedirectRoles roles={['ACCOUNTANT']} to="/accounting/credit-notes">
            {guard('creditnotes:read', <CreditNotedList />)}
          </RedirectRoles>
        ),
      },
      {
        path: 'credit-noted/:id',
        element: (
          <RedirectRoles roles={['ACCOUNTANT']} to="/accounting/credit-notes/:id">
            {guard('creditnotes:read', <CreditNotedRoute base="/credit-noted" />)}
          </RedirectRoles>
        ),
      },
      {
        // Sidebar → Record Summary: the list (like Credit Noted); a row opens the editor.
        path: 'record-summary',
        element: (
          <RedirectRoles roles={['ACCOUNTANT']} to="/accounting/record-summaries">
            {guard('recordsummaries:read', <RecordSummariesList base="/record-summary" />)}
          </RedirectRoles>
        ),
      },
      {
        path: 'record-summary/:id',
        element: (
          <RedirectRoles roles={['ACCOUNTANT']} to="/accounting/record-summaries/:id">
            {guard('recordsummaries:read', <RecordSummaryRoute base="/record-summary" />)}
          </RedirectRoles>
        ),
      },
      { path: 'quotations', element: guard('quotations:read', <QuotationsPage />) },
      { path: 'quotations/:id', element: guard('quotations:read', <QuotationEditorPage />) },
      { path: 'operations', element: guard('shipments:read', <OperationsPage />) },
      { path: 'staff', element: <Navigate to="/staff/members" replace /> },
      { path: 'staff/:tab', element: guard('staff:read', <StaffPage />) },
      {
        // Everyone reaches My profile; the workspace sections check settings:read themselves.
        // /settings (and the old /settings?tab=…) lands on the section's own path.
        path: 'settings/:tab?',
        element: (
          <Suspense fallback={<PageLoading />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
