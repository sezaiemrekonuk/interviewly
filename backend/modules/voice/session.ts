import { randomBytes } from 'node:crypto';
import { Router, type RequestHandler } from 'express';

import type { Interview } from '@prisma/client';

import { requireAuth } from '../auth/middleware';
import { requirePublicOrigin } from '../interview/csrf';
import { ApiError } from '../../src/lib/api-error';
import { clock } from '../../src/lib/clock';
import { activeInterview, prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';

import { ElevenLabsSession } from './elevenlabs-session';
import type { VoiceSession } from './VoiceSession';

// Voice-capable interview states (the two active rounds that host a voice session).
const VOICE_CAPABLE_STATES = new Set(['hr_round', 'tech_round']);

// Seam — acceptance ring overrides roundRemainingSeconds/interviewRemainingSeconds
// per-scenario; aiEnabled resets to config in BeforeAll.
// ponytail: both remaining* compute from interview.started_at — add per-round start
//   tracking (e.g. interview_rounds.started_at) if gate-4 ceiling enforcement proves
//   inaccurate after a state transition resets the round clock.
export const voiceSeam = {
  aiEnabled: config.AI_ENABLED,
  roundRemainingSeconds(interview: Interview): number {
    if (!interview.started_at) return config.VOICE_MAX_ROUND_SECONDS;
    const elapsed = (clock.now().getTime() - interview.started_at.getTime()) / 1000;
    return Math.max(0, config.VOICE_MAX_ROUND_SECONDS - elapsed);
  },
  interviewRemainingSeconds(interview: Interview): number {
    if (!interview.started_at) return config.VOICE_MAX_INTERVIEW_SECONDS;
    const elapsed = (clock.now().getTime() - interview.started_at.getTime()) / 1000;
    return Math.max(0, config.VOICE_MAX_INTERVIEW_SECONDS - elapsed);
  },
};

let _session: VoiceSession = new ElevenLabsSession();

export function setVoiceSession(vs: VoiceSession): void {
  _session = vs;
}

export const mintVoiceSession: RequestHandler = async (req, res) => {
  const interview = await activeInterview(String(req.params.id));
  if (!interview) throw new ApiError('INTERVIEW_NOT_FOUND');
  if (interview.user_id !== req.user!.id) throw new ApiError('FORBIDDEN');

  if (!voiceSeam.aiEnabled) throw new ApiError('VOICE_UNAVAILABLE');

  if (interview.mode !== 'voice') throw new ApiError('VOICE_UNAVAILABLE');

  if (!VOICE_CAPABLE_STATES.has(interview.state)) {
    throw new ApiError('INVALID_STATE_TRANSITION');
  }

  const roundLeft = voiceSeam.roundRemainingSeconds(interview);
  const interviewLeft = voiceSeam.interviewRemainingSeconds(interview);
  const ttlSeconds = Math.floor(Math.min(roundLeft, interviewLeft));
  if (ttlSeconds <= 0) throw new ApiError('VOICE_UNAVAILABLE');

  const nonce = randomBytes(32).toString('hex');
  const { token, wssOrigin } = await _session.mint(interview.id, nonce, ttlSeconds);

  const expiresAt = new Date(clock.now().getTime() + ttlSeconds * 1000);
  await prisma.voiceSession.create({
    data: { interview_id: interview.id, nonce, expires_at: expiresAt },
  });

  logger.info({ traceId: req.traceId, interviewId: interview.id }, 'VOICE_SESSION_MINTED');

  res.status(201).json({
    token,
    wssOrigin,
    dynamicVars: { interviewId: interview.id, nonce },
    expiresAt: expiresAt.toISOString(),
  });
};

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(requirePublicOrigin);
router.post('/:id/voice/session', mintVoiceSession);

export default router;
