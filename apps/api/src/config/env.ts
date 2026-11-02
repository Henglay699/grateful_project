import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * The project folder (where pnpm-workspace.yaml lives). Relative paths in .env such as
 * UPLOAD_DIR and WEB_DIST_DIR are resolved from here, whether the API was started by
 * `pnpm dev` (from apps/api) or `pnpm start` (from the project root).
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return start;
    dir = up;
  }
}
export const repoRoot = findRepoRoot(process.cwd());
export const fromRoot = (p: string) => path.resolve(repoRoot, p);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(14),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  UPLOAD_DIR: z.string().default('./storage'),
  BUSINESS_TIMEZONE: z.string().default('Asia/Phnom_Penh'),
  SEED_DEFAULT_PASSWORD: z.string().min(10).optional(),
  /** Production: folder with the built website (apps/web/dist) to serve from this same process. */
  WEB_DIST_DIR: z.string().optional(),
  /** "Ask AI" assistant. Unset AI_PROVIDER = whichever provider has a key (Claude first). */
  AI_PROVIDER: z.preprocess((v) => v || undefined, z.enum(['anthropic', 'gemini']).optional()),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-flash-lite-latest'),
  /** Used when GEMINI_MODEL is overloaded. */
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-flash-latest'),
  /** Fetch the official USD→KHR rate from the MEF open-data API on a schedule. */
  EXCHANGE_RATE_SYNC: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  EXCHANGE_RATE_API_URL: z
    .string()
    .url()
    .default('https://data.mef.gov.kh/api/v1/realtime-api/exchange-rate?currency_id=USD'),
  /** Fetch Ministry of Commerce retail fuel prices from the MEF open-data API on a schedule. */
  FUEL_PRICE_SYNC: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  FUEL_PRICE_API_URL: z
    .string()
    .url()
    .default(
      'https://data.mef.gov.kh/api/v1/public-datasets/pd_681d89b4dbc953000126f5e7/json?page=1&page_size=30',
    ),
  /** Fetch gold / silver / platinum spot prices (gold-api.com, free, no key) on a schedule. */
  METAL_PRICE_SYNC: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Base URL; the metal symbol is appended (…/price/XAU). */
  METAL_PRICE_API_URL: z.string().url().default('https://api.gold-api.com/price'),
  /** Team chat messages (and their files) older than this many days are deleted; 0 keeps them. */
  CHAT_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(7),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(
      `Invalid environment configuration:\n${issues}\nCopy .env.example to .env and fill it in.`,
    );
    process.exit(1);
  }
  const e = parsed.data;
  // Refuse to run production with the example secret or a weak one.
  if (e.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (
      /replace_with|dev_only|change_me|example/i.test(e.JWT_ACCESS_SECRET) ||
      e.JWT_ACCESS_SECRET.length < 40
    )
      problems.push(
        'JWT_ACCESS_SECRET must be a new random value of at least 40 characters (see DEPLOY.md)',
      );
    if (/change_me|gs_dev_password/i.test(e.DATABASE_URL))
      problems.push('DATABASE_URL still uses the example database password');
    if (problems.length) {
      // eslint-disable-next-line no-console
      console.error(`Production configuration is not safe:\n  - ${problems.join('\n  - ')}`);
      process.exit(1);
    }
  }
  return e;
}

export const env = loadEnv();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
