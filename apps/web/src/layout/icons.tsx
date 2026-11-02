/** Stroke icons copied from the prototype's sidebar and top bar markup. */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  'aria-hidden': true,
} as const;

export const icons = {
  // A clipboard with a tick: the person's own work queue.
  myWork: (p: IconProps) => (
    <svg {...base} {...p}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 12.5l2 2 4-4.5" />
    </svg>
  ),
  shield: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  overview: (p: IconProps) => (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
    </svg>
  ),
  // A schedule: a calendar with a clock in its corner.
  plans: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
      <path d="M16 2v4M8 2v4M3 10h5" />
      <circle cx="16" cy="16" r="6" />
      <path d="M16 14v2.2l1.6 1" />
    </svg>
  ),
  clients: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  analytics: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  ),
  documents: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  pdftools: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 13h2.5a1.5 1.5 0 0 1 0 3H8v-5M14 18v-5h2.5M14 15.5h2" />
    </svg>
  ),
  followup: (p: IconProps) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  cutstock: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  ),
  seal: (p: IconProps) => (
    <svg {...base} {...p}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  /** Certificate with a seal ribbon: CO (certificates of origin). */
  co: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M7 8h10M7 12h5" />
      <circle cx="18" cy="16" r="3" />
      <path d="M16.5 18.6 16 22l2-1 2 1-.5-3.4" />
    </svg>
  ),
  /** Checked list: CO → CO Plans. */
  coPlans: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="m3 6 2 2 3-3M3 13l2 2 3-3M3 20l2 2 3-3M11 6h10M11 13h10M11 20h10" />
    </svg>
  ),
  /** Pie split: CO → Breakdown (the cost breakdown). */
  breakdown: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M21.2 15.9A10 10 0 1 1 8 2.8" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  ),
  accounting: (p: IconProps) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6" />
    </svg>
  ),
  /** Open book: Accounting → Monthly. */
  ledger: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  /** Stacked invoices: Accounting → Client Billing. */
  billing: (p: IconProps) => (
    <svg {...base} {...p}>
      <rect x="4" y="5" width="13" height="17" rx="2" />
      <path d="M8 2h10a2 2 0 0 1 2 2v14M8 11h5M8 15h5" />
    </svg>
  ),
  /** Banknote: Reports → Payroll. */
  payroll: (p: IconProps) => (
    <svg {...base} {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  /** Factory: Reports → MIH. */
  mih: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M2 21V10l6 4V10l6 4V4h8v17zM6 17h2M11 17h2M16 17h2" />
    </svg>
  ),
  /** Two-way arrows: Reports → Import & Export. */
  importExport: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
    </svg>
  ),
  chevronDown: (p: IconProps) => (
    <svg {...base} width={14} height={14} {...p}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  /** Clipboard with a bar chart: Reports (Payroll, MIH, Import & Export). */
  reports: (p: IconProps) => (
    <svg {...base} {...p}>
      <rect x="5" y="4" width="14" height="18" rx="2" />
      <path d="M9 2h6v4H9zM9 18v-3M12 18v-6M15 18v-4" />
    </svg>
  ),
  /** Receipt: Credit Noted (the broker's payment voucher), as in the accounting engine. */
  creditnote: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-3 2V2z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </svg>
  ),
  /** Package: Record Summary, as in the accounting engine. */
  recordsummary: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  quotations: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  ),
  operations: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  staff: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  settings: (p: IconProps) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  collapse: (p: IconProps) => (
    <svg {...base} strokeWidth={2} width={16} height={16} {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  ),
  signout: (p: IconProps) => (
    <svg {...base} strokeWidth={2} {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  dots: (p: IconProps) => (
    <svg {...base} strokeWidth={0} fill="currentColor" width={18} height={18} {...p}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
  menu: (p: IconProps) => (
    <svg {...base} strokeWidth={2} width={20} height={20} {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  search: (p: IconProps) => (
    <svg {...base} strokeWidth={2.5} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  sun: (p: IconProps) => (
    <svg {...base} strokeWidth={2} width={18} height={18} {...p}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  bell: (p: IconProps) => (
    <svg {...base} strokeWidth={2} width={18} height={18} {...p}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  close: (p: IconProps) => (
    <svg {...base} strokeWidth={2.2} {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  send: (p: IconProps) => (
    <svg {...base} strokeWidth={2.2} {...p}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  plus: (p: IconProps) => (
    <svg {...base} strokeWidth={3} width={16} height={16} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  download: (p: IconProps) => (
    <svg
      {...base}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      {...p}
    >
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M12 4v11M7 10l5 5 5-5" />
    </svg>
  ),
  edit: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  trash: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  upload: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M12 15V4M7 9l5-5 5 5" />
    </svg>
  ),
  printer: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v7H6z" />
    </svg>
  ),
  moon: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  chat: (p: IconProps) => (
    <svg
      {...base}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      {...p}
    >
      {/* Team chat: one speech bubble with typing dots. */}
      <path d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-4.5 3.5V18H6a3 3 0 0 1-3-3z" />
      <path d="M8 11h.01M12 11h.01M16 11h.01" strokeWidth={2.6} />
    </svg>
  ),
  paperclip: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  smile: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
  camera: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
  maximize: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  ),
  minimize: (p: IconProps) => (
    <svg {...base} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  ),
  back: (p: IconProps) => (
    <svg {...base} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  /* Settings and Staff Management sub-items. */
  profile: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  ),
  company: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M16 9h3a2 2 0 0 1 2 2v10" />
      <path d="M9 7h3M9 11h3M9 15h3" />
    </svg>
  ),
  rates: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  ),
  tax: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M19 5L5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </svg>
  ),
  holidays: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M12 13.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z" />
    </svg>
  ),
  ports: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5V21M5 12H2a10 10 0 0 0 20 0h-3M8 11h8" />
    </svg>
  ),
  forwarders: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M1 4h14v12H1zM15 9h4l3 3v4h-7" />
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="18.5" cy="18.5" r="2" />
    </svg>
  ),
  consignees: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  ),
  lists: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  ),
  roles: (p: IconProps) => (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
};
export type IconName = keyof typeof icons;
