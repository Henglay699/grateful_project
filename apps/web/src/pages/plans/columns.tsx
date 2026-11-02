import type { ReactNode } from 'react';
import { CLEARANCE_STATUS_LABEL, freightMethodLabel, type ShipmentListItem } from '@gs/shared';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import { StagePill } from '../../components/workflow/StagePill';

export interface PlanColumn {
  key: string;
  label: string;
  render: (r: ShipmentListItem) => ReactNode;
  bold?: boolean;
  /** Export-side details (booking, seals, CO, PO/style…): left out of the Import list. */
  exportOnly?: boolean;
  /** Import-side details (ETA at the port): left out of the Export list. */
  importOnly?: boolean;
}

const dash = (v: ReactNode) => (v === null || v === undefined || v === '' ? '-' : v);
const qty = (r: ShipmentListItem) =>
  r.quantity ? `${fmtNum(r.quantity)} ${r.quantityUnit ?? ''}`.trim() : '-';

/** A list in one cell: the first `max` items, then "…" and how many more; all on hover. */
function ListMore({ items, max, title }: { items: string[]; max: number; title?: string }) {
  if (!items.length) return <>-</>;
  if (items.length <= max) return <>{items.join(', ')}</>;
  return (
    <span title={title ?? items.join(', ')}>
      {items.slice(0, max).join(', ')}, …{' '}
      <span className="invoice-more">+{items.length - max}</span>
    </span>
  );
}

/** A shipment's invoice numbers: the first three, then "…" and how many more; all on hover. */
export function InvoiceNos({ nos, max = 3 }: { nos: string[]; max?: number }) {
  return <ListMore items={nos} max={max} />;
}

/** Every container as "No / size", for the hover on the Ctnr No and Size cells. */
const ctnrList = (r: ShipmentListItem) =>
  r.containers.map((c) => `${c.containerNo}${c.size ? ` / ${c.size}` : ''}`).join(', ');

const declareNos = (r: ShipmentListItem) =>
  dash(r.declarations.map((d) => d.declareNo ?? 'Pending').join(', '));

/** Same columns, labels and order as the prototype's plansBaseColumns. */
export const BASE_COLUMNS: PlanColumn[] = [
  {
    key: 'invoice',
    label: 'Invoice No.',
    render: (r) => <InvoiceNos nos={r.invoiceNos} />,
    bold: true,
    importOnly: true,
  },
  // An export can carry many invoices: the first one only, the rest on hover.
  {
    key: 'invoice',
    label: 'Invoice No.',
    render: (r) => <InvoiceNos nos={r.invoiceNos} max={1} />,
    bold: true,
    exportOnly: true,
  },
  // Where the job is in its workflow, coloured by the role that has it.
  {
    key: 'stage',
    label: 'Stage',
    render: (r) => <StagePill direction={r.direction} stage={r.workflowStage} />,
  },
  { key: 'qty', label: 'Quantity', render: qty },
  { key: 'eta', label: 'ETA Port', render: (r) => fmtDate(r.eta), importOnly: true },
  { key: 'declareNo', label: 'Declare No.', render: declareNos, exportOnly: true },
  // Customs clearance (declaration) date: the order the plan is listed in by default.
  {
    key: 'clearanceDate',
    label: 'Clearance Date',
    render: (r) => fmtDate(r.declarations[0]?.declareDate),
  },
  {
    key: 'fwd',
    label: 'Forwarder',
    // Cut short with "…"; the whole name on hover.
    render: (r) =>
      r.forwarderName ? (
        <span className="cell-ellipsis" style={{ maxWidth: 170 }} title={r.forwarderName}>
          {r.forwarderName.toUpperCase()}
        </span>
      ) : (
        '-'
      ),
  },
  // The port's short name (SHV, KTI, OLAIR…), in capitals; the full name on hover.
  {
    key: 'clearance',
    label: 'Clearance Port',
    render: (r) =>
      r.clearancePortName ? (
        <span title={r.clearancePortName}>
          {(r.clearancePortShortName || r.clearancePortName).toUpperCase()}
        </span>
      ) : (
        '-'
      ),
  },
  { key: 'hbl', label: 'HBL No', render: (r) => dash(r.hblNo) },
  // The first container, then "… +N"; every container (with its size) on hover.
  {
    key: 'ctnr',
    label: 'Ctnr No',
    render: (r) => (
      <ListMore items={r.containers.map((c) => c.containerNo)} max={1} title={ctnrList(r)} />
    ),
  },
  {
    key: 'ctnrSize',
    label: 'Size',
    render: (r) =>
      r.containers.some((c) => c.size) ? (
        <ListMore items={r.containers.map((c) => c.size ?? '-')} max={1} title={ctnrList(r)} />
      ) : (
        '-'
      ),
  },
  {
    key: 'freight',
    label: 'Freight Method',
    render: (r) => freightMethodLabel(r.transportMode, r.loadType),
  },
];

/** The prototype's plansExpandedColumns ("Expand All"). */
export const EXPANDED_COLUMNS: PlanColumn[] = [
  { key: 'reference', label: 'Reference', render: (r) => r.reference },
  { key: 'client', label: 'Client', render: (r) => r.clientCode },
  { key: 'consignee', label: 'Consignee', render: (r) => dash(r.consigneeName) },
  { key: 'invoiceDate', label: 'Invoice Date', render: (r) => fmtDate(r.invoiceDate) },
  { key: 'country', label: 'Country', render: (r) => dash(r.countryName) },
  {
    key: 'bookingNo',
    label: 'Booking / SO No.',
    render: (r) => dash(r.bookingNo),
    exportOnly: true,
  },
  {
    key: 'linerSeal',
    label: 'Liner Seal',
    render: (r) =>
      dash(
        r.containers
          .map((c) => c.linerSeal)
          .filter(Boolean)
          .join(', '),
      ),
    exportOnly: true,
  },
  {
    key: 'customsSeal',
    label: 'Customs Seal',
    render: (r) =>
      dash(
        r.containers
          .map((c) => c.customsSeal)
          .filter(Boolean)
          .join(', '),
      ),
    exportOnly: true,
  },
  { key: 'crd', label: 'CRD', render: (r) => fmtDate(r.crd), exportOnly: true },
  { key: 'thcHblNo', label: 'INVOICE / THC No.', render: (r) => dash(r.thcHblNo) },
  { key: 'thcHblDate', label: 'Invoice / THC Date', render: (r) => fmtDate(r.thcHblDate) },
  {
    key: 'thcHblAmount',
    label: 'Invoice / THC Amount',
    render: (r) => (r.thcHblAmount ? fmtMoney(r.thcHblAmount) : '-'),
  },
  {
    key: 'clearanceStatus',
    label: 'Clearance Status',
    render: (r) => CLEARANCE_STATUS_LABEL[r.clearanceStatus],
  },
  { key: 'vessel', label: 'Vessel Name', render: (r) => dash(r.vesselName) },
  { key: 'voyage', label: 'Voyage No.', render: (r) => dash(r.voyageNo) },
  { key: 'coForm', label: 'CO Form', render: (r) => dash(r.coForm), exportOnly: true },
  { key: 'coNumber', label: 'CO Number', render: (r) => dash(r.coNumber), exportOnly: true },
  { key: 'coStatus', label: 'CO Status', render: (r) => dash(r.coStatus), exportOnly: true },
  { key: 'netWeight', label: 'Net Weight', render: (r) => `${fmtNum(r.totals.netWeightKg, 2)} KG` },
  {
    key: 'grossWeight',
    label: 'Gross Weight',
    render: (r) => `${fmtNum(r.totals.grossWeightKg, 2)} KG`,
  },
  { key: 'cbm', label: 'CBM', render: (r) => fmtNum(r.totals.cbm) },
  { key: 'poNo', label: 'PO No.', render: (r) => dash(r.firstLine?.poNo), exportOnly: true },
  {
    key: 'styleNo',
    label: 'Style No.',
    render: (r) => dash(r.firstLine?.styleNo),
    exportOnly: true,
  },
  {
    key: 'htsCode',
    label: 'HTS Code',
    render: (r) => dash(r.firstLine?.htsCode),
    exportOnly: true,
  },
  { key: 'qtyPcs', label: 'Qty (PCS)', render: (r) => fmtNum(r.totals.pcs) },
  { key: 'ctns', label: 'CTNS', render: (r) => fmtNum(r.totals.ctns) },
  {
    key: 'fobPrice',
    label: 'FOB Price',
    render: (r) => (r.firstLine?.fobUnitPrice ? `$${fmtNum(r.firstLine.fobUnitPrice, 4)}` : '-'),
  },
  { key: 'totalFob', label: 'Total FOB', render: (r) => fmtMoney(r.totals.fob) },
  // An Export lists it up front, before Clearance Date.
  { key: 'declareNo', label: 'Declare No.', render: declareNos, importOnly: true },
  {
    key: 'declareDate',
    label: 'Declare Date',
    render: (r) => fmtDate(r.declarations[0]?.declareDate),
  },
  { key: 'description', label: 'Description', render: (r) => dash(r.firstLine?.description) },
  { key: 'etdPort', label: 'ETD Port', render: (r) => dash(r.etdPort), exportOnly: true },
  {
    key: 'remark',
    label: 'Remark',
    // Cut at the column width with "…"; the whole remark on hover.
    render: (r) =>
      r.remark ? (
        <span className="cell-ellipsis" title={r.remark}>
          {r.remark}
        </span>
      ) : (
        '-'
      ),
  },
];
