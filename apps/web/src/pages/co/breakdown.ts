import { round2, type CoBreakdownInput, type CoDetail } from '@gs/shared';

/*
 * CO → Breakdown: the "BREAKDOWN COST OF FINISHED PRODUCTS FOR GSP QUALIFY APPLICATION" sheet
 * (the AB sheet of BREAKDOWN.xlsx), worked out as its formulas do. Every figure is per piece.
 *
 * The ex-factory price (target FOB less transport) is split into the imported part (fabric +
 * accessories) and the local part (local operational + overhead + profit) by the import share.
 * Fabric costs its unit price × the kilos per piece, the price chosen so that fabric and
 * accessories keep the base ratio; local operational and overhead take their base share of the
 * local part, profit the rest. So the sheet always adds up to the target FOB.
 */

export const AS_PER_INVOICE = 'As Per Invoice and Packing List.';

/** The CO forms that need a breakdown; the others (A, CRF, …) are applied for without one. */
export const BREAKDOWN_FORMS = ['AB', 'N', 'AJ', 'E', 'RCEP', 'D'];

export function needsBreakdown(form: string | null | undefined) {
  return !!form && BREAKDOWN_FORMS.includes(form.trim().toUpperCase());
}

/** A first breakdown: the workbook's own settings, the invoice's HTS code, date and FOB. */
export function defaultBreakdown(d: CoDetail): CoBreakdownInput {
  return {
    htsCode: d.htsCode ?? d.invoiceNo,
    date: d.invoiceDate,
    kinds: AS_PER_INVOICE,
    poNo: AS_PER_INVOICE,
    styleNo: AS_PER_INVOICE,
    fabricName: 'KNITTED FABRIC',
    fabricOrigin: 'Taiwan',
    accessoriesOrigin: 'China',
    targetFob: d.pcs ? round2(d.amount / d.pcs) : 0,
    importShare: 0.51,
    transportCost: 0.09,
    base: { fabric: 1.15, accessories: 0.54, local: 0.49, overhead: 0.47, profit: 0.5 },
    accountant: '',
    manager: '',
  };
}

/**
 * The breakdown an invoice opens with: its saved one, else the client's last one (its ratios
 * and signers) carried over with this invoice's HTS code, date and FOB, else the defaults.
 */
export function startingBreakdown(d: CoDetail): CoBreakdownInput {
  if (d.breakdown) return d.breakdown;
  const fresh = defaultBreakdown(d);
  if (!d.template) return fresh;
  const { htsCode, date, targetFob } = fresh;
  return { ...d.template, htsCode, date, targetFob };
}

export interface BreakdownSheet {
  qty: number;
  netWeightKg: number;
  /** Kilos of fabric per piece (N.N.W. ÷ qty). */
  kgPerPcs: number;
  fabricUnitCost: number;
  fabric: number;
  accessories: number;
  local: number;
  overhead: number;
  profit: number;
  /** Ex-factory price: the sub-total of the five costs. */
  subTotal: number;
  transport: number;
  fob: number;
  localContent: number;
  importContent: number;
  /**
   * The suggested-format pages split local operational in tenths: power, diesel, water and
   * other materials; cutting, sewing, checking, ironing and other labour; other direct cost.
   */
  tenth: number;
}

export function computeBreakdown(b: CoBreakdownInput, qty: number, netWeightKg: number) {
  const exPrice = b.targetFob - b.transportCost;
  const importAmount = exPrice * b.importShare;
  const localAmount = exPrice * (1 - b.importShare);
  const kgPerPcs = qty ? netWeightKg / qty : 0;

  const fabricWeight = b.base.fabric * kgPerPcs + b.base.accessories;
  const fabricUnitCost = fabricWeight ? round2((b.base.fabric * importAmount) / fabricWeight) : 0;
  const fabric = fabricUnitCost * kgPerPcs;
  const accessories = importAmount - fabric;

  const localBase = b.base.local + b.base.overhead + b.base.profit;
  const local = localBase ? round2((b.base.local * localAmount) / localBase) : 0;
  const overhead = localBase ? round2((b.base.overhead * localAmount) / localBase) : 0;
  const profit = localAmount - local - overhead;

  const subTotal = fabric + accessories + local + overhead + profit;
  return {
    qty,
    netWeightKg,
    kgPerPcs,
    fabricUnitCost,
    fabric,
    accessories,
    local,
    overhead,
    profit,
    subTotal,
    transport: b.transportCost,
    fob: subTotal + b.transportCost,
    localContent: subTotal ? (local + overhead + profit) / subTotal : 0,
    importContent: subTotal ? (fabric + accessories) / subTotal : 0,
    tenth: local / 10,
  } satisfies BreakdownSheet;
}
