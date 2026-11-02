import { z } from 'zod';

/** Optional free text: trims, empty → null. */
export const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

export const optUuid = z
  .string()
  .uuid()
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

/** Decimal as string with a max number of decimals; accepts numbers, "1,234.5". */
export const decimal = (
  decimals: number,
  { min, allowEmpty = true }: { min?: number; allowEmpty?: boolean } = {},
) =>
  z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v, ctx) => {
      const raw = v === null || v === undefined ? '' : String(v).replace(/,/g, '').trim();
      if (raw === '') {
        if (allowEmpty) return null;
        ctx.addIssue({ code: 'custom', message: 'Required' });
        return z.NEVER;
      }
      if (!/^-?\d+(\.\d+)?$/.test(raw)) {
        ctx.addIssue({ code: 'custom', message: 'Must be a number' });
        return z.NEVER;
      }
      const [, frac = ''] = raw.split('.');
      if (frac.length > decimals) {
        ctx.addIssue({ code: 'custom', message: `At most ${decimals} decimals` });
        return z.NEVER;
      }
      if (min !== undefined && Number(raw) < min) {
        ctx.addIssue({
          code: 'custom',
          message: min === 0 ? 'Cannot be negative' : `Must be at least ${min}`,
        });
        return z.NEVER;
      }
      return raw;
    });

/** Query-string value that may be repeated (?a=1&a=2) or comma-separated. */
export const multi = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr.flatMap((x) => String(x).split(',')).filter(Boolean);
  }, z.array(item).optional());

export const boolParam = z.preprocess(
  (v) => (v === undefined ? undefined : v === 'true' || v === '1' || v === true),
  z.boolean().optional(),
);
