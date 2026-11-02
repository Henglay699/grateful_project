import {
  pgTable,
  text,
  boolean,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  date,
  jsonb,
} from 'drizzle-orm/pg-core';
import type { ClientScopes } from '@gs/shared';
import { sql } from 'drizzle-orm';
import { id, timestamps, softDelete, roleCodeEnum, staffStatusEnum } from './_common';

export const roles = pgTable('roles', {
  id: id(),
  code: roleCodeEnum('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  permissions: text('permissions')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ...timestamps,
});

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    avatarUrl: text('avatar_url'),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    /** Per-user tweaks on top of the role's permissions. */
    permissionsAdd: text('permissions_add')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    permissionsRemove: text('permissions_remove')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Clients this user may work with; NULL = every client. */
    clientIds: uuid('client_ids').array(),
    /** Sections with their own client access, replacing client_ids there (see CLIENT_SCOPE_AREAS). */
    clientScopes: jsonb('client_scopes').$type<ClientScopes>().notNull().default({}),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    index('users_role_idx').on(t.roleId),
  ],
);

export const staffProfiles = pgTable('staff_profiles', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  jobTitle: text('job_title'),
  department: text('department'),
  phone: text('phone'),
  status: staffStatusEnum('status').notNull().default('ACTIVE'),
  joinedOn: date('joined_on'),
  ...timestamps,
});

/**
 * Refresh tokens are stored hashed (SHA-256). Each login starts a token family;
 * rotation issues a new token in the same family. Presenting a revoked token
 * revokes the whole family (reuse detection).
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);
