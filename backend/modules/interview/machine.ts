/**
 * The K2 transition guard (§8.3, ADR-I07). Complete as of I07.
 *
 * Every state change goes through `applyTransition`, so `INTERVIEW_STATE_CHANGED` cannot be
 * emitted without the edge having been checked, and an unlisted edge is a 409 rather than a
 * silently written column. Nothing else in the codebase writes `interviews.state`.
 */
import type { Interview, InterviewState } from '@prisma/client';

import { ApiError } from '../../src/lib/api-error';
import { recordAudit } from '../../src/lib/audit';
import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { clearLanguageStreak } from './language';
import { enqueueReport, publishStateChanged } from './sse';

const TRANSITIONS: Partial<Record<InterviewState, InterviewState[]>> = {
  created: ['profiling'],
  profiling: ['hr_round', 'abandoned'],
  // `hr_round → evaluating` is not a shortcut: the split can leave a short interview with
  // zero technical questions (target 2 → hr 2, tech 0), and that interview still ends. I08
  // attaches its budget-exhaustion edge to the same two targets.
  hr_round: ['tech_round', 'evaluating', 'paused', 'abandoned'],
  // `tech_round → abandoned` closes the one round a candidate could not leave (#104). The
  // round they are most likely to walk out of is the last one, and without this edge neither
  // the leave button nor the worker's stale sweep could end it.
  tech_round: ['evaluating', 'abandoned'],
  // No `tech_round → paused`: the only pause source is a failed generation, and ADR-I22 puts
  // both batches inside the HR round. Add the edge with the source that needs it.
  paused: ['hr_round', 'abandoned'],
  evaluating: ['completed', 'failed'],
  // Operational recovery only (issue 081), and the reason `→ evaluating` is no longer a
  // one-way door. A report job that is lost after the interview has already left `evaluating`
  // — a crash between the transition and the report write (the `ponytail:` note in
  // `report-run.ts`), or a dead-letter — cannot be re-driven by re-adding a job: `runReport`
  // uses `evaluating → completed` as its CAS and would throw before writing anything. So the
  // way back has to be the state, and re-entering `evaluating` is what fires `enqueueReport`
  // below for free.
  //
  // The one caller is `POST /admin/interviews/:id/report/requeue`, which refuses an interview
  // that already has a `reports` row — that guard, not this table, is what keeps a finished
  // report from being overwritten. Nothing on the candidate's path can reach these edges:
  // every other transition source is a round endpoint, and none of them run from a terminal
  // state.
  completed: ['evaluating'],
  failed: ['evaluating'],
};

export function canTransition(from: InterviewState, to: InterviewState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The states that mean *the interview is over*, and therefore stamp `ended_at`.
 *
 * Listed, not derived. This was `(TRANSITIONS[state]?.length ?? 0) === 0` — terminal means no
 * outgoing edge — which reads well and is wrong, because `completed → evaluating` exists: the
 * operational report-requeue edge above. One recovery edge silently un-terminalled the normal
 * end of every interview, so `ended_at` stopped being written on `evaluating → completed` and
 * `/admin/stats.averageDurationMs` went back to being structurally 0 — the exact defect the
 * derivation was introduced to prevent.
 *
 * "Has no outgoing edge" and "is an ending" are different properties that happened to coincide
 * until they didn't. `ASSERT_TERMINAL_HAS_NO_EDGE` below keeps the half of the derivation that
 * was genuinely useful: a *new* state added with no way out must be added here too.
 */
const TERMINAL: ReadonlySet<InterviewState> = new Set<InterviewState>([
  'completed',
  'abandoned',
  'failed',
]);

const isTerminal = (state: InterviewState): boolean => TERMINAL.has(state);

/**
 * Every state with no way out is an ending. The converse is deliberately not asserted — an
 * ending may still carry a recovery edge, which is what broke the derived version.
 */
export const deadEndsMissingFromTerminal = (): InterviewState[] =>
  (Object.keys(TRANSITIONS) as InterviewState[]).filter(
    (state) => (TRANSITIONS[state]?.length ?? 0) === 0 && !TERMINAL.has(state),
  );

/**
 * US-29's budget and time trips, written where the two of them actually happen. Four call
 * sites set `ended_reason = 'budget_exhausted'` (`budget.ts`, `conductor.ts`, `speech/stt.ts`,
 * `speech/tts.ts`) and two set `time_exhausted`, and every one of them arrives through this
 * function — so the record is written once here rather than six times out there, where the
 * seventh call site would forget.
 *
 * Best-effort, on purpose, and the only audit write in the codebase that is: an interview that
 * ran out of budget HAS run out of budget, and refusing the transition because the note about
 * it could not be filed would leave the interview burning the budget it just exceeded. The
 * destructive paths still write their audit row inside the transaction — there, a mutation
 * with no record is the failure worth refusing.
 */
async function recordExhaustion(
  interview: Interview,
  ctx: { traceId: string; endedReason?: Interview['ended_reason'] },
): Promise<void> {
  const action =
    ctx.endedReason === 'budget_exhausted'
      ? 'interview.budget_exhausted'
      : ctx.endedReason === 'time_exhausted'
        ? 'interview.time_exhausted'
        : null;
  if (!action) return;

  try {
    await recordAudit(prisma, {
      actorUserId: interview.user_id,
      action,
      subjectType: 'interview',
      subjectId: interview.id,
      traceId: ctx.traceId,
      metadata: {
        spentUsd: interview.spent_usd.toString(),
        budgetUsd: interview.budget_usd.toString(),
        elapsedSeconds: interview.elapsed_seconds,
      },
    });
  } catch (err) {
    logger.error(
      { err, traceId: ctx.traceId, interviewId: interview.id, action },
      'AUDIT_WRITE_FAILED',
    );
  }
}

export async function applyTransition(
  interview: Interview,
  to: InterviewState,
  // I08: the terminal edges carry why they ended. Written with the state so the two cannot
  // disagree — `ended_reason` set in a follow-up write would be visible unset for a moment.
  ctx: { traceId: string; endedReason?: Interview['ended_reason'] },
): Promise<InterviewState> {
  const from = interview.state;
  if (!canTransition(from, to)) throw new ApiError('INVALID_STATE_TRANSITION');

  // Written with the state for `ended_reason`'s reason: a follow-up write would leave the
  // interview terminal with a null duration for a moment, and `/admin/stats` averages over
  // exactly that column. Not added to the WHERE — that clause is the CAS on `state` and
  // nothing else; an extra predicate there would turn a re-stamp into a 409. The `state` CAS
  // is already what stops two concurrent terminal transitions, so an `ended_at` that is
  // somehow already set can only be an older one, and the older one is the true end.
  const endedAt = isTerminal(to) && !interview.ended_at ? clock.now() : undefined;

  // ADR-I06's pattern, applied to the state column: `from` was read when the request resolved
  // its interview, so checking the table against it is a TOCTOU. The WHERE clause re-checks it
  // at write time, which is what makes the guard hold across concurrent requests and replicas.
  const { count } = await prisma.interview.updateMany({
    where: { id: interview.id, state: from },
    data: {
      state: to,
      ...(ctx.endedReason ? { ended_reason: ctx.endedReason } : {}),
      ...(endedAt ? { ended_at: endedAt } : {}),
    },
  });
  if (count === 0) throw new ApiError('INVALID_STATE_TRANSITION');

  // The caller's copy is now stale, and a request that transitions twice (`POST /profile`
  // moves to `hr_round`, then a failed generation pauses it) would re-read the old `from`.
  interview.state = to;
  if (ctx.endedReason) interview.ended_reason = ctx.endedReason;
  if (endedAt) interview.ended_at = endedAt;

  logger.info(
    { traceId: ctx.traceId, interviewId: interview.id, from, to },
    'INTERVIEW_STATE_CHANGED',
  );

  await recordExhaustion(interview, ctx);

  // Best-effort, and deliberately not symmetric with `enqueueReport` below. The fan-out is a
  // push optimisation — a room that misses an event still reconstructs from `GET /state` — so
  // a Redis outage must not turn a committed transition into a failed request, or mask the
  // `AI_PROVIDER_UNAVAILABLE` that caused the pause in the first place.
  try {
    await publishStateChanged({ from, to, interviewId: interview.id });
  } catch (err) {
    logger.error(
      { err, traceId: ctx.traceId, interviewId: interview.id, from, to },
      'INTERVIEW_EVENT_PUBLISH_FAILED',
    );
  }

  // NOT wrapped: this is a real BullMQ enqueue (R01) now, and a swallowed failure would be an
  // interview that reaches `evaluating` and never gets a report. That has to be loud.
  if (to === 'evaluating') {
    await enqueueReport(interview.id, ctx);
    // I10: no more turns follow `evaluating` (K2), so no streak can ever complete — drop it
    // rather than let a mid-streak interview's entry sit in the Map until process restart.
    clearLanguageStreak(interview.id);
  }

  return to;
}
