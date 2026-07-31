import { Router } from 'express';

import { requireAuth } from '../auth/middleware';

import { requirePublicOrigin } from './csrf';
import { resolveInterview } from './ownership';
import { submitProfile } from './profile';
import { setupInterview } from './setup';
import { getInterviewState } from './state';

const router = Router();
router.use(requireAuth);

// I05: mounted once, above `router.param`, so it covers every state-changing route on this
// router — including ones not written yet — and rejects before the ownership resolver reads
// the DB. Per-route wiring is what lets a new route silently ship without the guard.
// `requirePublicOrigin` exempts GET/HEAD/OPTIONS itself; nothing here needs to opt out.
router.use(requirePublicOrigin);
router.param('id', resolveInterview);

router.post('/', setupInterview);
router.get('/:id/state', getInterviewState);

router.post('/:id/profile', submitProfile);

// I06 mounts here: router.post('/:id/answers', ...)
// I07 mounts here: router.post('/:id/resume', ...)
// I12 mounts here: router.get('/:id/report/download', ...)

export default router;
