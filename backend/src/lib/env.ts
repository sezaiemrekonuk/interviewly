import { z } from 'zod';

import { isDeployed } from './deployment';

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
// Numbers need it as much as strings, and more sharply once they are wired to something:
// `SIGNED_URL_TTL=` coerces to 0, so a signed URL would expire in a second, `BUDGET_USD_TEXT=`
// would put every interview instantly over budget, and `MAX_INTERVIEWS_PER_USER_PER_DAY=`
// would let nobody start one. Harmless while the keys were dead (issue #117); not after.
const emptyAsUnset = <T extends z.ZodType>(inner: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), inner);

/** What every unrotated secret in `.env.example` starts with. See the SESSION_SECRET refine. */
export const PLACEHOLDER_PREFIX = 'change-me';

/**
 * Exported for the tests only. `config` below is the value every caller wants; the schema is
 * reachable so a rule can be asserted without booting a process that `process.exit(1)`s on the
 * failure it is trying to observe.
 */
export const schema = z.object({
  NODE_ENV:                    z.enum(['development', 'production', 'test']).default('development'),
  PUBLIC_ORIGIN:               z.string().url(),
  API_PORT:                    z.coerce.number().default(4000),
  INTERNAL_API_URL:            z.string().url(),
  DATABASE_URL:                z.string(),
  SHADOW_DATABASE_URL:         z.string(),
  REDIS_URL:                   z.string().url(),
  SESSION_SECRET:              z.string().min(32),
  SESSION_TTL_DAYS:            emptyAsUnset(z.coerce.number().default(7)),
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
  // MinIO ignores the region entirely; real S3 fails at request time on a wrong one.
  // The default must stay in step with prisma/seed.ts, which reads process.env by design.
  S3_REGION:                   z.string().default('us-east-1'),
  SIGNED_URL_TTL:              emptyAsUnset(z.coerce.number().default(300)),
  // Hop count passed to Express `trust proxy`. Default 1 = one Caddy hop in front of the
  // API. Set to `false` (or `0`) when running the API directly without the edge proxy — i.e.
  // in the dev compose where port 4000 is exposed — so clients cannot spoof X-Forwarded-For.
  // Named presets ('loopback', 'linklocal', 'uniquelocal') and CIDR ranges are also accepted.
  TRUST_PROXY:                 emptyAsUnset(z.string().default('1')),
  AI_ENABLED:                  zBoolean(true),
  // C02 raised this from 0.50. The conductor spends per *utterance* with the conversation
  // replayed, not per question, so the cost of an interview now scales with how much the
  // candidate says rather than with how many questions were planned. At 0.50 a talkative
  // candidate hit `withBudgetOrEnd` mid-sentence and the interview ended on them — a ceiling
  // that used to be unreachable in practice became the normal way an interview finished.
  BUDGET_USD_TEXT:             emptyAsUnset(z.coerce.number().default(1.50)),
  // C02 — the hard drift ceiling, in candidate utterances against one question. `mayProbe`
  // spends the last one on closing the question rather than on another probe, so at 3 the
  // candidate answers, gets at most one follow-up, and the round moves on. It was 4, which
  // bought three follow-ups per question and put a six-question interview well over its
  // twenty minutes.
  CONDUCTOR_MAX_TURNS_PER_QUESTION: emptyAsUnset(z.coerce.number().int().positive().default(3)),
  // The whole-interview backstop, in utterances. `budget_usd` is the real ceiling; this one
  // exists because a provider that answers cheaply and wrongly can burn a long time without
  // ever tripping a dollar limit.
  CONDUCTOR_MAX_TURNS:         emptyAsUnset(z.coerce.number().int().positive().default(80)),
  MAX_INTERVIEWS_PER_USER_PER_DAY: emptyAsUnset(z.coerce.number().default(5)),
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

  // Issue #118: the `.env.example` placeholder is exactly 32 characters, so `min(32)` above
  // cannot tell it from a real secret and the live `.env` carried it byte for byte. Scoped to
  // deployments for the same reason the rule above is scoped to AI_ENABLED: `cp .env.example
  // .env` is the documented first boot and what all three CI jobs do, so refusing it
  // everywhere would fail them by construction.
  //
  // `isDeployed` rather than `NODE_ENV === 'production'`, per review on #268: the incident was
  // `.env.example` shipped whole, and its own `NODE_ENV=development` would ship with it — a
  // gate reading only that key would miss the exact accident it exists for.
  if (isDeployed(env.NODE_ENV, env.PUBLIC_ORIGIN) && env.SESSION_SECRET.startsWith(PLACEHOLDER_PREFIX)) {
    ctx.addIssue({
      code: 'custom',
      path: ['SESSION_SECRET'],
      message: 'still the .env.example placeholder — set a real secret before deploying',
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
