import type { Direction, ShipmentDetail, ShipmentInput } from '@gs/shared';

export type FormValues = ShipmentInput;
export type InvoiceValues = NonNullable<FormValues['invoices']>[number];
export type LineValues = InvoiceValues['lines'][number];
export type DeclValues = NonNullable<FormValues['declarations']>[number];

/** The customs broker: us. New shipments start with it; the Broker dropdown offers it. */
export const DEFAULT_BROKER = 'GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD';

export const blankLine = (): LineValues => ({
  poNo: '',
  styleNo: '',
  htsCode: '',
  material: '',
  cdcNo: '',
  unit: '',
  pcs: '',
  ctns: '',
  cbm: '',
  netWeightKg: '',
  grossWeightKg: '',
  fobUnitPrice: '',
  description: '',
  overrideReason: '',
});
export const blankInvoice = (invoiceDate = ''): InvoiceValues => ({
  invoiceNo: '',
  invoiceDate,
  description: '',
  packages: '',
  lines: [blankLine()],
});
/** One container row ready to fill in; left blank, it is ignored on save. */
export const blankContainer = () => ({
  containerNo: '',
  size: '40HQ' as const,
  linerSeal: '',
  customsSeal: '',
  truckNo: '',
});
export const blankDeclaration = (portId = ''): DeclValues => ({
  id: '',
  declareNo: '',
  declareDate: '',
  portId,
  notes: '',
});

export function emptyForm(direction: Direction, clientId = ''): FormValues {
  return {
    clientId,
    direction,
    transportMode: 'SEA',
    loadType: 'FCL',
    clearanceStatus: 'PENDING',
    shipperName: '',
    consigneeId: '',
    forwarderId: '',
    broker: DEFAULT_BROKER,
    clearancePortId: '',
    originCountryIso2: '',
    destinationCountryIso2: '',
    etdPort: '',
    quantity: '',
    quantityUnit: direction === 'EXPORT' ? 'CTNS' : '',
    material: direction === 'EXPORT' ? 'Garments' : '',
    bookingNo: '',
    hblNo: '',
    vesselName: '',
    voyageNo: '',
    crd: '',
    etd: '',
    atd: '',
    eta: '',
    ata: '',
    arriveFty: '',
    receivedDocumentDate: '',
    flightNo: '',
    checkInDate: '',
    doDate: '',
    incoterm: '',
    cutOffDate: '',
    thcHblNo: '',
    thcHblDate: '',
    thcHblAmount: '',
    coForm: '',
    coNumber: '',
    coStatus: '',
    remark: '',
    containers: [blankContainer()],
    invoices: [blankInvoice()],
    // One row ready to fill in; it can stay blank and be filled in later.
    declarations: [blankDeclaration()],
  };
}

const s = (v: string | null | undefined) => v ?? '';

export function fromDetail(d: ShipmentDetail): FormValues {
  return {
    clientId: d.clientId,
    direction: d.direction,
    transportMode: d.transportMode,
    loadType: d.loadType,
    clearanceStatus: d.clearanceStatus,
    shipperName: s(d.shipperName),
    consigneeId: s(d.consigneeId),
    forwarderId: s(d.forwarderId),
    broker: s(d.broker),
    clearancePortId: s(d.clearancePortId),
    originCountryIso2: s(d.originCountryIso2),
    destinationCountryIso2: s(d.destinationCountryIso2),
    etdPort: s(d.etdPort),
    quantity: s(d.quantity && String(Number(d.quantity))),
    quantityUnit: s(d.quantityUnit),
    material: s(d.material),
    bookingNo: s(d.bookingNo),
    hblNo: s(d.hblNo),
    vesselName: s(d.vesselName),
    voyageNo: s(d.voyageNo),
    crd: s(d.crd),
    etd: s(d.etd),
    atd: s(d.atd),
    eta: s(d.eta),
    ata: s(d.ata),
    arriveFty: s(d.arriveFty),
    receivedDocumentDate: s(d.receivedDocumentDate),
    flightNo: s(d.flightNo),
    checkInDate: s(d.checkInDate),
    doDate: s(d.doDate),
    incoterm: d.incoterm ?? '',
    cutOffDate: s(d.cutOffDate),
    thcHblNo: s(d.thcHblNo),
    thcHblDate: s(d.thcHblDate),
    thcHblAmount: s(d.thcHblAmount),
    coForm: s(d.coForm),
    coNumber: s(d.coNumber),
    coStatus: s(d.coStatus),
    remark: s(d.remark),
    containers: d.containers.length
      ? d.containers.map((c) => ({
          containerNo: c.containerNo,
          size: c.size,
          linerSeal: s(c.linerSeal),
          customsSeal: s(c.customsSeal),
          truckNo: s(c.truckNo),
        }))
      : [blankContainer()],
    invoices: d.invoices.length
      ? d.invoices.map((i) => ({
          invoiceNo: i.invoiceNo,
          invoiceDate: s(i.invoiceDate),
          description: s(i.description),
          packages: num(i.packages),
          lines: i.lines.map((l) => ({
            poNo: s(l.poNo),
            styleNo: s(l.styleNo),
            htsCode: s(l.htsCode),
            material: s(l.material),
            cdcNo: s(l.cdcNo),
            unit: s(l.unit),
            pcs: num(l.pcs),
            ctns: num(l.ctns),
            cbm: num(l.cbm),
            netWeightKg: num(l.netWeightKg),
            grossWeightKg: num(l.grossWeightKg),
            fobUnitPrice: num(l.fobUnitPrice),
            description: s(l.description),
            overrideReason: s(l.overrideReason),
          })),
        }))
      : [blankInvoice()],
    declarations: d.declarations.length
      ? d.declarations.map((x) => ({
          id: x.id,
          declareNo: s(x.declareNo),
          declareDate: x.declareDate,
          portId: s(x.portId),
          notes: s(x.notes),
        }))
      : [blankDeclaration(s(d.clearancePortId))],
  };
}

/** "1234.000" → "1234"; keeps the user's precision when editing. */
function num(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

/** Drop invoices and declarations the user never filled in, so untouched blank rows don't fail validation. */
export function cleanForSubmit(v: FormValues): FormValues {
  const lineFilled = (l: LineValues) =>
    Object.values(l).some((x) => x !== '' && x !== null && x !== undefined);
  return {
    ...v,
    containers:
      v.loadType === 'FCL' && v.transportMode !== 'AIR'
        ? // Truck no. is only shown by truck: clear any left from when the shipment was by truck.
          (v.containers ?? []).map((c) => (v.transportMode === 'ROAD' ? c : { ...c, truckNo: '' }))
        : [],
    // Air has no vessel or voyage: clear any left from when the shipment was by sea.
    ...(v.transportMode === 'AIR' && { vesselName: '', voyageNo: '' }),
    invoices: (v.invoices ?? [])
      .filter((i) => i.invoiceNo || i.lines.some(lineFilled))
      .map((i) => ({ ...i, lines: i.lines.filter(lineFilled) })),
    declarations: (v.declarations ?? [])
      // A saved declaration cleared out is dropped too, which removes it on save.
      .filter((d) => d.declareNo?.trim() || d.declareDate || d.notes?.trim())
      // Declarations have no port picker: they clear at the shipment's Clearance Port (an
      // export without one keeps the port it had).
      .map((d) => ({
        ...d,
        portId: v.clearancePortId || (v.direction === 'IMPORT' ? '' : d.portId),
      })),
  };
}

export const toNum = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
