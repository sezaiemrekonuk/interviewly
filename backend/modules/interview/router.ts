import { Router } from 'express';

import { requireAuth } from '../auth/middleware';

import { requirePublicOrigin } from './csrf';
import { resolveInterview } from './ownership';
import { setupInterview } from './setup';
import { getInterviewState } from './state';

const router = Router();
router.use(requireAuth);
router.param('id', resolveInterview);

router.post('/', requirePublicOrigin, setupInterview);
router.get('/:id/state', getInterviewState);

// I04 mounts here: router.post('/:id/profile', requirePublicOrigin, ...)
// I06 mounts here: router.post('/:id/answers', requirePublicOrigin, ...)
// I07 mounts here: router.post('/:id/resume', requirePublicOrigin, ...)
// I12 mounts here: router.get('/:id/report/download', ...)

export default router;
