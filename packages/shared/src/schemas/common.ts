import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Money accepted as number or numeric string, max 12 integer digits and 2 decimals. */
export const moneySchema = z
  .union([z.number(), z.string().trim()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v))
  .refine((v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v), 'Money must have at most 2 decimals');

export const quantitySchema = z
  .union([z.number(), z.string().trim()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v))
  .refine((v) => /^-?\d{1,11}(\.\d{1,3})?$/.test(v), 'Quantity must have at most 3 decimals');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(25),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z][a-zA-Z0-9_]*(,-?[a-zA-Z][a-zA-Z0-9_]*)*$/)
    .optional()
    .describe('Comma-separated fields; prefix with - for descending, e.g. -eta,invoiceNo'),
  q: z.string().trim().max(120).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'BUSINESS_RULE',
  'RATE_LIMITED',
  /** An outside service we depend on (e.g. the MEF exchange-rate API) failed. */
  'UPSTREAM_ERROR',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
