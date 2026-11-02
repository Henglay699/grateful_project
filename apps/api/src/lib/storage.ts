import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env, fromRoot } from '../config/env';

/**
 * File storage on the server's disk (UPLOAD_DIR). Keys look like "2026/10/<uuid>.pdf";
 * every path is resolved inside the root so a key can never escape it.
 * Swap this module for an S3 implementation later without touching callers.
 */
const root = fromRoot(env.UPLOAD_DIR);

function resolveKey(key: string): string {
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export async function putFile(
  buffer: Buffer,
  originalName: string,
): Promise<{ key: string; sha256: string }> {
  const ext = path
    .extname(originalName)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, '')
    .slice(0, 10);
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}${ext}`;
  const full = resolveKey(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buffer, { flag: 'wx' });
  return { key, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

export function readFile(key: string): fs.ReadStream {
  return fs.createReadStream(resolveKey(key));
}

/** Remove a stored file; a file that's already gone is fine. */
export async function deleteFile(key: string): Promise<void> {
  await fs.promises.rm(resolveKey(key), { force: true });
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    await fs.promises.access(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}
