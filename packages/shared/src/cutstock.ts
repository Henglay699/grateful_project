/**
 * Cut-stock (CDC master list) rules from JR CDC MASTER LIST.xlsx:
 *   BALANCE = Quantity − Imported
 *   <50%    = BALANCE / Quantity
 *   Condition = IF(<50% < 50%, "CHECK", "OK")
 * The database view `cut_stock_balances` implements the same rules in SQL.
 */
import { toNumber, type Decimalish } from './money';

export const CUT_STOCK_CHECK_THRESHOLD = 0.5;

export interface CutStockBalance {
  balance: number;
  balancePct: number | null;
  condition: 'OK' | 'CHECK';
}

export function computeCutStockBalance(qty: Decimalish, imported: Decimalish): CutStockBalance {
  const q = toNumber(qty);
  const balance = Math.round((q - toNumber(imported)) * 1000) / 1000;
  const balancePct = q === 0 ? null : balance / q;
  const condition = balancePct === null || balancePct < CUT_STOCK_CHECK_THRESHOLD ? 'CHECK' : 'OK';
  return { balance, balancePct, condition };
}

/** True when declaring `requestedQty` more would push the balance below zero. */
export function wouldOverImport(
  qty: Decimalish,
  imported: Decimalish,
  requestedQty: Decimalish,
): boolean {
  return toNumber(qty) - toNumber(imported) - toNumber(requestedQty) < -1e-9;
}
