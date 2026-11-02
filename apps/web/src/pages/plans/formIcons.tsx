/** Line icons for the shipment form (same stroke style as layout/icons). */
import type { ReactNode, SVGProps } from 'react';

const svg = (children: ReactNode) => (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    {children}
  </svg>
);

export const fi = {
  building: svg(
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </>,
  ),
  idCard: svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M15 9h3M15 13h3M6.5 16.5a3 3 0 0 1 5 0" />
    </>,
  ),
  box: svg(
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>,
  ),
  ship: svg(
    <>
      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M19.4 17.5 21 12l-9-4-9 4 1.6 5.5M12 8V2M8 4h8" />
    </>,
  ),
  plane: svg(
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  ),
  truck: svg(
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>,
  ),
  exportBox: svg(
    <>
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      <path d="M15 3h6v6M21 3l-9 9" />
    </>,
  ),
  importBox: svg(
    <>
      <path d="M21 10V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
      <path d="M21 21l-8-8M13 19v-6h6" />
    </>,
  ),
  file: svg(
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h5" />
    </>,
  ),
  user: svg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </>,
  ),
  users: svg(
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>,
  ),
  pin: svg(
    <>
      <path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>,
  ),
  hash: svg(<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />),
  bank: svg(<path d="M3 21h18M3 10h18M5 6l7-3 7 3M5 10v11M9.5 10v11M14.5 10v11M19 10v11" />),
  layers: svg(
    <>
      <path d="m12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8Z" />
      <path d="m2 12 9.2 4.2a2 2 0 0 0 1.6 0L22 12M2 17l9.2 4.2a2 2 0 0 0 1.6 0L22 17" />
    </>,
  ),
  calendar: svg(
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>,
  ),
  anchor: svg(
    <>
      <circle cx="12" cy="5" r="3" />
      <path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3" />
    </>,
  ),
  container: svg(
    <>
      <rect x="2" y="6" width="20" height="13" rx="1.5" />
      <path d="M6 9v7M10 9v7M14 9v7M18 9v7" />
    </>,
  ),
  activity: svg(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
  receipt: svg(
    <>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11" />
    </>,
  ),
  dollar: svg(<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />),
  message: svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  badge: svg(
    <>
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m9 12 2 2 4-4" />
    </>,
  ),
  route: svg(
    <>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </>,
  ),
  shirt: svg(
    <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />,
  ),
  trash: svg(
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />,
  ),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  check: svg(<path d="M20 6 9 17l-5-5" />),
  arrowRight: svg(<path d="M5 12h14M12 5l7 7-7 7" />),
  arrowLeft: svg(<path d="M19 12H5M12 19l-7-7 7-7" />),
  save: svg(
    <>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7" />
    </>,
  ),
  clock: svg(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>,
  ),
  weight: svg(
    <>
      <circle cx="12" cy="5" r="3" />
      <path d="M6.5 8a2 2 0 0 0-1.9 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.93-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z" />
    </>,
  ),
};

export type FormIcon = keyof typeof fi;

/** Each field's label icon, by field name. */
export const FIELD_ICON: Partial<Record<string, FormIcon>> = {
  clientId: 'idCard',
  reference: 'hash',
  direction: 'route',
  transportMode: 'ship',
  loadType: 'file',
  incoterm: 'route',
  consigneeId: 'user',
  forwarderId: 'building',
  shipperName: 'building',
  broker: 'idCard',
  destinationCountryIso2: 'pin',
  originCountryIso2: 'pin',
  quantity: 'hash',
  quantityUnit: 'box',
  material: 'layers',
  bookingNo: 'hash',
  hblNo: 'file',
  crd: 'calendar',
  clearancePortId: 'anchor',
  declareNo: 'hash',
  declareDate: 'calendar',
  etd: 'calendar',
  atd: 'calendar',
  eta: 'calendar',
  arriveFty: 'calendar',
  receivedDocumentDate: 'calendar',
  flightNo: 'plane',
  checkInDate: 'calendar',
  doDate: 'calendar',
  cutOffDate: 'clock',
  vesselName: 'ship',
  voyageNo: 'hash',
  coForm: 'file',
  coNumber: 'hash',
  coStatus: 'badge',
  thcHblNo: 'receipt',
  thcHblDate: 'calendar',
  thcHblAmount: 'dollar',
  remark: 'message',
  shipmentStatus: 'activity',
  clearanceStatus: 'badge',
};
