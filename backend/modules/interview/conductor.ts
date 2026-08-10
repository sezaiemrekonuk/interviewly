/**
 * C02 — the interview is conducted, not counted.
 *
 * Before this, progression was arithmetic: one answer advanced `current_index` by one, and
 * the next row's text was whatever the batch (or D03's promotion) had put there. Nobody
 * greeted the candidate, nobody asked what they meant, and nothing could decide that a round
 * was finished early or that an interview should stop. That is the whole of "it feels
 * robotic": the interviewer had no turn of its own.
 *
 * Here a turn is one *utterance*, and the interviewer answers every one of them with a
 * sentence and a decision. The decision is a request — `conductTurn` returns an action that
 * this module re-derives from the interview's real state before anything is written, because
 * that action is downstream of candidate text and is therefore untrusted in exactly the §7.1
 * sense. Five things the model is never allowed to be the authority on:
 *
 *   1. The advance goes through ADR-I06's `current_index` CAS, so a duplicated or replayed
 *      `next_question` is a no-op rather than a double skip.
 *   2. `handover` is refused before the HR round has met its floor.
 *   3. `end_interview` is refused on the opening exchange, so a single bad first impression
 *      cannot end a paid interview.
 *   4. Past `CONDUCTOR_MAX_TURNS_PER_QUESTION` the server advances without asking, and says
 *      so in the transcript.
 *   5. Past `CONDUCTOR_MAX_TURNS` the interview ends, whatever anyone thinks.
 *
 * K2 still holds: `interviews.state` is only ever written by `applyTransition`, and the
 * client still never advances its own index.
 */
import type { AiClient, AiCtx, Widget } from '@interviewly/ai';
import type { ChatRole, ConductorAction, InputMode, Interview, InterviewState } from '@prisma/client';
import { WidgetSchema } from '@interviewly/ai';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { config } from '../../src/lib/env';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { aiClient } from '../ai';

import { promoteNextQuestion } from './adaptive';
import { recordAnswer } from './answers';
import { BudgetExceeded, withBudget } from './budget';
import { ensureTechBatch } from './generation';
import { trackLanguage } from './language';
import { applyTransition } from './machine';
import { currentQuestionRow } from './state';

/** One candidate utterance. Same bounds as a typed answer — S03's transcript arrives here too. */
export const turnInputSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  inputMode: z.enum(['voice', 'text', 'widget']),
});

export type TurnInput = z.infer<typeof turnInputSchema>;

export interface TurnResult {
  state: InterviewState;
  currentIndex: number;
}

/**
 * How much conversation the conductor is shown. The builder truncates an over-long block with
 * `slice(0, MAX_BLOCK_CHARS)`, which keeps the *oldest* text — exactly backwards for a
 * conversation, where the last three turns are the ones that matter. So the trimming happens
 * here instead, from the front, and the model is told when it happened.
 *
 * ponytail: drop-oldest, no summarisation. An interview long enough to lose its opening is
 * already past `CONDUCTOR_MAX_TURNS`; summarise the dropped prefix if that ceiling ever rises.
 */
const MAX_HISTORY_CHARS = 10_000;
const HISTORY_ELIDED = '[earlier turns omitted]';

/** The `EndedReason` values a conductor may ask for, mapped from its own vocabulary. */
const END_REASONS = { completed: 'completed', cut_short: 'cut_short' } as const;

interface ConductOpts {
  traceId: string;
  /** Injected by tests; defaults to the I02 adapter, like every other seam in this module. */
  client?: AiClient;
}

/**
 * Opens a round: the interviewer's own greeting and its first question, with no candidate
 * utterance to react to. Called when the HR round starts and again when a handover puts a
 * different persona in the chair.
 *
 * Idempotent by the same rule the rest of this module uses — an assistant message already
 * carrying the current question's id means the question has been asked, and asking it twice
 * would greet the candidate twice on every retry.
 */
export async function openRound(interview: Interview, opts: ConductOpts): Promise<void> {
  await runTurn(interview, null, opts);
}

/** One candidate utterance and the interviewer's reply to it. */
export async function conductTurn(
  interview: Interview,
  input: TurnInput,
  opts: ConductOpts,
): Promise<TurnResult> {
  return runTurn(interview, input, opts);
}

async function runTurn(
  interview: Interview,
  input: TurnInput | null,
  opts: ConductOpts,
): Promise<TurnResult> {
  const { traceId } = opts;
  const ctx: AiCtx = { interviewId: interview.id, traceId };

  if (interview.state !== 'hr_round' && interview.state !== 'tech_round') {
    throw new ApiError('INVALID_STATE_TRANSITION');
  }

  const question = await currentQuestionRow(interview);
  // No row to be on. A round whose batch never landed is `resume.ts`'s repair, not a turn's —
  // conducting into an empty round would ask the candidate to answer nothing.
  if (!question) throw new ApiError('INVALID_STATE_TRANSITION');

  const history = await loadConversation(interview.id);
  const asked = history.some((m) => m.role === 'assistant' && m.question_id === question.id);

  // The opening turn is a repair as much as a greeting: `startHrRound` fires it best-effort,
  // so a provider blip there leaves a round whose first question was never spoken. Re-firing
  // must be free once it has been.
  if (!input && asked) return { state: interview.state, currentIndex: interview.current_index };

  if (input) {
    await prisma.chatMessage.create({
      data: {
        interview_id: interview.id,
        role: 'user',
        content: input.text,
        question_id: question.id,
        trace_id: traceId,
      },
    });
    history.push({ role: 'user', content: input.text, question_id: question.id });
    // I10 keeps its position: before anything that generates, so a switch reaches the batch
    // and the conductor's own reply in the language the candidate just moved to.
    interview.language = await trackLanguage(interview, input.text, { traceId });
  }

  // The whole-interview backstop, counted in candidate utterances. `budget_usd` is the real
  // ceiling; this one catches a provider answering cheaply and wrongly for a very long time.
  const utterances = history.filter((m) => m.role === 'user').length;
  if (utterances > config.CONDUCTOR_MAX_TURNS) {
    logger.warn({ traceId, interviewId: interview.id, utterances }, 'CONDUCTOR_TURN_CEILING');
    return endInterview(interview, 'cut_short', 'The interview has reached its length limit.', opts);
  }

  const turnsOnQuestion = history.filter(
    (m) => m.role === 'user' && m.question_id === question.id,
  ).length;
  const turnsLeftOnQuestion = Math.max(0, config.CONDUCTOR_MAX_TURNS_PER_QUESTION - turnsOnQuestion);

  const persona = await personaForRound(interview);
  const turn = await askConductor(interview, question, history, {
    ...opts,
    ctx,
    persona,
    turnsLeftOnQuestion,
    mayHandOver: mayHandOver(interview),
    mayEnd: mayEnd(interview, turnsOnQuestion),
  });

  // A question the candidate has not been asked yet cannot be advanced past, whatever came
  // back: this turn IS the asking of it. The action is recorded as `continue` because that is
  // what happened to the index — nothing.
  if (!asked) {
    if (turn.question) {
      await prisma.question.update({ where: { id: question.id }, data: { text: turn.question } });
    }
    await say(interview, turn.say, 'continue', question.id, traceId);
    logger.info(
      { traceId, interviewId: interview.id, questionId: question.id },
      'CONDUCTOR_QUESTION_ASKED',
    );
    return { state: interview.state, currentIndex: interview.current_index };
  }

  const action = clampAction(interview, turn, { turnsLeftOnQuestion, traceId });
  return applyAction(interview, question, turn, action, opts);
}

// ---------------------------------------------------------------------------
// The guards. Every one of them is re-derived here from the interview row, never read back
// from the model's own answer — `allowedActions` in the prompt is a courtesy to keep the
// interviewer from wasting turns on refusals, not a check.
// ---------------------------------------------------------------------------

/**
 * A round may be handed over once it has covered its floor. Without this an interviewer that
 * finds the first answer impressive can end the HR round after one question, and the report
 * then scores a "round" that never happened.
 */
function mayHandOver(interview: Interview): boolean {
  if (interview.state !== 'hr_round') return false;
  const answered = interview.current_index - 1;
  const floor = Math.max(1, Math.ceil(interview.hr_question_count / 2));
  return answered >= floor;
}

/**
 * Ending is refused until the interview has actually started. Abuse ends an interview on the
 * second instance, never the first (the prompt is told to warn once) — and a first-turn end is
 * the shape a prompt injection would take if one ever got through the §7.1 boundary.
 */
function mayEnd(interview: Interview, turnsOnQuestion: number): boolean {
  return interview.current_index > 1 || turnsOnQuestion >= 2;
}

/**
 * Turns the model's requested action into the one the server will actually perform. Every
 * downgrade is logged with its reason: an interviewer repeatedly asking for something it may
 * not have is a prompt problem, and it is invisible unless the refusals are counted.
 */
function clampAction(
  interview: Interview,
  turn: { action: string; endReason?: string; widget?: Widget },
  opts: { turnsLeftOnQuestion: number; traceId: string },
): ConductorAction {
  const refuse = (requested: string, why: string): ConductorAction => {
    logger.warn(
      { traceId: opts.traceId, interviewId: interview.id, requested, why },
      'CONDUCTOR_ACTION_REFUSED',
    );
    return 'continue';
  };

  let action = turn.action as ConductorAction;
  if (action === 'handover' && !mayHandOver(interview)) action = refuse(action, 'round_floor');
  if (action === 'end_interview' && !turn.endReason) action = refuse(action, 'no_reason');
  if (action === 'show_widget' && !turn.widget) action = refuse(action, 'no_widget');

  // The hard drift (@C02): the interviewer has had its allotted turns on this question and
  // still wants more. It does not get more. The forced advance is written into the transcript
  // as a system row so the interview reads honestly afterwards — an interviewer that was
  // overridden should not look like one that chose to move on.
  if (opts.turnsLeftOnQuestion <= 0 && action !== 'next_question' && action !== 'handover' && action !== 'end_interview') {
    logger.warn(
      { traceId: opts.traceId, interviewId: interview.id, requested: action },
      'AI_AGENT_DRIFTED_FOR_NEXT',
    );
    return 'drift';
  }

  return action;
}

// ---------------------------------------------------------------------------
// Applying the decision.
// ---------------------------------------------------------------------------

async function applyAction(
  interview: Interview,
  question: QuestionRow,
  turn: { say: string; question?: string; endReason?: string; widget?: Widget },
  action: ConductorAction,
  opts: ConductOpts,
): Promise<TurnResult> {
  const { traceId } = opts;

  switch (action) {
    case 'continue':
      await say(interview, turn.say, 'continue', question.id, traceId);
      return { state: interview.state, currentIndex: interview.current_index };

    case 'show_widget': {
      // C04 — the answer surface is a property of the question, not of the message that
      // announced it: a refresh has to re-render the box, and the message is prose.
      await prisma.question.update({
        where: { id: question.id },
        data: { widget: WidgetSchema.parse(turn.widget) },
      });
      await say(interview, turn.say, 'show_widget', question.id, traceId);
      logger.info({ traceId, interviewId: interview.id, questionId: question.id }, 'CONDUCTOR_WIDGET_SHOWN');
      return { state: interview.state, currentIndex: interview.current_index };
    }

    case 'end_interview': {
      const reason = END_REASONS[turn.endReason as keyof typeof END_REASONS] ?? 'cut_short';
      return endInterview(interview, reason, turn.say, opts);
    }

    case 'handover':
      return handover(interview, turn.say, opts);

    case 'drift':
    case 'next_question':
      return nextQuestion(interview, question, turn, action, opts);
  }
}

/**
 * Closes the current question and opens the next one.
 *
 * The answer is the *window*: every user utterance carrying this question's id, joined. Taking
 * the last message instead would score a candidate who built an answer over three turns on
 * whichever fragment they happened to end with — and "…yeah, that's basically it" is what most
 * people end with.
 */
async function nextQuestion(
  interview: Interview,
  question: QuestionRow,
  turn: { say: string; question?: string },
  action: ConductorAction,
  opts: ConductOpts,
): Promise<TurnResult> {
  const { traceId } = opts;

  const window = await prisma.chatMessage.findMany({
    where: { interview_id: interview.id, question_id: question.id, role: 'user' },
    orderBy: { created_at: 'asc' },
    select: { content: true },
  });

  // Nothing said to this question at all. The interviewer wants to move on from a question the
  // candidate never answered, which is a real thing to want (they asked to skip, or the round
  // is being wound up) — it is just not an answer, and writing an empty one would put a blank
  // turn in the report. The index still advances.
  const transcript = window.map((m) => m.content).join('\n\n');

  const { nextIndex, answerId } = await recordAnswer(
    interview,
    question,
    transcript ? { transcript, inputMode: lastInputMode(interview) } : null,
    { traceId },
  );

  let state: InterviewState = interview.state;
  if (nextIndex > interview.target_question_count) {
    state = await applyTransition(interview, 'evaluating', { traceId });
  } else if (state === 'hr_round' && nextIndex > interview.hr_question_count) {
    state = await applyTransition(interview, 'tech_round', { traceId });
  }

  if (action === 'drift') {
    await note(interview, 'The interviewer was moved on to the next question automatically.', traceId);
  }

  if (state === 'evaluating') {
    await say(interview, turn.say, action, null, traceId);
    return { state, currentIndex: nextIndex };
  }

  // ADR-I22's tech batch, unchanged: generated during the HR round so the handover is never a
  // loading screen, idempotent so every HR turn may call it. A failure here must not fail a
  // turn whose answer is already stored (#90).
  if (state === 'hr_round') {
    try {
      await ensureTechBatch(interview, { traceId });
    } catch (err) {
      logger.warn({ err, traceId, interviewId: interview.id }, 'TECH_BATCH_FAILED');
    }
  }

  // K4 (ADR-D03) survives C02 and changes job: it no longer decides the *wording* — the
  // conductor just wrote a question informed by the whole conversation, which is strictly more
  // context than three pre-generated candidates had. What it still does is score the answer for
  // the report, and supply the next row's text on the path where the conductor did not: a
  // provider failure that fell back, or a drift. Adaptive is now the degradation path, which is
  // where a mechanism with no conversation behind it belongs.
  const nextRow = await currentQuestionRow({ ...interview, current_index: nextIndex });
  if (answerId) {
    try {
      await withBudget(interview.id, () =>
        promoteNextQuestion(interview, question, answerId, transcript, nextIndex, opts),
      );
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        logger.warn({ traceId, interviewId: interview.id }, 'ADAPTIVE_SKIPPED_NO_BUDGET');
      } else {
        logger.warn({ err, traceId, interviewId: interview.id }, 'ADAPTIVE_HOOK_FAILED');
      }
    }
  }

  // The conductor's wording wins over the promotion's, and is written last for that reason.
  if (nextRow && turn.question) {
    await prisma.question.update({ where: { id: nextRow.id }, data: { text: turn.question } });
  }

  await say(interview, turn.say, action, nextRow?.id ?? null, traceId);
  logger.info(
    { traceId, interviewId: interview.id, questionId: question.id, nextIndex, action },
    'CONDUCTOR_ADVANCED',
  );
  return { state, currentIndex: nextIndex };
}

/**
 * Hands the interview to the other round's persona.
 *
 * The index jump is the part that is easy to miss: `currentQuestionRow` picks the round by
 * comparing the index against `hr_question_count`, so a state that says `tech_round` while the
 * index still points inside the HR block resolves to an HR row and the technical interviewer
 * asks HR questions. The unasked HR rows are simply left behind — the report is told the
 * coverage (C03) rather than pretending they were answered.
 */
async function handover(
  interview: Interview,
  saidText: string,
  opts: ConductOpts,
): Promise<TurnResult> {
  const { traceId } = opts;
  const expected = interview.current_index;
  const target = interview.hr_question_count + 1;

  // Nothing to hand over TO. A shape with no technical questions ends here instead, which is
  // the same edge `hr_round → evaluating` exists for (machine.ts).
  if (target > interview.target_question_count) {
    return endInterview(interview, 'completed', saidText, opts);
  }

  const { count } = await prisma.interview.updateMany({
    where: { id: interview.id, current_index: expected },
    data: { current_index: target },
  });
  if (count === 0) throw new ApiError('QUESTION_NOT_CURRENT');
  interview.current_index = target;

  const state = await applyTransition(interview, 'tech_round', { traceId });
  await say(interview, saidText, 'handover', null, traceId);
  logger.info(
    { traceId, interviewId: interview.id, from: expected, to: target },
    'CONDUCTOR_HANDOVER',
  );

  // The new interviewer introduces itself and asks its own first question. Best-effort: a
  // handover that lands and then fails to greet is a round the candidate can still be asked
  // into on the next `openRound`, and a thrown error here would roll nothing back anyway.
  try {
    await openRound(interview, opts);
  } catch (err) {
    logger.warn({ err, traceId, interviewId: interview.id }, 'CONDUCTOR_OPEN_ROUND_FAILED');
  }

  return { state, currentIndex: interview.current_index };
}

async function endInterview(
  interview: Interview,
  endedReason: 'completed' | 'cut_short',
  saidText: string,
  opts: ConductOpts,
): Promise<TurnResult> {
  const { traceId } = opts;
  // Said before the transition: `evaluating` fires the report job, and a closing line written
  // afterwards would race a worker already reading the conversation.
  await say(interview, saidText, 'end_interview', null, traceId);
  const state = await applyTransition(interview, 'evaluating', { traceId, endedReason });
  logger.info({ traceId, interviewId: interview.id, endedReason }, 'CONDUCTOR_ENDED_INTERVIEW');
  return { state, currentIndex: interview.current_index };
}

// ---------------------------------------------------------------------------
// The provider call, and what happens when it does not come back.
// ---------------------------------------------------------------------------

interface AskOpts extends ConductOpts {
  ctx: AiCtx;
  persona: { name: string; system_prompt: string };
  turnsLeftOnQuestion: number;
  mayHandOver: boolean;
  mayEnd: boolean;
}

async function askConductor(
  interview: Interview,
  question: QuestionRow,
  history: ConversationRow[],
  opts: AskOpts,
): Promise<{ say: string; action: string; question?: string; endReason?: string; widget?: Widget }> {
  const client = opts.client ?? aiClient();
  const roundType = interview.state === 'tech_round' ? 'tech' : 'hr';
  // Resolved before the budget lock is taken: `withBudget` holds a `pg_advisory_xact_lock` for
  // the whole callback, and a query issued inside it would sit on the interview's own lock.
  const topics = await remainingTopics(interview);

  try {
    return await withBudget(interview.id, () =>
      client.conductTurn({
        personaBrief: opts.persona.system_prompt,
        personaName: opts.persona.name,
        roundType,
        jobListing: interview.job_text,
        ...profileVars(interview),
        language: interview.language,
        currentQuestion: question.text,
        currentIntent: question.intent,
        remainingTopics: topics,
        conversation: trimHistory(history),
        turnsLeftOnQuestion: opts.turnsLeftOnQuestion,
        mayHandOver: opts.mayHandOver,
        mayEnd: opts.mayEnd,
        ctx: opts.ctx,
      }),
    );
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      // Same handling `withBudgetOrEnd` gives every other generation: the interview is over,
      // and the room routes 402 to a silent refetch that lands on the ended state.
      logger.warn({ traceId: opts.traceId, interviewId: interview.id }, 'BUDGET_EXHAUSTED');
      await applyTransition(interview, 'evaluating', {
        traceId: opts.traceId,
        endedReason: 'budget_exhausted',
      }).catch((e: unknown) =>
        logger.error({ err: e, traceId: opts.traceId, interviewId: interview.id }, 'INTERVIEW_END_FAILED'),
      );
      throw new ApiError('BUDGET_EXCEEDED');
    }

    // The interviewer is unreachable and the candidate is mid-interview. Ending here would
    // make a provider blip cost someone their session, so the interview degrades to the shape
    // it had before C02: the answer is taken, the question advances, and the next question is
    // whatever the batch (or D03's promotion) put on the row. `say` is the fallback wording,
    // which is exactly what that row is for (C05).
    logger.warn({ err, traceId: opts.traceId, interviewId: interview.id }, 'CONDUCTOR_UNAVAILABLE');
    return { say: question.text, action: 'next_question' };
  }
}

// ---------------------------------------------------------------------------
// Conversation storage and replay.
// ---------------------------------------------------------------------------

interface ConversationRow {
  role: ChatRole;
  content: string;
  question_id: string | null;
}

/** Whatever `currentQuestionRow` hands back — the whole row, so nothing here re-queries it. */
type QuestionRow = NonNullable<Awaited<ReturnType<typeof currentQuestionRow>>>;

/**
 * The interview's memory. Ordered by `created_at` then `id`: a user utterance and the reply to
 * it are written within the same request and can land on the same millisecond, and a replay
 * that puts the answer before the question is a different interview.
 */
async function loadConversation(interviewId: string): Promise<ConversationRow[]> {
  return prisma.chatMessage.findMany({
    where: { interview_id: interviewId },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { role: true, content: true, question_id: true },
  });
}

/** Drops the oldest turns until the block fits, and says so where they were. */
function trimHistory(history: ConversationRow[]): { role: 'user' | 'assistant' | 'system'; content: string }[] {
  const rows = history.map((m) => ({ role: m.role, content: m.content }));
  let total = rows.reduce((n, r) => n + r.content.length, 0);
  let from = 0;
  while (total > MAX_HISTORY_CHARS && from < rows.length - 1) {
    total -= rows[from].content.length;
    from += 1;
  }
  const kept = rows.slice(from);
  return from > 0 ? [{ role: 'system' as const, content: HISTORY_ELIDED }, ...kept] : kept;
}

async function say(
  interview: Interview,
  content: string,
  action: ConductorAction,
  questionId: string | null,
  traceId: string,
): Promise<void> {
  await prisma.chatMessage.create({
    data: {
      interview_id: interview.id,
      role: 'assistant',
      content,
      action,
      question_id: questionId,
      trace_id: traceId,
    },
  });
}

/** A server-written line. The candidate sees it; the conductor reads it back next turn. */
async function note(interview: Interview, content: string, traceId: string): Promise<void> {
  await prisma.chatMessage.create({
    data: {
      interview_id: interview.id,
      role: 'system',
      content,
      action: 'drift',
      trace_id: traceId,
    },
  });
}

// ---------------------------------------------------------------------------
// Small resolvers.
// ---------------------------------------------------------------------------

async function personaForRound(interview: Interview): Promise<{ name: string; system_prompt: string }> {
  const type = interview.state === 'tech_round' ? 'tech' : 'hr';
  const round = await prisma.interviewRound.findFirst({
    where: { interview_id: interview.id, type },
    include: { persona: true },
  });
  // `personas.system_prompt` has been seeded since F02 and read by nothing until now. The
  // fallback is not decoration: an interview whose round row is missing still has to be
  // conductable, and a null brief would fail the prompt build rather than the round.
  if (!round) return { name: 'the interviewer', system_prompt: 'You are an experienced interviewer.' };
  return { name: round.persona.name, system_prompt: round.persona.system_prompt };
}

/** What this round still has to cover, so the interviewer can pace rather than sprint. */
async function remainingTopics(interview: Interview): Promise<string[]> {
  const rows = await prisma.question.findMany({
    where: { round: { interview_id: interview.id }, asked_at: null },
    select: { topic: true, intent: true },
    orderBy: { order_index: 'asc' },
  });
  return rows.map((r) => r.intent ?? r.topic);
}

/** §3.3's split, shared with `generation.ts` — the CV rides in its own block. */
function profileVars(interview: Interview): { candidateProfile: unknown | null; candidateCv: string | null } {
  const snapshot = interview.candidate_profile as Record<string, unknown> | null;
  if (!snapshot) return { candidateProfile: null, candidateCv: null };
  const { cvText, ...rest } = snapshot;
  return {
    candidateProfile: Object.keys(rest).length > 0 ? rest : null,
    candidateCv: typeof cvText === 'string' && cvText.length > 0 ? cvText : null,
  };
}

/**
 * ponytail: the whole window is stored under one `input_mode`, the mode of the interview
 * rather than of each utterance. A candidate who types one clarification into a widget during
 * a voice interview has that turn recorded as voice. Split it per utterance if the report ever
 * needs to distinguish them — `chat_messages` would need the column, not `answers`.
 */
function lastInputMode(interview: Interview): InputMode {
  return interview.mode === 'voice' ? 'voice' : 'text';
}

export const __testing = { trimHistory, mayHandOver, mayEnd, clampAction };
