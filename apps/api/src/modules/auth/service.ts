import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { effectivePermissions, type RoleCode, type SessionUser } from '@gs/shared';
import type { Request } from 'express';
import { db } from '../../db/client';
import { refreshTokens, roles, staffProfiles, users } from '../../db/schema';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { unauthenticated } from '../../lib/errors';
import { hashToken, newRefreshToken, signAccessToken } from './tokens';

// Used to keep the timing of "unknown email" equal to "wrong password".
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      isActive: users.isActive,
      role: roles.code,
      permissions: roles.permissions,
      permissionsAdd: users.permissionsAdd,
      permissionsRemove: users.permissionsRemove,
      clientIds: users.clientIds,
      clientScopes: users.clientScopes,
      jobTitle: staffProfiles.jobTitle,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!row || !row.isActive) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    jobTitle: row.jobTitle ?? null,
    role: row.role as RoleCode,
    permissions: effectivePermissions(row.permissions, row.permissionsAdd, row.permissionsRemove),
    clientIds: row.clientIds ?? null,
    clientScopes: row.clientScopes ?? {},
  };
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: SessionUser;
}

async function issueSession(
  user: SessionUser,
  familyId: string,
  req: Request,
): Promise<IssuedSession & { refreshId: string }> {
  const { token, hash } = newRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId: user.id,
      familyId,
      tokenHash: hash,
      expiresAt: refreshExpiresAt,
      userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
      ip: req.ip ?? null,
    })
    .returning({ id: refreshTokens.id });
  return {
    accessToken: signAccessToken(
      user.id,
      user.role,
      user.permissions,
      user.clientIds,
      user.clientScopes,
    ),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: token,
    refreshExpiresAt,
    user,
    refreshId: row!.id,
  };
}

export async function login(email: string, password: string, req: Request): Promise<IssuedSession> {
  const [found] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, isActive: users.isActive })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, isNull(users.deletedAt)))
    .limit(1);

  const ok = await bcrypt.compare(password, found?.passwordHash ?? DUMMY_HASH);
  if (!found || !ok || !found.isActive) {
    await audit(
      db,
      {
        action: 'LOGIN_FAILED',
        entity: 'user',
        entityId: found?.id ?? null,
        after: { email },
        userId: found?.id ?? null,
      },
      req,
    );
    throw unauthenticated('Email or password is incorrect');
  }

  const user = await loadSessionUser(found.id);
  if (!user) throw unauthenticated('Email or password is incorrect');

  const session = await issueSession(user, crypto.randomUUID(), req);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit(db, { action: 'LOGIN', entity: 'user', entityId: user.id, userId: user.id }, req);
  return session;
}

/**
 * Rotate a refresh token. If a token that was already rotated is presented again,
 * someone may have stolen it: revoke the whole family and force a new sign-in.
 */
export async function refresh(presented: string | undefined, req: Request): Promise<IssuedSession> {
  if (!presented) throw unauthenticated();
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(presented)))
    .limit(1);
  if (!row) throw unauthenticated();

  if (row.revokedAt) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    await audit(
      db,
      {
        action: 'TOKEN_REUSE',
        entity: 'refresh_token',
        entityId: row.familyId,
        userId: row.userId,
      },
      req,
    );
    throw unauthenticated('Your session was signed out for security. Sign in again.');
  }
  if (row.expiresAt.getTime() <= Date.now())
    throw unauthenticated('Your session has expired. Sign in again.');

  const user = await loadSessionUser(row.userId);
  if (!user) throw unauthenticated();

  // Revoke-then-issue; the conditional update guarantees only one concurrent refresh wins.
  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  if (!revoked.length) throw unauthenticated();

  const session = await issueSession(user, row.familyId, req);
  await db
    .update(refreshTokens)
    .set({ replacedById: session.refreshId })
    .where(eq(refreshTokens.id, row.id));
  return session;
}

export async function logout(presented: string | undefined, req: Request): Promise<void> {
  if (!presented) return;
  const [row] = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, hashToken(presented)), isNull(refreshTokens.revokedAt)))
    .returning({ userId: refreshTokens.userId, familyId: refreshTokens.familyId });
  if (row) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    await audit(
      db,
      { action: 'LOGOUT', entity: 'user', entityId: row.userId, userId: row.userId },
      req,
    );
  }
}

export async function me(userId: string): Promise<SessionUser> {
  const user = await loadSessionUser(userId);
  if (!user) throw unauthenticated();
  return user;
}

/* ---------- My profile ---------- */

export async function updateOwnName(
  userId: string,
  fullName: string,
  req: Request,
): Promise<SessionUser> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId));
    await tx.update(users).set({ fullName, updatedAt: new Date() }).where(eq(users.id, userId));
    await audit(
      tx,
      { action: 'UPDATE', entity: 'user', entityId: userId, before, after: { fullName } },
      req,
    );
  });
  return me(userId);
}

/** Sets (or, with null, removes) my profile picture. */
export async function setOwnAvatar(
  userId: string,
  avatarUrl: string | null,
  req: Request,
): Promise<SessionUser> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ avatarUrl, updatedAt: new Date() }).where(eq(users.id, userId));
    await audit(
      tx,
      { action: 'UPDATE', entity: 'user', entityId: userId, after: { avatarUrl } },
      req,
    );
  });
  return me(userId);
}

/** True when the URL is someone's current avatar (the public avatar route serves only those). */
export async function isAvatar(url: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.avatarUrl, url), isNull(users.deletedAt)))
    .limit(1);
  return !!row;
}
