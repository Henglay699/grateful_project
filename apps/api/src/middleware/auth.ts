import type { NextFunction, Request, Response } from 'express';
import { hasPermission, type Permission } from '@gs/shared';
import { verifyAccessToken } from '../modules/auth/tokens';
import { forbidden, unauthenticated } from '../lib/errors';

/** Requires a valid `Authorization: Bearer <access token>`. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return next(unauthenticated());
  try {
    req.auth = verifyAccessToken(header.slice(7));
    next();
  } catch {
    next(unauthenticated('Your session has expired. Sign in again.'));
  }
}

/** Requires the signed-in user's role to include every listed permission. */
export function requirePermission(...needed: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthenticated());
    const missing = needed.filter((p) => !hasPermission(req.auth!.permissions, p));
    if (missing.length) return next(forbidden(`Missing permission: ${missing.join(', ')}`));
    next();
  };
}
