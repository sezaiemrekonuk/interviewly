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

// `.default()` and `.optional()` only fire on `undefined`. A key that is PRESENT but empty
// (`FOO=` in .env, which is what every unfilled `.env.example` line is) parses as `""` and
// sails straight past both — `ELEVENLABS_TTS_MODEL=` would resolve to `""`, not the default.
// Issue #56 is that same empty-string-is-not-absent confusion one layer up, in `??`.
const emptyAsUnset = <T extends z.ZodType>(inner: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), inner);

const schema = z.object({
  NODE_ENV:                    z.enum(['development', 'production', 'test']).default('development'),
  PUBLIC_ORIGIN:               z.string().url(),
  API_PORT:                    z.coerce.number().default(4000),
  INTERNAL_API_URL:            z.string().url(),
  DATABASE_URL:                z.string(),
  SHADOW_DATABASE_URL:         z.string(),
  REDIS_URL:                   z.string().url(),
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
  // Optional in the shape, then required by the superRefine below whenever AI_ENABLED is on.
  // An empty string is not a configured key — issue #56's fix — but see the refine for why
  // that cannot be an unconditional min(1) here.
  ELEVENLABS_API_KEY:          emptyAsUnset(z.string().min(1).optional()),
  ELEVENLABS_TTS_MODEL:        emptyAsUnset(z.string().default('eleven_multilingual_v2')),
  ELEVENLABS_STT_MODEL:        emptyAsUnset(z.string().default('scribe_v1')),
  VOICE_MAX_ROUND_SECONDS:     z.coerce.number().default(720),
  VOICE_MAX_INTERVIEW_SECONDS: z.coerce.number().default(1500),
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
}).superRefine((env, ctx) => {
  // S01 asked for the key to be required "whenever voice mode can be selected", and that
  // qualifier is load-bearing in both directions.
  //
  // Unconditional `min(1)` breaks the keyless boot the repo documents and CI depends on:
  // `.env.example` ships AI_ENABLED=false precisely so a fresh clone — and the four CI jobs
  // that `cp .env.example .env` — start with no provider credentials at all, and index.ts:15
  // already skips the B7 provider-key check for the same reason.
  //
  // Dropping the requirement entirely puts issue #56 back: an empty string reaching the mint
  // as a real credential, failing at the first question instead of at boot.
  //
  // AI_ENABLED is the seam between the two. Voice cannot be selected while it is false —
  // voice_session.feature answers 503 VOICE_UNAVAILABLE before any provider call — so the
  // key is only a boot requirement when it is true.
  if (env.AI_ENABLED && !env.ELEVENLABS_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['ELEVENLABS_API_KEY'],
      message: 'required and non-empty when AI_ENABLED=true',
    });
  }
});

const result = schema.safeParse(process.env);
if (!result.success) {
  const keys = result.error.issues.map(i => i.path.join('.')).join(', ');
  console.error(`ENV_VALIDATION_FAILED: missing or malformed keys: ${keys}`);
  process.exit(1);
}

export const config = result.data;
