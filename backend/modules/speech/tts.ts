import { type RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { clock } from '../../src/lib/clock';
import { activeInterview } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';
import { storage } from '../../src/lib/storage';
import { applyTransition } from '../interview/machine';
import { currentQuestionRow } from '../interview/state';
import { prisma } from '../../src/lib/db';
import { downgradeToText } from '../voice/downgrade';

import { speechProvider } from './SpeechProvider';

const VOICE_CAPABLE_STATES = new Set(['hr_round', 'tech_round']);

export { VOICE_CAPABLE_STATES };

export function isPastSpeechCeiling(startedAt: Date | null): boolean {
  if (!startedAt) return false;
  const elapsed = (clock.now().getTime() - startedAt.getTime()) / 1000;
  return elapsed >= Math.min(config.VOICE_MAX_ROUND_SECONDS, config.VOICE_MAX_INTERVIEW_SECONDS);
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

  if (isPastSpeechCeiling(interview.started_at)) {
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
  try {
    const cached = await storage.get(key);
    logger.info(
      { traceId: req.traceId, interviewId: interview.id, questionId: question.id, cached: true },
      'SPEECH_TTS_SERVED',
    );
    res.status(200).type('audio/mpeg').send(cached);
    return;
  } catch {
    // cache miss: continue to provider
  }

  try {
    const voiceId = await resolveQuestionVoiceId(interview.id, index, interview.hr_question_count);
    const spoken = await speechProvider.speak(question.text, {
      voiceId,
      language: interview.language,
    });
    await storage.put(key, spoken.audio, spoken.mime);
    logger.info(
      {
        traceId: req.traceId,
        interviewId: interview.id,
        questionId: question.id,
        cached: false,
        characters: spoken.characters,
      },
      'SPEECH_TTS_SERVED',
    );
    res.status(200).type('audio/mpeg').send(spoken.audio);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'VOICE_UNAVAILABLE') {
      await downgradeToText(interview, { traceId: req.traceId! });
      throw new ApiError('VOICE_UNAVAILABLE');
    }
    throw err;
  }
};
