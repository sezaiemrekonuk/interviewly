/**
 * The two recorded-audio routes.
 *
 * `POST /interviews/:id/answers/audio` (S03, §3.2) is the original: one recorded answer,
 * transcribed by ElevenLabs Scribe and delegated to the SAME guarded advance a typed answer
 * uses (`advanceWithAnswer`, I06) — there is no second answer path.
 *
 * `POST /interviews/:id/turns/audio` (C06) is its conversational twin, and it exists because
 * the first one always advances. A voice candidate could therefore never be asked a follow-up:
 * every recording consumed a question whatever the interviewer wanted to do with it. This one
 * hands the transcript to `conductTurn` instead, so a clarification stays on the question and
 * only the conductor decides when the index moves. Same split as `/answers` vs `/turns` on the
 * text side (turns.ts): two contracts, two routes, both kept.
 *
 * ADR-S07: the candidate audio is a memory buffer for one request, sent to the provider and
 * discarded. Never `storage.put`, never a DB column, never a log line.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer, { MulterError } from "multer";

import { ApiError } from "../../src/lib/api-error";
import { activeInterview } from "../../src/lib/db";
import { logger } from "../../src/lib/logger";
import { aiClient } from "../ai";
import { advanceWithAnswer, answerInputSchema } from "../interview/answers";
import { BudgetExceeded, withBudget } from "../interview/budget";
import { conductTurn, turnInputSchema } from "../interview/conductor";
import { applyTransition } from "../interview/machine";
import { currentQuestionRow } from "../interview/state";
import { downgradeToText } from "../voice/downgrade";

import { meterStt } from "./metering";
import {
  holdPendingTurn,
  MAX_PENDING_CHARS,
  MAX_PROBES_PER_TURN,
  takePendingTurn,
} from "./pending-turn";
import { speechProvider } from "./SpeechProvider";
import { isPastSpeechCeiling, prewarmMessageSpeech, VOICE_CAPABLE_STATES } from "./tts";

// ponytail: a fixed cap like uploads.ts MAX_BYTES; a single recorded answer is small, and a
// per-answer size limit is not a decision the config surface needs to carry.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MULTIPART_SLACK = 4096;

// The declared part MIME is attacker-controlled, but unlike a PDF nothing here parses the
// bytes — they go straight to the provider — so the allow-list is the whole media-type guard.
const AUDIO_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);

function audioParser(limits: {
  fields: number;
  parts: number;
}): RequestHandler {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1, ...limits },
    fileFilter(_req, file, cb) {
      if (!AUDIO_MIME.has(file.mimetype)) {
        cb(new ApiError("UNSUPPORTED_MEDIA_TYPE"));
        return;
      }
      cb(null, true);
    },
  }).single("audio");
}

/** An answer names the question it answers, so one text field rides along with the recording. */
const parseAudio = audioParser({ fields: 1, parts: 3 });
/**
 * A turn names nothing (C06), and T03's one field is `force`, never text.
 *
 * ADR-T02 is why the held partial is server-side rather than round-tripped: a `pending` field on
 * the wire would let a candidate post words they never spoke into the utterance the conductor
 * answers, the transcript records and the report scores, while paying for a fraction of a second
 * of audio. `force` cannot buy that — all it skips is a gate the candidate skips anyway by
 * staying quiet for six seconds. The multer limit caps the COUNT; `turnFields` below is
 * what refuses a field by name.
 */
const parseTurnAudio = audioParser({ fields: 1, parts: 3 });

/**
 * Content-Length is the cheap path: an honest oversized upload is refused before a byte is
 * buffered. multer's own limit stays as the backstop for a client that lies about its length.
 * Mirrors `uploads.ts`.
 */
function runUpload(
  parse: RequestHandler,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const declared = Number(req.headers["content-length"]);
  if (
    Number.isFinite(declared) &&
    declared > MAX_AUDIO_BYTES + MULTIPART_SLACK
  ) {
    next(new ApiError("UPLOAD_TOO_LARGE"));
    return;
  }

  parse(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      next(
        new ApiError(
          err.code === "LIMIT_FILE_SIZE"
            ? "UPLOAD_TOO_LARGE"
            : "VALIDATION_ERROR",
        ),
      );
      return;
    }
    next(err);
  });
}

export const uploadAudioMiddleware: RequestHandler = (req, res, next) =>
  runUpload(parseAudio, req, res, next);

export const uploadTurnAudioMiddleware: RequestHandler = (req, res, next) =>
  runUpload(parseTurnAudio, req, res, next);

/**
 * Ownership, mode, state and ceiling need nothing from the body, so they run BEFORE multer
 * buffers up to 10 MiB into memory — a rejected request never costs the heap its payload.
 * The interview row is stashed for the handler; `advanceWithAnswer` re-validates state and
 * index atomically, so the parse window between the two cannot smuggle a stale advance.
 * `conductTurn` re-reads the same row for the same reason, which is why both audio routes can
 * share this guard.
 */
export const guardVoiceAnswer: RequestHandler = async (req, res, next) => {
  const interview = await activeInterview(String(req.params.id));
  if (!interview) throw new ApiError("INTERVIEW_NOT_FOUND");
  if (interview.user_id !== req.user!.id) throw new ApiError("FORBIDDEN");
  if (interview.mode !== "voice")
    throw new ApiError("INVALID_STATE_TRANSITION");
  if (!VOICE_CAPABLE_STATES.has(interview.state))
    throw new ApiError("INVALID_STATE_TRANSITION");

  // ADR-S06: the ceiling is checked before the provider is called. A recording that arrives
  // past it ends the interview; it is not billed and not transcribed.
  if (isPastSpeechCeiling(interview)) {
    // ADR-I32: a losing transition must not replace the caller's error — the session is
    // expired whether or not this request is the one that moved the interview.
    try {
      await applyTransition(interview, "evaluating", {
        traceId: req.traceId!,
        endedReason: "time_exhausted",
      });
    } catch (err) {
      logger.error(
        { err, traceId: req.traceId, interviewId: interview.id },
        "INTERVIEW_END_FAILED",
      );
    }
    throw new ApiError("VOICE_SESSION_EXPIRED");
  }

  res.locals.interview = interview;
  next();
};

type VoiceInterview = NonNullable<Awaited<ReturnType<typeof activeInterview>>>;

/** The recording the guard let through, or the 400 that says there wasn't one. */
function recordingFrom(
  req: Request,
  res: Response,
): {
  interview: VoiceInterview;
  file: Express.Multer.File;
} {
  const interview = res.locals.interview as VoiceInterview | undefined;
  if (!interview) throw new ApiError("INTERVIEW_NOT_FOUND");

  const file = req.file;
  if (!file || file.size === 0) throw new ApiError("SPEECH_AUDIO_INVALID");

  return { interview, file };
}

/**
 * The recording, transcribed and paid for.
 *
 * I08 wraps the provider call: an interview already at its budget never reaches Scribe.
 * meterStt writes the `second` `llm_calls` row and increments `spent_usd` in one transaction,
 * under the lock; a `transcribe` that throws bills nothing. Shared by both audio routes so
 * neither can drift into billing the candidate for a session it then refuses to end.
 */
async function transcribeRecording(
  interview: VoiceInterview,
  file: Express.Multer.File,
  traceId: string,
): Promise<{ transcript: string; seconds: number }> {
  try {
    return await withBudget(interview.id, async () => {
      const startedAt = Date.now();
      const result = await speechProvider.transcribe(file.buffer, {
        mime: file.mimetype,
        language: interview.language,
      });
      await meterStt(
        interview.id,
        result.seconds,
        {
          provider: result.provider,
          model: result.model,
          latencyMs: Date.now() - startedAt,
        },
        traceId,
      );
      return result;
    });
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      logger.warn({ traceId, interviewId: interview.id }, "BUDGET_EXHAUSTED");
      // ADR-I32: a losing transition must not replace the caller's error.
      try {
        await applyTransition(interview, "evaluating", {
          traceId,
          endedReason: "budget_exhausted",
        });
      } catch (transitionErr) {
        logger.error(
          { err: transitionErr, traceId, interviewId: interview.id },
          "INTERVIEW_END_FAILED",
        );
      }
      throw new ApiError("BUDGET_EXCEEDED");
    }
    if (err instanceof ApiError && err.code === "VOICE_UNAVAILABLE") {
      await downgradeToText(interview, { traceId });
      throw new ApiError("VOICE_UNAVAILABLE");
    }
    throw err;
  }
}

export const submitAnswerAudio: RequestHandler = async (req, res) => {
  const { interview, file } = recordingFrom(req, res);

  // The client names the question it recorded for, exactly like a typed answer does — that is
  // what lets a retried or duplicate upload fail QUESTION_NOT_CURRENT instead of consuming the
  // next question. Checked against the current row here so a doomed request is never billed.
  const questionId =
    typeof (req.body as Record<string, unknown>)?.questionId === "string"
      ? String((req.body as Record<string, unknown>).questionId)
      : "";
  if (!questionId) throw new ApiError("VALIDATION_ERROR");

  const question = await currentQuestionRow(interview);
  if (!question || question.id !== questionId)
    throw new ApiError("QUESTION_NOT_CURRENT");

  const { transcript, seconds } = await transcribeRecording(
    interview,
    file,
    req.traceId!,
  );
  // The audio buffer is not referenced past this point (ADR-S07).

  // The transcript is untrusted provider output: it reaches `advanceWithAnswer` only through
  // the same parse a typed answer runs. An empty or malformed one changes nothing.
  const parsed = answerInputSchema.safeParse({
    questionId,
    transcript,
    inputMode: "voice",
  });
  if (!parsed.success) throw new ApiError("SPEECH_TRANSCRIPTION_FAILED");

  const result = await advanceWithAnswer(interview, parsed.data, {
    traceId: req.traceId!,
  });

  logger.info(
    { traceId: req.traceId, interviewId: interview.id, seconds },
    "SPEECH_STT_TRANSCRIBED",
  );

  res.status(200).json(result);
};

/**
 * The only field the turn route accepts, and the check that no other one got through: multer's
 * `fields` limit caps how many arrive, not what they are called.
 */
function turnFields(req: Request): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key) => key !== "force"))
    throw new ApiError("VALIDATION_ERROR");
  if (keys.length > 0 && body.force !== "1")
    throw new ApiError("VALIDATION_ERROR");
  return body.force === "1";
}

/** What a held turn returns in place of a conductor result: the interview, exactly as it is. */
const turnState = (interview: VoiceInterview) => ({
  state: interview.state,
  currentIndex: interview.current_index,
});

/**
 * T01's gate, billed like every other provider call (I08).
 *
 * Fails open on everything, including `BudgetExceeded`: `turnComplete` itself never rejects, so
 * what this catch covers is the wrapper around it — and a gate that cannot answer must degrade
 * to today's product, where every fragment was forwarded. The conductor's own `withBudget` still
 * ends the interview if the budget is really gone.
 */
async function utteranceFinished(
  interview: VoiceInterview,
  currentQuestion: string,
  utterance: string,
  traceId: string,
): Promise<boolean> {
  try {
    const verdict = await withBudget(interview.id, () =>
      aiClient().turnComplete({
        utterance,
        currentQuestion,
        language: interview.language,
        ctx: { interviewId: interview.id, traceId },
      }),
    );
    return verdict.finished;
  } catch (err) {
    logger.warn(
      { err, traceId, interviewId: interview.id },
      "CONDUCTOR_TURN_GATE_FAILED",
    );
    return true;
  }
}

/**
 * `POST /interviews/:id/turns/audio` (C06) — one spoken utterance, whatever it turns out to be.
 *
 * No `questionId` and no `QUESTION_NOT_CURRENT` pre-check, and their absence is the point: a
 * turn is not addressed to a question, so there is nothing for the client to name and nothing
 * to be stale about. What `/answers/audio` used that check for — refusing a duplicate upload
 * before it consumed the next question — `conductTurn` covers differently: it decides whether
 * the index moves at all, so a re-sent recording costs a turn, not a question.
 */
export const submitTurnAudio: RequestHandler = async (req, res) => {
  const { interview, file } = recordingFrom(req, res);
  const force = turnFields(req);
  const traceId = req.traceId!;

  // Read before the provider is paid: the row is what the partial is keyed to, and a fragment
  // spoken against a question the interview has since left is dropped rather than joined
  // (spec Open question 3). Not a staleness check on the upload — a turn names no question.
  const question = await currentQuestionRow(interview);
  const taken = await takePendingTurn(interview.id);
  const held =
    taken && question && taken.questionId === question.id ? taken : null;

  const { transcript, seconds } = await transcribeRecording(
    interview,
    file,
    traceId,
  );
  // The audio buffer is not referenced past this point (ADR-S07).

  // Per fragment, not per turn: a turn made of three probes was billed three times, and a log
  // line per conducted turn would report a third of what was spent.
  logger.info(
    { traceId, interviewId: interview.id, seconds },
    "SPEECH_STT_TRANSCRIBED",
  );

  // A probe that caught nothing but silence: the fragment is worth no verdict and the thought
  // already held is worth keeping. Re-held unchanged, so the probe count does not move either.
  if (!transcript.trim() && held) {
    await holdPendingTurn(interview.id, held);
    res.status(200).json({ ...turnState(interview), pendingTurn: held.text });
    return;
  }

  const utterance = [held?.text, transcript.trim()].filter(Boolean).join(" ");
  const probes = held?.probes ?? 0;

  // Three ways past the gate, and the reason all three exist: the turn always ends. `force` is
  // the candidate's Stop, and the two caps are the server's — both counters live in the stored
  // value, so a client cannot reset them by lying about a probe count it does not hold.
  const gated =
    !force &&
    utterance.length > 0 &&
    probes < MAX_PROBES_PER_TURN &&
    utterance.length <= MAX_PENDING_CHARS;

  // The verdict is wanted whether or not it holds: the ledger's open question is the gate's
  // ACCURACY, and a log line that only fires on a hold reports the numerator without the
  // denominator. Same short-circuit as before — the provider is paid only when the gate applies.
  const finished =
    gated && question
      ? await utteranceFinished(interview, question.text, utterance, traceId)
      : true;

  if (gated && question && !finished) {
    await holdPendingTurn(interview.id, {
      text: utterance,
      questionId: question.id,
      probes: probes + 1,
    });
    // K6: length and probe count, never the text — the held partial is candidate speech.
    logger.info(
      {
        traceId,
        interviewId: interview.id,
        chars: utterance.length,
        probes: probes + 1,
      },
      "CONDUCTOR_TURN_HELD",
    );
    res.status(200).json({ ...turnState(interview), pendingTurn: utterance });
    return;
  }

  // K6: length, probe count and the verdict — never the text. `gated: false` is a turn the gate
  // never saw (a Stop, or a cap already reached), and reads differently from one it forwarded.
  logger.info(
    {
      traceId,
      interviewId: interview.id,
      chars: utterance.length,
      probes,
      gated,
      finished,
    },
    "CONDUCTOR_TURN_FORWARDED",
  );

  // Same §7.1 boundary the answer path enforces: the transcript is provider output, and it
  // reaches the conductor only through the schema a typed turn is parsed by. An empty or
  // over-long one is a failed transcription, not an utterance.
  const parsed = turnInputSchema.safeParse({
    text: utterance,
    inputMode: "voice",
  });
  if (!parsed.success) throw new ApiError("SPEECH_TRANSCRIPTION_FAILED");

  const result = await conductTurn(interview, parsed.data, { traceId });

  res.status(200).json({ ...result, pendingTurn: null });

  // L02 — the audio for the lines this turn just wrote is worth synthesising now, off the
  // response, rather than when the room's GET asks for it. Floating and self-swallowing: it
  // never blocks the turn the candidate is waiting on and never fails it.
  for (const id of result.spokenIds) {
    void prewarmMessageSpeech(interview.id, id, traceId);
  }
};
