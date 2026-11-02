#!/usr/bin/env node
/**
 * pnpm backup — back up the database and uploaded files. Works on Windows and Linux.
 *
 *   BACKUP_DIR        where to write (default ./backups) — put this on another disk or a synced folder
 *   BACKUP_KEEP_DAYS  delete database dumps older than this (default 30)
 *   PG_BIN            folder containing pg_dump if it isn't on PATH
 *                     (Windows default: C:\Program Files\PostgreSQL\<version>\bin is detected)
 *
 * Output: gs-db-YYYYMMDD-HHmm.dump (pg_dump custom format) and uploads/ (mirror of UPLOAD_DIR).
 * Restore: see DEPLOY.md → "Restore from a backup".
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fail = (msg) => {
  console.error(`✖ Backup failed: ${msg}`);
  process.exit(1);
};

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) fail('DATABASE_URL is not set (run from the project folder: pnpm backup)');
const url = new URL(dbUrl);
const backupDir = path.resolve(process.env.BACKUP_DIR || 'backups');
const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 30);
// Relative paths are relative to the project folder, exactly as the API resolves them.
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'apps/api/storage');

function findPgDump() {
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  if (process.platform === 'win32') {
    for (const v of [18, 17, 16, 15]) {
      const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`;
      if (fs.existsSync(p)) return p;
    }
  }
  return exe; // rely on PATH
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
fs.mkdirSync(backupDir, { recursive: true });
const dumpFile = path.join(backupDir, `gs-db-${stamp}.dump`);

// 1) Database (password passed via environment, never on the command line).
const res = spawnSync(
  findPgDump(),
  [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${dumpFile}`,
    `--host=${url.hostname}`,
    `--port=${url.port || 5432}`,
    `--username=${decodeURIComponent(url.username)}`,
    url.pathname.slice(1),
  ],
  {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
if (res.error)
  fail(`could not run pg_dump (${res.error.message}). Set PG_BIN to PostgreSQL's bin folder.`);
if (res.status !== 0) fail(`pg_dump exited with code ${res.status}`);
const dbSize = fs.statSync(dumpFile).size;

// 2) Uploaded files: stored under unique names and never modified, so copying new ones is enough.
let copied = 0;
const mirror = (from, to) => {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) mirror(src, dst);
    else if (entry.name !== '.gitkeep' && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      copied++;
    }
  }
};
mirror(uploadDir, path.join(backupDir, 'uploads'));

// 3) Retention for database dumps.
const cutoff = Date.now() - keepDays * 86_400_000;
let removed = 0;
for (const f of fs.readdirSync(backupDir)) {
  if (/^gs-db-.*\.dump$/.test(f) && fs.statSync(path.join(backupDir, f)).mtimeMs < cutoff) {
    fs.rmSync(path.join(backupDir, f));
    removed++;
  }
}

console.log(
  `✔ Backup done: ${path.basename(dumpFile)} (${(dbSize / 1024 / 1024).toFixed(1)} MB), ${copied} new uploaded file(s), ${removed} old dump(s) removed → ${backupDir}`,
);
