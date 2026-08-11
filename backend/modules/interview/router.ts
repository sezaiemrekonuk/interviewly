import { Router } from 'express';

import { requireAuth } from '../auth/middleware';
import { requireVerifiedEmail } from '../auth/verify-email';

import { submitAnswer } from './answers';
import { requirePublicOrigin } from './csrf';
import { deleteInterview } from './delete';
import { getInterview } from './get';
import { downloadReport } from './download';
import { heartbeatInterview } from './heartbeat';
import { resolveInterview } from './ownership';
import { dailyInterviewCap, interviewStartLimiter } from './rate-limit';
import { submitProfile } from './profile';
import { resumeInterview } from './resume';
import { setupInterview } from './setup';
import { streamInterviewEvents } from './sse';
import { getInterviewState } from './state';
import { submitTurn } from './turns';

const router = Router();
router.use(requireAuth);

// I05: mounted once, above `router.param`, so it covers every state-changing route on this
// router — including ones not written yet — and rejects before the ownership resolver reads
// the DB. Per-route wiring is what lets a new route silently ship without the guard.
// `requirePublicOrigin` exempts GET/HEAD/OPTIONS itself; nothing here needs to opt out.
router.use(requirePublicOrigin);
router.param('id', resolveInterview);

// K8.6 — the only gated endpoint in the system (A04's exported middleware; §11.3).
router.post('/', requireVerifiedEmail, dailyInterviewCap, interviewStartLimiter, setupInterview);
router.get('/:id', getInterview);
router.get('/:id/state', getInterviewState);
router.delete('/:id', deleteInterview);

router.post('/:id/profile', submitProfile);
router.post('/:id/answers', submitAnswer);
// C02 — the conversational path the room uses. `/answers` stays: it is the plain
// one-answer-one-advance contract, and the acceptance suite is written against it.
router.post('/:id/turns', submitTurn);

// I16 — presence, not progression. Called on a timer by the open room; it moves no state and
// touches only the two timing columns, so it sits with the other non-`GET` routes under CSRF
// rather than being exempted for being "just a ping".
router.post('/:id/heartbeat', heartbeatInterview);

router.post('/:id/resume', resumeInterview);
router.get('/:id/events', streamInterviewEvents);

router.get('/:id/report/download', downloadReport);

export default router;
