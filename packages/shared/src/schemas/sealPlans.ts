import { z } from 'zod';
import { CONTAINER_SIZES, type ContainerSize } from '../enums';
import { decimal, optDate, optText, optUuid } from './fields';
import { containerNo } from './shipments';

/** Seal Plans: one row per container of a live export shipment, grouped by month. */
export const sealPlanListQuerySchema = z.object({
  /** A row's month is its loading date's (the ETD's while no loading date is set). */
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  clientId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
});

const optSize = z
  .enum(CONTAINER_SIZES)
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

/** Editable on the Seal Plans page; the seals are written back to the shipment's container. */
export const sealPlanInputSchema = z.object({
  /** For a shipment's container: a new no. renames the container on the shipment too. */
  containerNo: containerNo.optional(),
  /** For a shipment's container: a size here also updates the container. */
  size: optSize,
  linerSeal: optText(40),
  customsSeal: optText(40),
  carrier: optText(60),
  destination: optText(120),
  tareWeightKg: decimal(3, { min: 0 }),
  truckBy: optText(80),
  driverPhone: optText(40),
  truckNo: optText(40),
  deliverTo: optText(120),
  loadingDate: optDate,
  depot: optText(120),
  other: optText(300),
});
export type SealPlanInput = z.input<typeof sealPlanInputSchema>;
export type SealPlanValues = z.output<typeof sealPlanInputSchema>;

/** A plan started blank (no shipment): it keeps the shipment-side details itself. */
export const sealPlanStandaloneSchema = sealPlanInputSchema.extend({
  clientId: z.string().uuid('Choose the factory'),
  containerNo,
  bookingNo: optText(60),
  portId: optUuid,
  vesselName: optText(120),
  etd: optDate,
});
export type SealPlanStandaloneInput = z.input<typeof sealPlanStandaloneSchema>;
export type SealPlanStandaloneValues = z.output<typeof sealPlanStandaloneSchema>;

export interface SealPlanRow {
  /** The plan's id; null for a shipment container nobody has planned yet. */
  id: string | null;
  /** Null for a plan started blank. */
  shipmentId: string | null;
  shipmentReference: string | null;
  containerNo: string;
  /** YYYY-MM the row is listed under. */
  month: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  /** The shipment's tax invoice no. (Monthly Ledger INV), once accounting has given it. */
  invNo: string | null;
  bookingNo: string | null;
  portId: string | null;
  portCode: string | null;
  portName: string | null;
  destinationCountry: string | null;
  vesselName: string | null;
  etd: string | null;
  size: ContainerSize | null;
  linerSeal: string | null;
  customsSeal: string | null;
  carrier: string | null;
  destination: string | null;
  tareWeightKg: string | null;
  truckBy: string | null;
  driverPhone: string | null;
  truckNo: string | null;
  deliverTo: string | null;
  loadingDate: string | null;
  depot: string | null;
  other: string | null;
}

/** An export CY/CY shipment offered by "+ New Seal Plan". */
export interface SealPlanShipmentOption {
  id: string;
  reference: string;
  clientCode: string;
  clientName: string;
  bookingNo: string | null;
  vesselName: string | null;
  etd: string | null;
  portName: string | null;
  containerNo: string | null;
  containerSize: ContainerSize | null;
  containerCount: number;
  /** Containers that already have a seal plan. */
  plannedCount: number;
}

/** A picked shipment: its details and one row per container (planned or not). */
export interface SealPlanShipment {
  id: string;
  reference: string;
  clientName: string;
  bookingNo: string | null;
  vesselName: string | null;
  etd: string | null;
  destinationCountry: string | null;
  rows: SealPlanRow[];
}
