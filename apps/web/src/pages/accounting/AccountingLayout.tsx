import { Outlet } from 'react-router-dom';

/**
 * The accounting engine's pages, as native routes (no iframe). Its sections (Monthly Ledger,
 * Client Billing, Chea Payments, Expense to Clients) are the sidebar's Accounting dropdown.
 */
export function AccountingLayout() {
  return <Outlet />;
}
