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

import { downgradeToText } from './downgrade';
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

  // V03: `text` is where a downgraded interview lives, and the downgrade is one-directional
  // (§3.8) — asking for voice from there is an illegal transition, not a transient outage.
  if (interview.mode !== 'voice') throw new ApiError('INVALID_STATE_TRANSITION');

  if (!VOICE_CAPABLE_STATES.has(interview.state)) {
    throw new ApiError('INVALID_STATE_TRANSITION');
  }

  const roundLeft = voiceSeam.roundRemainingSeconds(interview);
  const interviewLeft = voiceSeam.interviewRemainingSeconds(interview);
  const ttlSeconds = Math.floor(Math.min(roundLeft, interviewLeft));
  if (ttlSeconds <= 0) throw new ApiError('VOICE_UNAVAILABLE');

  const nonce = randomBytes(32).toString('hex');

  // V03: only the driver call is wrapped. A pre-check refusal above (kill switch off, wrong
  // state, not the owner) has not failed *at voice*, and must not spend the one-directional
  // downgrade; a `VoiceSession` fatal error has, and §3.8 says the same interview continues
  // in text rather than dead-ending. No `voice_sessions` row is written on this path.
  let minted: { token: string; wssOrigin: string };
  try {
    minted = await _session.mint(interview.id, nonce, ttlSeconds);
  } catch (err) {
    // Both drivers raise VOICE_UNAVAILABLE; anything else is a defect, and swallowing it
    // behind the 503 without a line is how it stays invisible.
    if (!(err instanceof ApiError)) {
      logger.error({ err, traceId: req.traceId, interviewId: interview.id }, 'VOICE_MINT_FAILED');
    }
    await downgradeToText(interview, { traceId: req.traceId! });
    throw new ApiError('VOICE_UNAVAILABLE');
  }
  const { token, wssOrigin } = minted;

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
