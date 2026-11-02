import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '@gs/shared';
import { isTest } from '../config/env';

const handler = (_req: Request, res: Response): void => {
  const body: ApiErrorBody = {
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a moment and try again.' },
  };
  res.status(429).json(body);
};

/** General API limit per IP. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 10_000 : 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/** Login attempts per IP + email. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${req.ip}:${String((req.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase()}`,
  skipSuccessfulRequests: true,
  handler,
});

/** "Ask AI" messages per signed-in user (each one is a paid Claude API call). */
export const assistantLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'anon',
  handler,
});
