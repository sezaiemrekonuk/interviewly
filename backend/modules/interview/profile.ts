/**
 * `POST /interviews/:id/profile` — the `profiling → hr_round` transition (§3.3, §3.7).
 *
 * The request body carries layer 2 only: the per-interview pre-questions, or a skip. This
 * handler owns the merge with layer 1 (the account profile) and writes the result to
 * `interviews.candidate_profile` as a **snapshot**, not a join — editing a profile in March
 * must not change what a January report was reasoned from (ADR-A07).
 */
import type { RequestHandler } from 'express';
import { Prisma, type Interview } from '@prisma/client';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { withBudgetOrEnd } from './budget';
import { openRound } from './conductor';
import { generateRound } from './generation';
import { applyTransition } from './machine';

/** §3.3 layer 2. Every field optional — an answered form with one field is still an answer. */
const perInterviewSchema = z.object({
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
  interests: z.string().trim().max(2_000).optional(),
  targetSeniority: z.enum(['junior', 'mid', 'senior', 'lead']).optional(),
});

const bodySchema = z.union([
  z.object({ skip: z.literal(true) }),
  z.object({ perInterview: perInterviewSchema }),
]);

/**
 * Keys barred from the snapshot, in both casings.
 *
 * `date_of_birth` never crosses toward `ai` — an age in an evaluation prompt invites age bias
 * in the output (§3.3, §7.2). `PromptBuilder` strips it again and raises `PROFILE_DOB_STRIPPED`
 * if it ever sees one, but that alarm firing because of *this* path would be a bug here.
 *
 * `phone` is barred on the same principle: the profile screen collects it as contact detail for
 * the account, and a contact number has no bearing on an answer's quality. Nothing downstream
 * should have to be trusted not to quote it.
 *
 * `cv_text` is not dropped, it is lifted: it leaves as `cvText`, a sibling of `account`, so it
 * reaches the model in its own `<candidate_cv>` block instead of buried in the profile object.
 */
const DOB_KEYS = ['dateOfBirth', 'date_of_birth'];
const CONTACT_KEYS = ['phone'];
const CV_KEYS = ['cvText', 'cv_text'];

function accountLayer(profile: unknown): {
  account: Record<string, unknown> | undefined;
  cvText: string | undefined;
} {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { account: undefined, cvText: undefined };
  }

  const source = profile as Record<string, unknown>;
  const cv = CV_KEYS.map((k) => source[k]).find((v) => typeof v === 'string' && v.length > 0);

  const account: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (DOB_KEYS.includes(key) || CONTACT_KEYS.includes(key) || CV_KEYS.includes(key)) continue;
    account[key] = value;
  }

  return {
    account: Object.keys(account).length > 0 ? account : undefined,
    cvText: typeof cv === 'string' ? cv : undefined,
  };
}

/**
 * The §3.3 merge. Absent halves are omitted rather than stored as null, and a snapshot with
 * no halves at all is `null` — which is what makes the builder emit `no profile provided`
 * instead of an empty `<candidate_profile></candidate_profile>` block. A candidate with no
 * account profile, no CV and a skipped form is a supported interview, not a degraded one.
 */
export function mergeProfile(
  accountProfile: unknown,
  perInterview: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const { account, cvText } = accountLayer(accountProfile);
  const answered =
    perInterview && Object.keys(perInterview).length > 0 ? perInterview : undefined;

  const snapshot = {
    ...(account ? { account } : {}),
    ...(cvText ? { cvText } : {}),
    ...(answered ? { perInterview: answered } : {}),
  };
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

/**
 * The whole `profiling → hr_round` move: snapshot, index, transition, batch.
 *
 * Exported because `POST /resume` is the second door into it — an interview parked in
 * `profiling` (setup died between the create and this call, or history's Continue link landed
 * a candidate in a room the state cannot leave) has no other way out, and re-deriving the
 * snapshot merge or the `current_index = 1` seed there would let the two paths drift.
 */
export async function startHrRound(
  interview: Interview,
  userId: string,
  perInterview: Record<string, unknown> | undefined,
  ctx: { traceId: string },
): Promise<string> {
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { profile: true },
  });

  const updated = await prisma.interview.update({
    where: { id: interview.id },
    data: {
      // `DbNull`, not `JsonNull`: an interview with nothing to say about its candidate has a
      // NULL column, not a column holding the JSON literal `null`.
      candidate_profile: (mergeProfile(account.profile, perInterview) as Prisma.InputJsonObject) ??
        Prisma.DbNull,
      started_at: interview.started_at ?? new Date(),
      // The first HR question becomes current the moment the batch exists. `state.ts` leaves
      // this to I04/I06 on purpose — a room refreshed mid-interview reconstructs from it.
      current_index: 1,
    },
  });

  // Claim the transition atomically before generation. `applyTransition` uses a WHERE-guarded
  // updateMany so only the first concurrent request can advance the state; any duplicate
  // request fails with INVALID_STATE_TRANSITION before the LLM call is ever made.
  const state = await applyTransition(updated, 'hr_round', ctx);

  // I08's ceiling, on the first generation as well as the second (issue #98). This is the
  // larger of the two calls, so a budget that guarded only the tech batch was a ceiling with a
  // hole in it. An interview already out of budget here ends rather than 500ing.
  await withBudgetOrEnd(updated, () => generateRound(updated, 'hr', ctx), ctx);

  // C02 — the interviewer says hello. Best-effort on purpose: the batch is committed and the
  // room is usable without a greeting (it falls back to showing `currentQuestion`), so a
  // provider blip here must not turn a started interview into a 503. `openRound` is idempotent,
  // so the first real turn re-attempts it for free.
  try {
    await openRound(updated, ctx);
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId, interviewId: interview.id }, 'CONDUCTOR_OPEN_ROUND_FAILED');
  }

  return state;
}

export const submitProfile: RequestHandler = async (req, res) => {
  const interview = req.interview!;

  // Before the body is even read: from any state but `profiling` this is a no-op that must
  // create nothing, least of all an HR batch (question_generation.feature @AC-7).
  if (interview.state !== 'profiling') throw new ApiError('INVALID_STATE_TRANSITION');

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
  const perInterview = 'perInterview' in parsed.data ? parsed.data.perInterview : undefined;

  const state = await startHrRound(interview, req.user!.id, perInterview, {
    traceId: req.traceId!,
  });

  res.status(200).json({ state });
};

export default submitProfile;
