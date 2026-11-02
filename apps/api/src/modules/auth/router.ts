import { Router, type Response } from 'express';
import multer from 'multer';
import {
  changePasswordSchema,
  loginInputSchema,
  profileUpdateSchema,
  type AuthResponse,
} from '@gs/shared';
import { changeOwnPassword } from '../staff/service';
import { env } from '../../config/env';
import { parse } from '../../lib/validate';
import { badRequest, notFound } from '../../lib/errors';
import { fileExists, putFile, readFile } from '../../lib/storage';
import { contentMatchesExtension } from '../documents/router';
import { requireAuth } from '../../middleware/auth';
import { loginLimiter } from '../../middleware/rateLimit';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './tokens';
import * as auth from './service';

function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  const input = parse(loginInputSchema, req.body);
  const s = await auth.login(input.email, input.password, req);
  setRefreshCookie(res, s.refreshToken, s.refreshExpiresAt);
  const body: AuthResponse = { accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user };
  res.json(body);
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const s = await auth.refresh(req.cookies?.[REFRESH_COOKIE] as string | undefined, req);
    setRefreshCookie(res, s.refreshToken, s.refreshExpiresAt);
    const body: AuthResponse = { accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user };
    res.json(body);
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined, req);
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await auth.me(req.auth!.userId) });
});

/** Change my own password; my other sessions are signed out. */
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const v = parse(changePasswordSchema, req.body);
  await changeOwnPassword(
    v.currentPassword,
    v.newPassword,
    req.cookies?.[REFRESH_COOKIE] as string | undefined,
    req,
  );
  res.status(204).end();
});

/* ---------- My profile (any signed-in user) ---------- */

/** Change my display name. */
authRouter.patch('/me', requireAuth, async (req, res) => {
  const { fullName } = parse(profileUpdateSchema, req.body);
  res.json({ user: await auth.updateOwnName(req.auth!.userId, fullName, req) });
});

const AVATAR_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    /\.(png|jpe?g|webp)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(badRequest('Use a PNG, JPG or WEBP picture')),
}).single('file');

/** Upload my profile picture (PNG / JPG / WEBP, up to 2 MB). */
authRouter.post('/me/avatar', requireAuth, avatarUpload, async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('Choose a picture to upload');
  if (!contentMatchesExtension(file.originalname, file.buffer))
    throw badRequest('That file is not a valid picture');
  const { key } = await putFile(file.buffer, file.originalname);
  res.json({
    user: await auth.setOwnAvatar(req.auth!.userId, `/api/v1/auth/avatars/${key}`, req),
  });
});

/** Remove my profile picture (back to initials). */
authRouter.delete('/me/avatar', requireAuth, async (req, res) => {
  res.json({ user: await auth.setOwnAvatar(req.auth!.userId, null, req) });
});

/**
 * Profile pictures, readable by <img> without a token. Only files that are a user's current
 * avatar are served, so this can't be used to read uploaded documents.
 */
authRouter.get(/^\/avatars\/(\d{4}\/\d{2}\/[0-9a-f-]{36}\.(png|jpe?g|webp))$/, async (req, res) => {
  const key = (req.params as Record<string, string>)[0]!;
  const ext = key.split('.').pop()!;
  if (!(await auth.isAvatar(`/api/v1/auth/avatars/${key}`)) || !(await fileExists(key)))
    throw notFound('Picture');
  res.setHeader('Content-Type', AVATAR_TYPES[ext]!);
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  readFile(key).pipe(res);
});
