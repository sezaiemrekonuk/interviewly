import { type RequestHandler } from 'express';

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

async function resolveQuestionVoiceId(
  interviewId: string,
  index: number,
  hrQuestionCount: number,
): Promise<string> {
  const roundType = index <= hrQuestionCount ? 'hr' : 'tech';
  const round = await prisma.interviewRound.findFirstOrThrow({
    where: { interview_id: interviewId, type: roundType },
    include: { persona: true },
  });
  return round.persona.voice_id;
}

export const serveQuestionSpeech: RequestHandler = async (req, res) => {
  const interview = await activeInterview(String(req.params.id));
  if (!interview) throw new ApiError('INTERVIEW_NOT_FOUND');
  if (interview.user_id !== req.user!.id) throw new ApiError('FORBIDDEN');
  if (interview.mode !== 'voice') throw new ApiError('INVALID_STATE_TRANSITION');
  if (!VOICE_CAPABLE_STATES.has(interview.state)) throw new ApiError('INVALID_STATE_TRANSITION');

  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index <= 0) throw new ApiError('VALIDATION_ERROR');
  if (index !== interview.current_index) throw new ApiError('QUESTION_NOT_CURRENT');

  if (isPastSpeechCeiling(interview.started_at, interview.max_duration_seconds)) {
    // ADR-I32: a losing transition must not replace the caller's error — the session is
    // expired whether or not this request is the one that moved the interview.
    try {
      await applyTransition(interview, 'evaluating', {
        traceId: req.traceId!,
        endedReason: 'time_exhausted',
      });
    } catch (err) {
      logger.error({ err, traceId: req.traceId, interviewId: interview.id }, 'INTERVIEW_END_FAILED');
    }
    throw new ApiError('VOICE_SESSION_EXPIRED');
  }

  const question = await currentQuestionRow(interview);
  if (!question) throw new ApiError('INVALID_STATE_TRANSITION');

  const key = `speech/${question.id}.mp3`;
  const cached = await readCachedAudio(key);
  if (cached) {
    logger.info(
      { traceId: req.traceId, interviewId: interview.id, questionId: question.id, cached: true },
      'SPEECH_TTS_SERVED',
    );
    res.status(200).type('audio/mpeg').send(cached);
    return;
  }

  try {
    const voiceId = await resolveQuestionVoiceId(interview.id, index, interview.hr_question_count);
    const spoken = await withBudget(interview.id, async () => {
      // I08 holds the advisory lock across the provider call AND the metering commit, so an
      // interview already at its budget never reaches ElevenLabs and a concurrent call reads
      // the charged total. meterTts writes the `llm_calls` row and increments `spent_usd` in
      // one transaction; a `speak` that throws bills nothing.
      //
      // The cache is re-read HERE, under the lock: the miss above is not proof this audio is
      // unpaid. Two first requests for the same question both miss, then serialise on the
      // lock — without this the second one buys bytes the first already paid for. The store
      // is written under the lock too, so the waiter's re-read is guaranteed to see it.
      const raced = await readCachedAudio(key);
      if (raced) return { audio: raced, characters: null, cached: true };

      const result = await speechProvider.speak(question.text, {
        voiceId,
        language: interview.language,
        ctx: { interviewId: interview.id, traceId: req.traceId! },
      });
      await meterTts(interview.id, result.characters, req.traceId!);
      // Already billed: a store that fails must not turn paid-for bytes into a 500 the
      // candidate retries, because the retry buys them a second time. Serve them and log.
      try {
        await storage.put(key, result.audio, result.mime);
      } catch (putErr) {
        logger.warn(
          { err: putErr, traceId: req.traceId, interviewId: interview.id, questionId: question.id },
          'SPEECH_TTS_CACHE_WRITE_FAILED',
        );
      }
      return { audio: result.audio, characters: result.characters, cached: false };
    });
    logger.info(
      {
        traceId: req.traceId,
        interviewId: interview.id,
        questionId: question.id,
        cached: spoken.cached,
        characters: spoken.characters,
      },
      'SPEECH_TTS_SERVED',
    );
    res.status(200).type('audio/mpeg').send(spoken.audio);
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      logger.warn({ traceId: req.traceId, interviewId: interview.id }, 'BUDGET_EXHAUSTED');
      // ADR-I32: a losing transition must not replace the caller's error — the request is a
      // 402 whether or not this one is the request that moved the interview.
      try {
        await applyTransition(interview, 'evaluating', {
          traceId: req.traceId!,
          endedReason: 'budget_exhausted',
        });
      } catch (transitionErr) {
        logger.error(
          { err: transitionErr, traceId: req.traceId, interviewId: interview.id },
          'INTERVIEW_END_FAILED',
        );
      }
      throw new ApiError('BUDGET_EXCEEDED');
    }
    if (err instanceof ApiError && err.code === 'VOICE_UNAVAILABLE') {
      await downgradeToText(interview, { traceId: req.traceId! });
      throw new ApiError('VOICE_UNAVAILABLE');
    }
    throw err;
  }
};
