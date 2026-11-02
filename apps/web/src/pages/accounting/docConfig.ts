import { CONTAINER_SIZES, type BillingDocType, type LookupsResponse } from '@gs/shared';

export interface FieldDef {
  name: string;
  label: string;
  /** 'textarea': a two-line box, for long values such as an address. */
  type?: 'text' | 'date' | 'select' | 'number' | 'textarea';
  /** Half the section's width, side by side with the next half field (default: full width). */
  half?: boolean;
  /** The editor section the field sits in (default: the document's own details). */
  group?: 'customer' | 'ship';
  options?: (l: LookupsResponse) => { value: string; label: string }[];
  placeholder?: string;
}

const customer: FieldDef[] = [
  { name: 'customerNameEn', label: 'Customer (English)', group: 'customer' },
  { name: 'customerNameKm', label: 'ឈ្មោះអតិថិជន (Khmer)', group: 'customer' },
  { name: 'customerVattin', label: 'VATTIN', group: 'customer' },
  { name: 'customerAddress', label: 'Address', type: 'textarea', group: 'customer' },
];
const ship: FieldDef[] = [
  { name: 'shipper', label: 'Shipper', group: 'ship' },
  { name: 'consignee', label: 'Consignee', group: 'ship' },
  { name: 'hbl', label: 'HBL', group: 'ship' },
  { name: 'pkgs', label: 'Quantity', placeholder: 'e.g. 978', half: true, group: 'ship' },
  { name: 'pkgsUnit', label: 'Unit', placeholder: 'e.g. CTNS', half: true, group: 'ship' },
  { name: 'containerNo', label: 'Container No.', half: true, group: 'ship' },
  {
    name: 'containerSize',
    label: 'Size',
    type: 'select',
    options: () => CONTAINER_SIZES.map((v) => ({ value: v, label: v })),
    half: true,
    group: 'ship',
  },
  { name: 'grossWeightKg', label: 'Gross weight (kg)', type: 'number', half: true, group: 'ship' },
  { name: 'volumeCbm', label: 'Volume (CBM)', type: 'number', half: true, group: 'ship' },
  { name: 'pol', label: 'POL', half: true, group: 'ship' },
  { name: 'pod', label: 'POD', half: true, group: 'ship' },
];
const ports = (l: LookupsResponse) =>
  l.ports.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));

export const DOC_CONFIG: Record<
  BillingDocType,
  {
    numberField: string | null;
    dateField: string;
    title: string;
    fields: FieldDef[];
    tax: boolean;
    khr: boolean;
  }
> = {
  'tax-invoices': {
    numberField: 'invoiceNo',
    dateField: 'invoiceDate',
    title: 'Tax Invoice',
    tax: true,
    khr: true,
    fields: [
      { name: 'invoiceNo', label: 'Invoice No.', placeholder: 'auto: GS26-###' },
      { name: 'invoiceDate', label: 'Invoice date', type: 'date' },
      { name: 'exchangeRate', label: '1 USD = KHR', type: 'number' },
      ...customer,
      ...ship,
    ],
  },
  disbursements: {
    numberField: 'disNo',
    dateField: 'disDate',
    title: 'Disbursement',
    tax: false,
    khr: true,
    fields: [
      { name: 'disNo', label: 'DIS No.', placeholder: 'auto: DIS###' },
      { name: 'disDate', label: 'Date', type: 'date' },
      { name: 'exchangeRate', label: '1 USD = KHR', type: 'number' },
      { name: 'reference', label: 'Reference' },
      ...customer,
      ...ship,
    ],
  },
  'debit-notes': {
    numberField: 'dnNo',
    dateField: 'dnDate',
    title: 'Debit Note',
    tax: false,
    khr: false,
    fields: [
      { name: 'dnNo', label: 'DN No.', placeholder: 'auto: JR2608###' },
      { name: 'dnDate', label: 'Date', type: 'date' },
      { name: 'reference', label: 'Reference' },
      { name: 'billTo', label: 'Customer', group: 'customer' },
      { name: 'address', label: 'Address', type: 'textarea', group: 'customer' },
      ...ship,
    ],
  },
  'credit-notes': {
    numberField: 'cnNo',
    dateField: 'cnDate',
    title: 'Credit Noted',
    tax: false,
    khr: false,
    fields: [
      { name: 'cnNo', label: 'CN No.', placeholder: 'auto: CN26-###' },
      { name: 'cnDate', label: 'Date', type: 'date' },
      { name: 'billTo', label: 'Bill to' },
      { name: 'address', label: 'Address' },
      { name: 'shipper', label: 'Shipper' },
      { name: 'portId', label: 'Port', type: 'select', options: ports },
      { name: 'containerNo', label: 'Container No.' },
      { name: 'declareNo', label: 'Declare No.' },
      {
        name: 'refType',
        label: 'Ref type',
        type: 'select',
        options: () => [
          { value: 'HOUSE_BILL', label: 'House bill' },
          { value: 'BILL_NO', label: 'Bill no.' },
          { value: 'HAWB_NO', label: 'HAWB no.' },
        ],
      },
      { name: 'refNo', label: 'Ref number' },
      { name: 'quantityText', label: 'Qty / unit' },
      { name: 'grossWeightKg', label: 'Gross weight (kg)', type: 'number' },
      { name: 'cbm', label: 'CBM', type: 'number' },
    ],
  },
  'record-summaries': {
    numberField: null,
    dateField: 'summaryDate',
    title: 'Record Summary',
    tax: false,
    khr: false,
    fields: [
      { name: 'summaryDate', label: 'Date', type: 'date' },
      {
        name: 'direction',
        label: 'Shipment',
        type: 'select',
        options: () => [
          { value: 'IMPORT', label: 'IMPORT' },
          { value: 'EXPORT', label: 'EXPORT' },
        ],
      },
      {
        name: 'transportMode',
        label: 'Mode',
        type: 'select',
        options: () => ['SEA', 'AIR', 'ROAD', 'RAIL'].map((v) => ({ value: v, label: v })),
      },
      {
        name: 'loadType',
        label: 'Load',
        type: 'select',
        options: () => [
          { value: 'FCL', label: 'CY/CY' },
          { value: 'LCL', label: 'LCL' },
          { value: 'NONE', label: '—' },
        ],
      },
      { name: 'invNo', label: 'Invoice No.' },
      { name: 'disNo', label: 'Disbursement No.' },
      { name: 'dnNo', label: 'Debit note No.' },
      { name: 'declareNo', label: 'Declare No.' },
      {
        name: 'forwarderId',
        label: 'Forwarder',
        type: 'select',
        options: (l) => l.forwarders.map((f) => ({ value: f.id, label: f.name })),
      },
      { name: 'portId', label: 'Port', type: 'select', options: ports },
      { name: 'quantityText', label: 'Quantity' },
      { name: 'blNo', label: 'BL No.' },
      { name: 'containerNo', label: 'Container No.' },
      {
        name: 'containerSize',
        label: 'Size',
        type: 'select',
        options: () => CONTAINER_SIZES.map((v) => ({ value: v, label: v })),
      },
      { name: 'grossWeightKg', label: 'Gross weight (kg)', type: 'number' },
      { name: 'cbm', label: 'CBM' },
    ],
  },
};
