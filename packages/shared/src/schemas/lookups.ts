import { z } from 'zod';
import type { ClientStatus, LookupType, PortKind } from '../enums';
import { optText } from './fields';

export interface LookupsResponse {
  clients: {
    id: string;
    code: string;
    name: string;
    legalName: string | null;
    status: ClientStatus;
    commissionUsd: string;
  }[];
  consignees: { id: string; name: string; clientId: string | null; countryIso2: string | null }[];
  forwarders: { id: string; code: string; name: string }[];
  ports: {
    id: string;
    code: string;
    name: string;
    shortName: string;
    kind: PortKind;
    customsPortNo: string | null;
  }[];
  countries: { iso2: string; name: string }[];
  /** Broker names used on shipments so far (the Broker dropdown adds ours first). */
  brokers: string[];
  values: Record<LookupType, { value: string; label: string }[]>;
}

/** Quick-add from a dropdown ("+ Add New" in the prototype). */
export const consigneeInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(160),
  clientId: z
    .string()
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  countryIso2: z
    .string()
    .trim()
    .length(2)
    .toUpperCase()
    .nullish()
    .transform((v) => v ?? null),
  address: optText(400),
});
export type ConsigneeInput = z.infer<typeof consigneeInputSchema>;

export const forwarderInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(160),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,16}$/, '2–16 letters, digits or -')
    .optional(),
});
export type ForwarderInput = z.infer<typeof forwarderInputSchema>;
