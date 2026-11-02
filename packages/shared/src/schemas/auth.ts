import { z } from 'zod';
import { ROLE_CODES, PERMISSIONS } from '../permissions';

const scopeIds = z
  .array(z.string().uuid())
  .min(1, 'Choose at least one client, or allow all clients')
  .nullable()
  .optional();
/** Per-section client access that replaces the main one there (see CLIENT_SCOPE_AREAS). */
export const clientScopesSchema = z.object({
  shipments: scopeIds,
  sealplans: scopeIds,
  clients: scopeIds,
  cutstock: scopeIds,
});

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.enum(ROLE_CODES),
  permissions: z.array(z.enum(PERMISSIONS)),
  /** Clients this user may work with; null = every client. */
  clientIds: z.array(z.string().uuid()).nullable(),
  clientScopes: clientScopesSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().describe('Access token lifetime in seconds'),
  user: sessionUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const navCountsSchema = z.object({
  openFollowUps: z.number().int(),
  overdueFollowUps: z.number().int(),
  unreadNotifications: z.number().int(),
  /** Unread messages from accounting in my Credit Noted inbox. */
  creditNoteInbox: z.number().int(),
  recordSummaryInbox: z.number().int(),
});
export type NavCounts = z.infer<typeof navCountsSchema>;

/** My profile (Settings → My profile): the name shown in the sidebar and on records. */
export const profileUpdateSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Enter at least 2 characters')
    .max(80, 'Keep it under 80 characters'),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
