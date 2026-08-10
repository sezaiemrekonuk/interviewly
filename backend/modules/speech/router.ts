import { Router } from 'express';

import { requireAuth } from '../auth/middleware';
import { requirePublicOrigin } from '../interview/csrf';

import {
  guardVoiceAnswer,
  submitAnswerAudio,
  submitTurnAudio,
  uploadAudioMiddleware,
  uploadTurnAudioMiddleware,
} from './stt';
import { serveMessageSpeech, serveQuestionSpeech } from './tts';

const router = Router({ mergeParams: true });
router.use(requireAuth);
// I05: mounted once; GET/HEAD/OPTIONS are exempt, so it guards the POST answer route without
// touching the TTS GETs below.
router.use(requirePublicOrigin);
router.get('/:id/questions/:index/speech', serveQuestionSpeech);
// C06 — everything the interviewer says that is not a question row: the welcome, every
// clarification, the handover line, the closing line. Without this the room is mute between
// questions, because none of those have an index to be addressed by.
router.get('/:id/messages/:messageId/speech', serveMessageSpeech);
// Ownership/mode/state/ceiling run before multer so a rejected request never buffers its body.
router.post('/:id/answers/audio', guardVoiceAnswer, uploadAudioMiddleware, submitAnswerAudio);
// C06 — the conversational audio path. `/answers/audio` always advances, so a voice candidate
// could never be asked a follow-up; this one lets the conductor decide. Both stay.
router.post('/:id/turns/audio', guardVoiceAnswer, uploadTurnAudioMiddleware, submitTurnAudio);

export default router;
