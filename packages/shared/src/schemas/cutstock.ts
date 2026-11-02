import { z } from 'zod';
import { CUT_STOCK_CATEGORIES, type CutStockCategory } from '../enums';
import { paginationQuerySchema } from './common';
import { decimal, optText } from './fields';

export const CUT_STOCK_CATEGORY_LABEL: Record<CutStockCategory, string> = {
  MACHINERY_EQUIPMENT: 'I. Machineries & Equipments',
  RAW_MATERIAL: 'II. Raw Material',
  ACCESSORY: 'III. Accessory',
};

export const cutStockItemInputSchema = z.object({
  clientId: z.string().uuid('Choose a client'),
  declareRef: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[IVX]+-\d+$/, 'Use the master list format, e.g. I-12 or III-195'),
  category: z.enum(CUT_STOCK_CATEGORIES),
  name: z.string().trim().min(2, 'Enter the item name').max(200),
  newOrUsed: optText(20),
  unit: z.string().trim().toUpperCase().min(1, 'Enter the unit').max(10),
  qty: decimal(3, { min: 0, allowEmpty: false }),
  unitPrice: decimal(4, { min: 0 }).transform((v) => v ?? '0'),
  remarks: optText(300),
  openingImportedQty: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
});
export type CutStockItemInput = z.input<typeof cutStockItemInputSchema>;
export const cutStockItemUpdateSchema = cutStockItemInputSchema.omit({ clientId: true }).partial();

export const CUT_STOCK_SORT_FIELDS = ['lineNo', 'name', 'balance', 'balancePct', 'qty'] as const;

export const cutStockListQuerySchema = paginationQuerySchema.extend({
  clientId: z.string().uuid(),
  category: z.enum(CUT_STOCK_CATEGORIES).optional(),
  condition: z.enum(['OK', 'CHECK', 'OVER']).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(500),
});

export interface CutStockRow {
  id: string;
  clientId: string;
  lineNo: number;
  declareRef: string;
  category: CutStockCategory;
  name: string;
  newOrUsed: string | null;
  unit: string;
  qty: string;
  unitPrice: string;
  totalPrice: string;
  remarks: string | null;
  importedQty: string;
  importedValue: string;
  importedNw: string;
  balance: string;
  balancePct: string | null;
  condition: 'OK' | 'CHECK';
}

export interface CutStockSummary {
  items: number;
  checkCount: number;
  overImported: number;
  totalValue: string;
  importedValue: string;
}

/** An import invoice item that drew this item down. */
export interface CutStockMovement {
  id: string;
  invoiceNo: string;
  invoiceDate: string | null;
  shipmentId: string;
  shipmentReference: string;
  qty: string;
  unitPrice: string;
  netWeightKg: string;
  overrideReason: string | null;
  overrideBy: string | null;
  createdAt: string;
}

export interface CutStockOption {
  id: string;
  declareRef: string;
  name: string;
  unit: string;
  unitPrice: string;
  balance: string;
}

export interface CutStockImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; message: string }[];
}
