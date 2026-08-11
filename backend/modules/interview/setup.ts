import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';

import { aiClient } from '../ai';
import { recordHit } from '../auth/rate-limit';

import { applyTransition } from './machine';
import { DAILY_INTERVIEW_PREFIX, DAILY_INTERVIEW_WINDOW_MS } from './rate-limit';

// Per-round ceilings: HR maxes out at 5, technical at 13. The overall ceiling is their sum —
// tighter than the DB's own `target_question_count` CHECK (1..20), so this is an application
// tightening within that range and needs no migration. Mirrored below in `split()`'s clamp and
// in `shape()`'s custom-shape check so neither path can produce a round past its cap.
const MAX_HR_QUESTION_COUNT = 5;
const MAX_TECH_QUESTION_COUNT = 13;
const MAX_TARGET_QUESTION_COUNT = MAX_HR_QUESTION_COUNT + MAX_TECH_QUESTION_COUNT;

// The floor `split()` already assumes. Its HR half is `max(2, …)`, so a target of 1 made
// `techCount` negative — a round size the generator then asks the provider for (issue #176).
// 2 rather than 3: `machine.ts` carries `hr_round → evaluating` precisely so `target 2 → hr 2,
// tech 0` can end, and that shape must stay reachable. Mirrored as a CHECK constraint relating
// `hr_question_count` to `target_question_count` so a direct insert cannot bypass it.
const MIN_TARGET_QUESTION_COUNT = 2;

const schema = z.object({
  // S08: voice is the product's default, so a body that names no mode gets it. Text stays
  // explicitly selectable — the downgrade is one-directional (§3.8), so a candidate who cannot
  // speak must be able to say so before the interview starts, not after.
  mode: z.enum(['voice', 'text']).default('voice'),
  // The chosen voice length. Absent is the normal case and means "the platform ceiling".
  // The upper bound is checked in the handler, not here: it is config, and a `.max()` read at
  // module load would bake in whatever `VOICE_MAX_INTERVIEW_SECONDS` held at import time.
  durationSeconds: z.coerce.number().int().positive().optional(),
  jobText: z.string().trim().min(1).optional(),
  uploadId: z.string().min(1).optional(),
  targetQuestionCount: z.coerce
    .number()
    .int()
    .min(MIN_TARGET_QUESTION_COUNT)
    .max(MAX_TARGET_QUESTION_COUNT),
  // The custom shape: the caller sizes the HR half itself instead of taking the 40/60 split.
  // Absent is the normal case and the only one the preset lengths ever send.
  hrQuestionCount: z.coerce.number().int().min(1).max(MAX_HR_QUESTION_COUNT).optional(),
});

// Keyword → seeded occupation_clusters.key (prisma/seed.ts OCCUPATION_CLUSTERS). First
// matching keyword wins; unmatched listing leaves occupation_cluster_id null (valid).
// English and Turkish keywords per cluster — Turkish is the product's primary market, so a
// Turkish listing must resolve to a cluster too, not fall through to null (issue #149).
// Keywords are stored with their natural diacritics; `fold` normalises both sides before the
// compare, so a caps-lock listing ("YAZILIM") still matches "yazılım".
// A trailing `*` marks a Turkish stem (root + up to five suffix letters), so "mühendis*"
// catches the inflected "mühendisi"/"mühendisler". No `*` = whole-word match. Short/ambiguous
// roots stay `*`-free or go multi-word so a stem can't over-match: bare "sales" (not
// "salesforce"), "data scien*" (not "database").
// ponytail: flat keyword list, no scoring/ranking — promote if misclassification shows up.
const OCCUPATION_KEYWORDS: Array<[key: string, words: string[]]> = [
  // data_science and design precede software_engineering on purpose: "mühendis*"/"engineer*"
  // are broad enough to swallow "Veri Mühendisi", so the narrower clusters must win first-match.
  ['data_science', ['data scien*', 'data analyst*', 'machine learning', 'analytics', 'veri bilim*', 'veri analist*', 'veri mühendis*']],
  ['design', ['designer*', 'ux', 'ui/ux', 'tasarımcı*', 'arayüz tasarım*']],
  ['software_engineering', ['engineer*', 'developer*', 'programmer', 'devops', 'sre', 'geliştirici*', 'yazılım*', 'mühendis*']],
  ['product_management', ['product manager', 'product owner', 'ürün müdürü', 'ürün yöneticisi']],
  ['marketing', ['marketing', 'growth', 'seo', 'pazarlama*']],
  ['sales', ['sales', 'account executive', 'business development', 'satış*']],
  ['finance', ['finance', 'accountant', 'financial analyst', 'controller', 'finans']],
  ['operations', ['operations', 'logistics', 'supply chain', 'operasyon', 'lojistik']],
  ['hr', ['human resources', 'recruiter', 'talent acquisition', 'insan kaynakları']],
];

const OCCUPATION_TITLE_MAX = 80;

// Up to five suffix letters after a Turkish stem — enough for "-lar"/"-leri"/"-sında" etc.
const SUFFIX = '[a-z]{0,5}';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case- and diacritic-insensitive fold for keyword matching. `toLowerCase()` alone breaks
// Turkish: "YAZILIM" → "yazilim" (dotted i), "İ" → "i̇" (i + combining dot) — neither equals
// the dotless-ı keyword. NFD + strip handles ş/ğ/ü/ö/ç; ı needs an explicit map (no decomp).
// Whitespace is collapsed so a multi-word keyword survives a newline/double space in the body.
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ');
}

// A `*`-terminated keyword compiles to stem + bounded suffix; every other keyword is a whole
// word. \b works because `fold` reduces both sides to ASCII, so [a-z] covers every suffix.
function toPattern(kw: string): RegExp {
  const stem = kw.endsWith('*');
  const body = esc(fold(stem ? kw.slice(0, -1) : kw));
  return new RegExp(`\\b${body}${stem ? SUFFIX : ''}\\b`);
}

// Compiled once at load, not rebuilt per classify() call.
const OCCUPATION_PATTERNS = OCCUPATION_KEYWORDS.map(
  ([key, kws]) => [key, kws.map(toPattern)] as const,
);

// Human-readable title: the listing's first non-empty line, trimmed and capped at a word
// boundary with an ellipsis. Never the matched keyword, never a blind mid-word slice — the
// title is the interview's label everywhere (history list, delete aria-label, report header).
function titleFromListing(jobText: string): string {
  const firstLine = jobText.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  if (firstLine.length <= OCCUPATION_TITLE_MAX) return firstLine;
  const capped = firstLine.slice(0, OCCUPATION_TITLE_MAX);
  const lastSpace = capped.lastIndexOf(' ');
  const truncated = lastSpace > 0 ? capped.slice(0, lastSpace).trimEnd() : capped;
  return `${truncated}…`;
}

export function classify(jobText: string): { occupation: string; clusterKey: string | null } {
  const t = fold(jobText);
  // TODO(#149): "Makine/İnşaat Mühendisi" still resolves to software_engineering — the broad
  // "mühendis*"/"engineer*" stem can't tell disciplines apart. Pre-existing; not fixed here.
  const clusterKey = OCCUPATION_PATTERNS.find(([, ps]) => ps.some((p) => p.test(t)))?.[0] ?? null;
  return { occupation: titleFromListing(jobText), clusterKey };
}

// hrCount = max(2, round(target * 0.4)), clamped to MAX_HR_QUESTION_COUNT so the automatic
// split never needs the technical side to absorb more than MAX_TECH_QUESTION_COUNT — checked
// for every target in [MIN_TARGET_QUESTION_COUNT, MAX_TARGET_QUESTION_COUNT] since the two caps
// sum to the overall ceiling. techCount = target - hrCount (non-negotiable split otherwise).
function split(target: number): { hrCount: number; techCount: number } {
  const hrCount = Math.min(Math.max(2, Math.round(target * 0.4)), MAX_HR_QUESTION_COUNT);
  return { hrCount, techCount: target - hrCount };
}

/**
 * The split, or the caller's own. An explicit `hrQuestionCount` must leave at least one
 * question for the technical round: both rounds are generated, and a batch of zero is a
 * provider call that asks for nothing and a round with no question to promote. The technical
 * remainder gets its own cap check here — the schema only bounds `hrQuestionCount`, so a large
 * target with a small custom `hr` could otherwise push `techCount` past MAX_TECH_QUESTION_COUNT.
 */
function shape(target: number, hr: number | undefined): { hrCount: number; techCount: number } {
  if (hr === undefined) return split(target);
  if (hr >= target) throw new ApiError('VALIDATION_ERROR');
  const techCount = target - hr;
  if (techCount > MAX_TECH_QUESTION_COUNT) throw new ApiError('VALIDATION_ERROR');
  return { hrCount: hr, techCount };
}

/**
 * ADR-ADD03 — the gate. Runs after the row exists because `llm_calls.interview_id` is NOT NULL:
 * the check is a provider call like any other and has to be auditable, and there is no
 * interview to hang it on until `create` has returned.
 *
 * Fail-open on a provider failure, and only on one. Refusing every interview because the screen
 * is unreachable trades a soft content check for an outage, and the listing still crosses the
 * §7.1 boundary as a bound value on every call that reads it. A check that came back and said
 * "not a listing" is honoured.
 */
async function checkListing(
  interviewId: string,
  jobText: string,
  fallbackLanguage: string,
  traceId: string,
): Promise<{ ok: boolean; language: string }> {
  try {
    const check = await aiClient().validateListing({
      jobListing: jobText,
      ctx: { interviewId, traceId },
    });
    return { ok: check.is_job_listing, language: check.language };
  } catch (err) {
    logger.warn({
      event: 'LISTING_CHECK_UNAVAILABLE',
      interviewId,
      traceId,
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return { ok: true, language: fallbackLanguage };
  }
}

async function titleInterview(
  interviewId: string,
  jobText: string,
  language: string,
  traceId: string,
): Promise<void> {
  try {
    const { title } = await aiClient().generateInterviewTitle({
      jobListing: jobText,
      language,
      ctx: { interviewId, traceId },
    });
    await prisma.interview.update({ where: { id: interviewId }, data: { occupation: title } });
    logger.info({ event: 'INTERVIEW_TITLE_GENERATED', interviewId, traceId });
  } catch (err) {
    logger.warn({
      event: 'INTERVIEW_TITLE_FALLBACK',
      interviewId,
      traceId,
      reason: err instanceof Error ? err.message : 'unknown',
    });
  }
}

export const setupInterview: RequestHandler = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
  const { mode, jobText, uploadId, targetQuestionCount, hrQuestionCount, durationSeconds } =
    parsed.data;

  // Refused, never clamped (S08): a clamped value is a lie about what the candidate asked for,
  // and a trusted one is uncapped provider spend. Server-side because the form's option list is
  // advisory — `isPastSpeechCeiling` measures against whatever lands in the column.
  if (durationSeconds !== undefined && durationSeconds > config.VOICE_MAX_INTERVIEW_SECONDS) {
    throw new ApiError('VALIDATION_ERROR');
  }

  if (!jobText && !uploadId) throw new ApiError('LISTING_REQUIRED');
  // `POST /uploads` answers a listing with its extracted text (I11's handoff), so a caller
  // holding an uploadId holds the text too. Without it there is nothing to store in the NOT
  // NULL job_text column and nothing to write questions from.
  if (!jobText) throw new ApiError('VALIDATION_ERROR');

  // Issue #73: `uploadId` is the one id in this module that arrives in a body rather than as
  // `:id`, so `ownership.ts` never sees it. Unchecked, a foreign id attached another user's
  // upload to this interview and a bogus one reached the FK as a 500. Same reasoning as
  // ownership.ts: not-owned and not-found answer identically, so neither confirms the other.
  // `kind` is in the same query — a CV is not a job listing.
  if (uploadId) {
    const upload = await prisma.upload.findFirst({
      where: { id: uploadId, user_id: req.user!.id, kind: 'listing' },
      select: { id: true },
    });
    if (!upload) throw new ApiError('VALIDATION_ERROR');
  }

  const { occupation, clusterKey } = classify(jobText);
  const cluster = clusterKey
    ? await prisma.occupationCluster.findUnique({ where: { key: clusterKey } })
    : null;
  const { hrCount, techCount } = shape(targetQuestionCount, hrQuestionCount);

  // A transaction would NOT close the window between the read above and this insert: under
  // Read Committed a concurrent DELETE still commits in between, and only `SELECT … FOR SHARE`
  // on `uploads` would block it — a row lock on every setup for a race `delete-account.ts:86`
  // is the sole source of. Catching the violation costs nothing and answers it as what it is.
  // The upload FK only: a P2003 on user_id or the cluster is a different bug and stays a 500.
  const interview = await prisma.interview
    .create({
      data: {
        user_id: req.user!.id,
        mode,
        job_text: jobText,
        job_source: uploadId ? 'upload' : 'paste',
        upload_id: uploadId ?? null,
        occupation,
        occupation_cluster_id: cluster?.id ?? null,
        language: req.user!.locale,
        target_question_count: targetQuestionCount,
        hr_question_count: hrCount,
        max_duration_seconds: durationSeconds ?? null,
        // The declared knob, not the column default that shadowed it (issue #117). The
        // default stays as the floor for rows created outside the API — seeds, fixtures.
        budget_usd: config.BUDGET_USD_TEXT,
        // Born `created`, moved by the guard in the same request. Inserting straight into
        // `profiling` would be one write fewer and the only state change in the system that
        // emits no `INTERVIEW_STATE_CHANGED` (@AC-16 lists this edge).
        state: 'created',
        current_index: 0,
      },
    })
    .catch((err: unknown) => {
      const e = err as { code?: string; meta?: { constraint?: string } } | null;
      // Prisma 6 reports the FK as `meta.constraint` — the older `field_name` is not emitted
      // here (checked against the real table, not assumed).
      if (e?.code === 'P2003' && e.meta?.constraint === 'interviews_upload_id_fkey') {
        throw new ApiError('VALIDATION_ERROR');
      }
      throw err;
    });

  // ADR-ADD03. Before the quota is charged and before anything is generated from the text: a
  // refused listing must cost the candidate neither one of their five nor a round of questions.
  // The row it needed is soft-deleted rather than dropped — every FK here is ON DELETE RESTRICT,
  // and the `llm_calls` row the check itself wrote points at it.
  const check = await checkListing(interview.id, jobText, req.user!.locale, req.traceId!);
  if (!check.ok) {
    await prisma.interview.update({
      where: { id: interview.id },
      data: { deleted_at: new Date() },
    });
    logger.warn({ event: 'LISTING_REJECTED', interviewId: interview.id, traceId: req.traceId });
    throw new ApiError('LISTING_NOT_A_JOB');
  }

  // The interview runs in the language of the listing, not of the account (ADR-ADD03). A
  // Turkish listing read by an account left on English produced English questions about a
  // Turkish role, and the candidate's only fix was a locale switch they could not find.
  const language = check.language;
  if (language !== interview.language) {
    await prisma.interview.update({ where: { id: interview.id }, data: { language } });
    interview.language = language;
    logger.info({
      event: 'LANGUAGE_SET_FROM_LISTING',
      interviewId: interview.id,
      traceId: req.traceId,
      language,
    });
  }

  // The daily quota is charged here, not in the middleware: the row exists, so this is the
  // first moment the user has actually spent one of their five (issue #116). Everything
  // after this point either succeeds or leaves an interview they can resume, so there is no
  // later checkpoint that would be more honest.
  try {
    await recordHit(DAILY_INTERVIEW_PREFIX, req.user!.id, DAILY_INTERVIEW_WINDOW_MS);
  } catch (err) {
    logger.warn(
      { traceId: req.traceId, userId: req.user!.id, reason: err instanceof Error ? err.message : 'unknown' },
      'DAILY_LIMIT_RECORD_FAILED',
    );
  }
  await titleInterview(interview.id, jobText, language, req.traceId!);

  await applyTransition(interview, 'profiling', { traceId: req.traceId! });

  res.status(201).json({ interviewId: interview.id, hrCount, techCount });
};

export default setupInterview;
