// Subset of backend/src/lib/env.ts covering the keys the worker uses:
// DB/cache/storage access, mail send, LLM providers.
import { z } from 'zod';

/** Same literal-string boolean parsing as `backend/src/lib/env.ts` — see the note there. */
const boolFromEnv = (fallback: boolean) =>
  z.preprocess(
    (value) =>
      value === undefined || value === ''
        ? fallback
        : ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase()),
    z.boolean(),
  );

/**
 * Issue 71: `z.coerce.number()` alone turns a present-but-empty key — which is what every
 * unfilled `.env.example` line is — into 0, and a health server on port 0 binds a random
 * one the healthcheck can never reach. Same trap `emptyAsUnset` closes in the API's env.
 */
const portFromEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || String(value).trim() === '' ? fallback : value),
    z.coerce.number().int().positive(),
  );

const schema = z.object({
  NODE_ENV:                    z.enum(['development', 'production', 'test']).default('development'),
  // A04 — the mail job builds the verification/reset link, so the worker needs the same
  // browser-facing origin the API validates.
  PUBLIC_ORIGIN:               z.string().url(),
  DATABASE_URL:                z.string(),
  REDIS_URL:                   z.string(),
  // Issue 71 — the port `health.ts` serves `/healthz` on. Container-internal and never
  // published; compose's worker healthcheck is its only client.
  WORKER_HEALTH_PORT:          portFromEnv(4100),
  SMTP_HOST:                   z.string(),
  SMTP_PORT:                   z.coerce.number().default(1025),
  SMTP_USER:                   z.string().optional(),
  SMTP_PASSWORD:               z.string().optional(),
  MAIL_FROM:                   z.string(),
  OPENAI_API_KEY:              z.string().optional(),
  GEMINI_API_KEY:              z.string().optional(),
  S3_ENDPOINT:                 z.string().url(),
  S3_BUCKET:                   z.string(),
  S3_PUBLIC_PREFIX:            z.string().default('/assets'),
  S3_ACCESS_KEY:               z.string(),
  S3_SECRET_KEY:               z.string(),
  SIGNED_URL_TTL:              z.coerce.number().default(300),
  AI_ENABLED:                  boolFromEnv(true),
  BUDGET_USD_TEXT:             z.coerce.number().default(0.50),
  LOG_LEVEL:                   z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  LOG_TRANSPORT:               z.enum(['stdout', 'elastic']).default('stdout'),
  ELASTICSEARCH_URL:           z.string().optional(),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  const keys = result.error.issues.map(i => i.path.join('.')).join(', ');
  console.error(`ENV_VALIDATION_FAILED: missing or malformed keys: ${keys}`);
  process.exit(1);
}

export const config = result.data;
