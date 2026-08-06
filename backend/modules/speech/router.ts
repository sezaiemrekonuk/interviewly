import { Router } from 'express';

import { requireAuth } from '../auth/middleware';
import { requirePublicOrigin } from '../interview/csrf';

import { guardVoiceAnswer, submitAnswerAudio, uploadAudioMiddleware } from './stt';
import { serveQuestionSpeech } from './tts';

const router = Router({ mergeParams: true });
router.use(requireAuth);
// I05: mounted once; GET/HEAD/OPTIONS are exempt, so it guards the POST answer route without
// touching the TTS GET below.
router.use(requirePublicOrigin);
router.get('/:id/questions/:index/speech', serveQuestionSpeech);
// Ownership/mode/state/ceiling run before multer so a rejected request never buffers its body.
router.post('/:id/answers/audio', guardVoiceAnswer, uploadAudioMiddleware, submitAnswerAudio);

export default router;
