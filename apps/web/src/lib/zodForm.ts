import { zodResolver } from '@hookform/resolvers/zod';
import type { FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/**
 * zodResolver typed by the schema's INPUT (what the form holds). On submit the
 * handler receives the parsed output at runtime; it is sent to the API, which
 * validates it again with the same shared schema.
 */
export function formResolver<S extends z.ZodTypeAny>(
  schema: S,
): Resolver<z.input<S> & FieldValues> {
  return zodResolver(schema) as unknown as Resolver<z.input<S> & FieldValues>;
}
