/**
 * `POST /interviews/:id/answers/audio` (S03, §3.2). One recorded answer is transcribed by
 * ElevenLabs Scribe and delegated to the SAME guarded advance a typed answer uses
 * (`advanceWithAnswer`, I06) — there is no second answer path.
 *
 * ADR-S07: the candidate audio is a memory buffer for one request, sent to the provider and
 * discarded. Never `storage.put`, never a DB column, never a log line.
 */
import type { RequestHandler } from 'express';
import multer, { MulterError } from 'multer';

import { ApiError } from '../../src/lib/api-error';
import { activeInterview } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { advanceWithAnswer, answerInputSchema } from '../interview/answers';
import { BudgetExceeded, withBudget } from '../interview/budget';
import { applyTransition } from '../interview/machine';
import { currentQuestionRow } from '../interview/state';

import { meterStt } from './metering';
import { speechProvider } from './SpeechProvider';
import { isPastSpeechCeiling, VOICE_CAPABLE_STATES } from './tts';

// ponytail: a fixed cap like uploads.ts MAX_BYTES; a single recorded answer is small, and a
// per-answer size limit is not a decision the config surface needs to carry.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MULTIPART_SLACK = 4096;

// The declared part MIME is attacker-controlled, but unlike a PDF nothing here parses the
// bytes — they go straight to the provider — so the allow-list is the whole media-type guard.
const AUDIO_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
]);

const parseAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 1, parts: 3 },
  fileFilter(_req, file, cb) {
    if (!AUDIO_MIME.has(file.mimetype)) {
      cb(new ApiError('UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    cb(null, true);
  },
}).single('audio');

/**
 * Content-Length is the cheap path: an honest oversized upload is refused before a byte is
 * buffered. multer's own limit stays as the backstop for a client that lies about its length.
 * Mirrors `uploads.ts`.
 */
export const uploadAudioMiddleware: RequestHandler = (req, res, next) => {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + MULTIPART_SLACK) {
    next(new ApiError('UPLOAD_TOO_LARGE'));
    return;
  }

  parseAudio(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      next(new ApiError(err.code === 'LIMIT_FILE_SIZE' ? 'UPLOAD_TOO_LARGE' : 'VALIDATION_ERROR'));
      return;
    }
    next(err);
  });
};

/**
 * Ownership, mode, state and ceiling need nothing from the body, so they run BEFORE multer
 * buffers up to 10 MiB into memory — a rejected request never costs the heap its payload.
 * The interview row is stashed for the handler; `advanceWithAnswer` re-validates state and
 * index atomically, so the parse window between the two cannot smuggle a stale advance.
 */
export const guardVoiceAnswer: RequestHandler = async (req, res, next) => {
  const interview = await activeInterview(String(req.params.id));
  if (!interview) throw new ApiError('INTERVIEW_NOT_FOUND');
  if (interview.user_id !== req.user!.id) throw new ApiError('FORBIDDEN');
  if (interview.mode !== 'voice') throw new ApiError('INVALID_STATE_TRANSITION');
  if (!VOICE_CAPABLE_STATES.has(interview.state)) throw new ApiError('INVALID_STATE_TRANSITION');

  // ADR-S06: the ceiling is checked before the provider is called. A recording that arrives
  // past it ends the interview; it is not billed and not transcribed.
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

  res.locals.interview = interview;
  next();
};

export const submitAnswerAudio: RequestHandler = async (req, res) => {
  const interview = res.locals.interview as Awaited<ReturnType<typeof activeInterview>>;
  if (!interview) throw new ApiError('INTERVIEW_NOT_FOUND');

  const file = req.file;
  if (!file || file.size === 0) throw new ApiError('SPEECH_AUDIO_INVALID');

  // The client names the question it recorded for, exactly like a typed answer does — that is
  // what lets a retried or duplicate upload fail QUESTION_NOT_CURRENT instead of consuming the
  // next question. Checked against the current row here so a doomed request is never billed.
  const questionId = typeof (req.body as Record<string, unknown>)?.questionId === 'string'
    ? String((req.body as Record<string, unknown>).questionId)
    : '';
  if (!questionId) throw new ApiError('VALIDATION_ERROR');

  const question = await currentQuestionRow(interview);
  if (!question || question.id !== questionId) throw new ApiError('QUESTION_NOT_CURRENT');

  // I08 wraps the provider call: an interview already at its budget never reaches Scribe.
  // meterStt writes the `second` `llm_calls` row and increments `spent_usd` in one
  // transaction, under the lock; a `transcribe` that throws bills nothing.
  let transcript: string;
  let seconds: number;
  try {
    ({ transcript, seconds } = await withBudget(interview.id, async () => {
      const result = await speechProvider.transcribe(file.buffer, {
        mime: file.mimetype,
        language: interview.language,
      });
      await meterStt(interview.id, result.seconds, req.traceId!);
      return result;
    }));
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      logger.warn({ traceId: req.traceId, interviewId: interview.id }, 'BUDGET_EXHAUSTED');
      // ADR-I32: a losing transition must not replace the caller's error.
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
    throw err;
  }
  // The audio buffer is not referenced past this point (ADR-S07).

  // The transcript is untrusted provider output: it reaches `advanceWithAnswer` only through
  // the same parse a typed answer runs. An empty or malformed one changes nothing.
  const parsed = answerInputSchema.safeParse({
    questionId,
    transcript,
    inputMode: 'voice',
  });
  if (!parsed.success) throw new ApiError('SPEECH_TRANSCRIPTION_FAILED');

  const result = await advanceWithAnswer(interview, parsed.data, { traceId: req.traceId! });

  logger.info(
    { traceId: req.traceId, interviewId: interview.id, seconds },
    'SPEECH_STT_TRANSCRIBED',
  );

  res.status(200).json(result);
};
