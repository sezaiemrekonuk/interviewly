import { z } from 'zod';

// z.coerce.boolean() runs JS's Boolean(string), which is true for ANY non-empty string —
// including the literal text "false". Every boolean env key in this schema needs this,
// not the coercer, or `EMAIL_VERIFICATION_REQUIRED=false` / `AI_ENABLED=false` in .env
// silently turn the flag on. Found via I03's acceptance run (question_generation.feature).
const zBoolean = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v === 'true'));

const schema = z.object({
  NODE_ENV:                    z.enum(['development', 'production', 'test']).default('development'),
  PUBLIC_ORIGIN:               z.string().url(),
  API_PORT:                    z.coerce.number().default(4000),
  INTERNAL_API_URL:            z.string().url(),
  DATABASE_URL:                z.string(),
  SHADOW_DATABASE_URL:         z.string(),
  REDIS_URL:                   z.string(),
  SESSION_SECRET:              z.string().min(32),
  SESSION_TTL_DAYS:            z.coerce.number().default(7),
  SESSION_COOKIE_SECURE:       zBoolean(true),
  GOOGLE_CLIENT_ID:            z.string().optional(),
  GOOGLE_CLIENT_SECRET:        z.string().optional(),
  // K8.6 — config, not behaviour: one gate reads this flag (§11.3)
  EMAIL_VERIFICATION_REQUIRED: zBoolean(false),
  EMAIL_VERIFY_TTL_HOURS:      z.coerce.number().default(24),
  PASSWORD_RESET_TTL_MINUTES:  z.coerce.number().default(60),
  SMTP_HOST:                   z.string(),
  SMTP_PORT:                   z.coerce.number().default(1025),
  // Legitimately empty against the dev sink — a required-but-blank credential
  // would fail a clean boot for no security gain.
  SMTP_USER:                   z.string().optional(),
  SMTP_PASSWORD:               z.string().optional(),
  MAIL_FROM:                   z.string(),
  OPENAI_API_KEY:              z.string().optional(),
  GEMINI_API_KEY:              z.string().optional(),
  ELEVENLABS_API_KEY:          z.string().optional(),
  ELEVENLABS_AGENT_ID_HR:      z.string().optional(),
  ELEVENLABS_AGENT_ID_TECH:    z.string().optional(),
  ELEVENLABS_WEBHOOK_SECRET:   z.string().optional(),
  VOICE_MAX_ROUND_SECONDS:     z.coerce.number().default(720),
  VOICE_MAX_INTERVIEW_SECONDS: z.coerce.number().default(1500),
  // Gate 2's replay window (§3.5). Skew is measured in both directions, so this is a
  // half-width: 300 tolerates ordinary clock drift without holding a captured body replayable.
  VOICE_WEBHOOK_FRESHNESS_SECONDS: z.coerce.number().default(300),
  S3_ENDPOINT:                 z.string().url(),
  S3_BUCKET:                   z.string(),
  S3_PUBLIC_PREFIX:            z.string().default('/assets'),
  S3_ACCESS_KEY:               z.string(),
  S3_SECRET_KEY:               z.string(),
  SIGNED_URL_TTL:              z.coerce.number().default(300),
  AI_ENABLED:                  zBoolean(true),
  BUDGET_USD_TEXT:             z.coerce.number().default(0.50),
  MAX_INTERVIEWS_PER_USER_PER_DAY: z.coerce.number().default(5),
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
