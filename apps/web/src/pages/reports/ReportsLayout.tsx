import { Outlet } from 'react-router-dom';

/**
 * Reports' pages. Their sections (Payroll, MIH and Import & Export) are the sidebar's Reports
 * dropdown, as Accounting's are.
 */
export function ReportsLayout() {
  return <Outlet />;
}
