import type { ZodType, ZodTypeDef } from 'zod';
import { badRequest } from './errors';

/** Parse untrusted input with a Zod schema, throwing a 400 with field-level details. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw badRequest('Some fields are invalid', details);
  }
  return result.data;
}
