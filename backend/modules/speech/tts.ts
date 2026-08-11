import { type RequestHandler, type Request, type Response } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { activeInterview } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { storage } from '../../src/lib/storage';
import { BudgetExceeded, withBudget } from '../interview/budget';
import { applyTransition } from '../interview/machine';
import { currentQuestionRow } from '../interview/state';
import { prisma } from '../../src/lib/db';
import { downgradeToText } from '../voice/downgrade';

import { isPastSpeechCeiling } from './ceiling';
import { meterTts } from './metering';
import { speechProvider } from './SpeechProvider';

const VOICE_CAPABLE_STATES = new Set(['hr_round', 'tech_round']);

// S09 moved the arithmetic to `ceiling.ts` so `GET /state` can report the same instant this
// route refuses on. Re-exported: `stt.ts` and the tests took it from here first.
export { VOICE_CAPABLE_STATES, isPastSpeechCeiling };

/** The cached audio, or null on a miss — `storage.get` signals a miss by throwing (I12). */
async function readCachedAudio(key: string): Promise<Buffer | null> {
  try {
    return await storage.get(key);
  } catch {
    return null;
  }
}

/**
 * Which persona says this.
 *
 * `questionId` is the C06 addition and the preferred answer: a stored line names its own round
 * through the question it was said under, which is the only way a replayed HR message keeps the
 * HR voice once the interview has already handed over to the technical round. The index
 * arithmetic stays as the fallback for lines that belong to no question — `chat_messages`
 * (C01) leaves `question_id` null on the welcome and on the handover line, and there the round
 * the index is in IS the round that is speaking.
 */
async function resolveQuestionVoiceId(
  interviewId: string,
  index: number,
  hrQuestionCount: number,
  questionId?: string | null,
): Promise<string> {
  if (questionId) {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: { round: { select: { persona: { select: { voice_id: true } } } } },
    });
    // The FK is `onDelete: Restrict`, so a miss here is not a real shape — falling through to
    // the arithmetic rather than throwing keeps a mute room from being the failure mode.
    if (question) return question.round.persona.voice_id;
  }
  const roundType = index <= hrQuestionCount ? 'hr' : 'tech';
  const round = await prisma.interviewRound.findFirstOrThrow({
    where: { interview_id: interviewId, type: roundType },
    include: { persona: true },
  });
  return round.persona.voice_id;
}

type VoiceInterview = NonNullable<Awaited<ReturnType<typeof activeInterview>>>;

/** Ownership, mode and state — everything true of a speech request before it names anything. */
async function guardVoiceSpeech(req: Request): Promise<VoiceInterview> {
  const interview = await activeInterview(String(req.params.id));
  if (!interview) throw new ApiError('INTERVIEW_NOT_FOUND');
  if (interview.user_id !== req.user!.id) throw new ApiError('FORBIDDEN');
  if (interview.mode !== 'voice') throw new ApiError('INVALID_STATE_TRANSITION');
  if (!VOICE_CAPABLE_STATES.has(interview.state)) throw new ApiError('INVALID_STATE_TRANSITION');
  return interview;
}

/** ADR-S06: nothing is spoken past the ceiling, and reaching it ends the interview. */
async function enforceSpeechCeiling(interview: VoiceInterview, traceId: string): Promise<void> {
  if (!isPastSpeechCeiling(interview)) return;
  // ADR-I32: a losing transition must not replace the caller's error — the session is
  // expired whether or not this request is the one that moved the interview.
  try {
    await applyTransition(interview, 'evaluating', { traceId, endedReason: 'time_exhausted' });
  } catch (err) {
    logger.error({ err, traceId, interviewId: interview.id }, 'INTERVIEW_END_FAILED');
  }
  throw new ApiError('VOICE_SESSION_EXPIRED');
}

interface SpeechSpec {
  key: string;
  text: string;
  /** Deferred: a cache hit must not pay for a round lookup it will never use. */
  voiceId: () => Promise<string>;
  traceId: string;
  /** What this line is, for the log — `questionId` or `messageId`. */
  log: Record<string, string>;
}

/**
 * Everything both speech routes do once the guards have passed and they know what to say.
 *
 * Shared rather than copied because the subtle parts are the ones that rot in a copy: the
 * double-checked cache read INSIDE the budget lock, and serving bytes that were already billed
 * even when the cache write fails. A fix applied to one route and not the other is a bill the
 * candidate pays twice, and nothing goes red when it happens.
 */
async function serveSpeech(
  res: Response,
  interview: VoiceInterview,
  spec: SpeechSpec,
): Promise<void> {
  const base = { traceId: spec.traceId, interviewId: interview.id, ...spec.log };

  const cached = await readCachedAudio(spec.key);
  if (cached) {
    logger.info({ ...base, cached: true }, 'SPEECH_TTS_SERVED');
    res.status(200).type('audio/mpeg').send(cached);
    return;
  }

  try {
    const voiceId = await spec.voiceId();
    const spoken = await withBudget(interview.id, async () => {
      // I08 holds the advisory lock across the provider call AND the metering commit, so an
      // interview already at its budget never reaches ElevenLabs and a concurrent call reads
      // the charged total. meterTts writes the `llm_calls` row and increments `spent_usd` in
      // one transaction; a `speak` that throws bills nothing.
      //
      // The cache is re-read HERE, under the lock: the miss above is not proof this audio is
      // unpaid. Two first requests for the same line both miss, then serialise on the lock —
      // without this the second one buys bytes the first already paid for. The store is
      // written under the lock too, so the waiter's re-read is guaranteed to see it.
      const raced = await readCachedAudio(spec.key);
      if (raced) return { audio: raced, characters: null, cached: true };

      const result = await speechProvider.speak(spec.text, {
        voiceId,
        language: interview.language,
        ctx: { interviewId: interview.id, traceId: spec.traceId },
      });
      await meterTts(interview.id, result.characters, spec.traceId);
      // Already billed: a store that fails must not turn paid-for bytes into a 500 the
      // candidate retries, because the retry buys them a second time. Serve them and log.
      try {
        await storage.put(spec.key, result.audio, result.mime);
      } catch (putErr) {
        logger.warn({ err: putErr, ...base }, 'SPEECH_TTS_CACHE_WRITE_FAILED');
      }
      return { audio: result.audio, characters: result.characters, cached: false };
    });
    logger.info(
      { ...base, cached: spoken.cached, characters: spoken.characters },
      'SPEECH_TTS_SERVED',
    );
    res.status(200).type('audio/mpeg').send(spoken.audio);
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      logger.warn({ traceId: spec.traceId, interviewId: interview.id }, 'BUDGET_EXHAUSTED');
      // ADR-I32: a losing transition must not replace the caller's error — the request is a
      // 402 whether or not this one is the request that moved the interview.
      try {
        await applyTransition(interview, 'evaluating', {
          traceId: spec.traceId,
          endedReason: 'budget_exhausted',
        });
      } catch (transitionErr) {
        logger.error(
          { err: transitionErr, traceId: spec.traceId, interviewId: interview.id },
          'INTERVIEW_END_FAILED',
        );
      }
      throw new ApiError('BUDGET_EXCEEDED');
    }
    if (err instanceof ApiError && err.code === 'VOICE_UNAVAILABLE') {
      await downgradeToText(interview, { traceId: spec.traceId });
      throw new ApiError('VOICE_UNAVAILABLE');
    }
    throw err;
  }
}

export const serveQuestionSpeech: RequestHandler = async (req, res) => {
  const interview = await guardVoiceSpeech(req);

  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index <= 0) throw new ApiError('VALIDATION_ERROR');
  if (index !== interview.current_index) throw new ApiError('QUESTION_NOT_CURRENT');

  await enforceSpeechCeiling(interview, req.traceId!);

  const question = await currentQuestionRow(interview);
  if (!question) throw new ApiError('INVALID_STATE_TRANSITION');

  await serveSpeech(res, interview, {
    key: `speech/${question.id}.mp3`,
    text: question.text,
    voiceId: () => resolveQuestionVoiceId(interview.id, index, interview.hr_question_count),
    traceId: req.traceId!,
    log: { questionId: question.id },
  });
};

/**
 * C06 — `GET /interviews/:id/messages/:messageId/speech`, the reason the room is no longer mute
 * between questions.
 *
 * The question route can only ever speak a question row, and after C02 most of what the
 * interviewer says is not one: the welcome, every clarification, the handover line and the
 * closing line are `chat_messages` with no index to address them by. They were silently
 * skipped, so a voice interview read as an interviewer who asks and then says nothing.
 *
 * Deliberately NOT gated on `current_index` the way the question route is. A past assistant
 * line stays replayable, which is what makes a refresh mid-interview recoverable: the room
 * re-reads the conversation and plays what it missed. The cost is bounded by the cache — a
 * replayed line is bytes already bought, and the ceiling above still ends a session that has
 * run out of time before a new one is synthesised.
 */
export const serveMessageSpeech: RequestHandler = async (req, res) => {
  const interview = await guardVoiceSpeech(req);
  await enforceSpeechCeiling(interview, req.traceId!);

  const message = await prisma.chatMessage.findUnique({
    where: { id: String(req.params.messageId) },
    select: { id: true, interview_id: true, role: true, content: true, question_id: true },
  });
  // Another interview's message id is not a hint that it exists: same 404 as a missing one.
  if (!message || message.interview_id !== interview.id) throw new ApiError('INTERVIEW_NOT_FOUND');
  // Only the interviewer is voiced. A `user` row is the candidate's own words read back at
  // them, and a `system` row is a server note (C02's drift line) that nobody said out loud.
  if (message.role !== 'assistant') throw new ApiError('VALIDATION_ERROR');

  await serveSpeech(res, interview, {
    key: `speech/msg-${message.id}.mp3`,
    text: message.content,
    voiceId: () =>
      resolveQuestionVoiceId(
        interview.id,
        interview.current_index,
        interview.hr_question_count,
        message.question_id,
      ),
    traceId: req.traceId!,
    log: { messageId: message.id },
  });
};
