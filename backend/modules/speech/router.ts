import { Router } from 'express';

import { requireAuth } from '../auth/middleware';

import { serveQuestionSpeech } from './tts';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.get('/:id/questions/:index/speech', serveQuestionSpeech);

export default router;
