import fs from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit does not read .env by itself (needed for `pnpm db:studio`).
if (!process.env.DATABASE_URL && fs.existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
