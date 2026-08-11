import type { RequestHandler } from 'express';

import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { type Ceilinged, speechExpiresAt } from '../speech/ceiling';

import { activeSeconds } from './elapsed';

import { seededPersona } from './generation';

/** The columns the index walk needs — an `Interview` satisfies it; a test fixture need not. */
export interface IndexedInterview {
  id: string;
  hr_question_count: number;
  current_index: number;
}

/**
 * The question row `current_index` points at, or null.
 *
 * `current_index` is global 1..N across both rounds (hr then tech, K2) while `order_index` is
 * per-round, so the walk subtracts the HR count in the technical round. The trap: at setup
 * `current_index = 0` and there is no question yet — do not seed it to 1, I04/I06 advance it.
 *
 * Exported because I06's answer guard resolves the same row; two copies of this arithmetic
 * would let the guard and the room disagree about which question is current.
 */
export async function currentQuestionRow(interview: IndexedInterview) {
  const { current_index: index, hr_question_count: hrCount } = interview;
  if (index <= 0) return null;

  const roundType = index <= hrCount ? 'hr' : 'tech';
  const round = await prisma.interviewRound.findFirst({
    where: { interview_id: interview.id, type: roundType },
  });
  if (!round) return null;

  return prisma.question.findFirst({
    where: { round_id: round.id, order_index: roundType === 'hr' ? index : index - hrCount },
  });
}

/**
 * Resolving the current question is also *delivering* it: `asked_at` is stamped here, on the
 * server clock, the first time the question is handed to a client. That timestamp is the only
 * `duration_ms` baseline I06 will accept — a client-supplied start time is not evidence.
 */
export async function deliverCurrentQuestion(interview: IndexedInterview) {
  const question = await currentQuestionRow(interview);
  if (!question) return null;

  const deliveredAt = question.asked_at ?? clock.now();
  if (!question.asked_at) {
    await prisma.question.update({ where: { id: question.id }, data: { asked_at: deliveredAt } });
    // Once per question, at the stamp: a refetch re-delivers the same row, and counting those
    // would make a difficulty histogram measure polling instead of the interview.
    logger.info(
      {
        interviewId: interview.id,
        questionId: question.id,
        difficulty: question.difficulty,
        topic: question.topic,
        kind: question.kind,
        chosenReason: question.chosen_reason,
        currentIndex: interview.current_index,
      },
      'QUESTION_DIFFICULTY_DELIVERED',
    );
  }

  return {
    id: question.id,
    text: question.text,
    kind: question.kind,
    // C04 — the typed answer surface, when the conductor put one on screen. Null is the
    // ordinary spoken-or-typed answer, which is most questions; the hardcoded null this
    // replaces had been standing in since I04 with nothing to write it.
    widget: question.widget ?? null,
    deliveredAt,
  };
}

const ROUND_ORDER = { hr: 0, tech: 1 } as const;

/** The columns the roster is planned from — the round shape, not the rows generated so far. */
export interface RosteredInterview {
  id: string;
  state: string;
  hr_question_count: number;
  target_question_count: number;
}

/**
 * The rounds this interview is going to have, from its shape alone, in `ROUND_ORDER` — so the
 * caller sorts nothing.
 *
 * Technical is conditional because the split can leave it empty: `target 2 → hr 2, tech 0` is a
 * legal interview that ends straight out of the HR round (`machine.ts` carries the edge for it),
 * and promising a second interviewer who is never coming is the same lie in the other direction.
 */
function plannedRounds(interview: RosteredInterview): Array<'hr' | 'tech'> {
  const techCount = interview.target_question_count - interview.hr_question_count;
  return techCount > 0 ? ['hr', 'tech'] : ['hr'];
}

/**
 * The active speaker plus the full round roster. The room shows two tiles and only one may be
 * live (§3.2, K2), so the inactive tile needs an identity the client cannot invent — `persona`
 * alone forced W06 to guess one. `avatar_set` rides along because it is the only source of the
 * content-addressed `personas/{id}/{state}-{sha}.webp` keys.
 *
 * The roster is planned, not observed (#129). It used to be whatever `interview_rounds` rows
 * happened to exist, which made the candidate's tile grid a side effect of question generation:
 * the technical row is written with its batch, so the first HR question was asked against a
 * one-tile room and the second interviewer appeared mid-interview. Deriving it from the round
 * shape instead keeps the count fixed for the whole interview, and leaves untouched the
 * invariant `currentQuestionRow` depends on — a round row still means its questions exist.
 *
 * The generated row still wins where there is one: it names the persona actually assigned, and
 * `seededPersona` is only the fallback for a round whose batch has not been written yet. That
 * is the same lookup `generation.ts` will use when it does write it, so the tile does not
 * change identity at the handover.
 *
 * ponytail: avatarState is a fixed 'idle' placeholder — driving it off live SSE interaction
 * is I07's job (§3.6). Upgrade when the SSE avatar driver lands.
 */
export async function resolvePersonas(interview: RosteredInterview) {
  const rounds = await prisma.interviewRound.findMany({
    where: { interview_id: interview.id },
    include: { persona: true },
  });

  const byType = new Map(rounds.map((round) => [round.type, round]));

  const personas = await Promise.all(
    plannedRounds(interview).map(async (roundType) => {
      const persona = byType.get(roundType)?.persona ?? (await seededPersona(roundType));
      return {
        id: persona.id,
        role: persona.role,
        name: persona.name,
        roundType,
        avatarSet: persona.avatar_set,
      };
    }),
  );

  const { state } = interview;
  const activeType = state === 'hr_round' ? 'hr' : state === 'tech_round' ? 'tech' : null;
  const active = activeType ? personas.find((p) => p.roundType === activeType) : undefined;

  return {
    personas,
    persona: active
      ? { id: active.id, role: active.role, name: active.name, avatarState: 'idle' as const }
      : null,
  };
}

export interface TranscriptQuestion {
  id: string;
  text: string;
  order_index: number;
  round: { type: 'hr' | 'tech' };
  answers: { transcript: string; answered_at: Date | null }[];
}

/**
 * Answered turns in the order they were asked — HR round first, then technical (K2's global
 * index order, which `order_index` alone does not carry because it is per-round).
 * Exported pure so the ordering is testable without a database.
 */
export function orderTranscript(questions: TranscriptQuestion[]) {
  return questions
    .filter((q) => q.answers.length > 0)
    .sort(
      (a, b) =>
        ROUND_ORDER[a.round.type] - ROUND_ORDER[b.round.type] || a.order_index - b.order_index,
    )
    .map((q) => ({
      questionId: q.id,
      question: q.text,
      answer: q.answers[q.answers.length - 1].transcript,
      roundType: q.round.type,
    }));
}

// ponytail: the whole transcript ships on every room refetch. At <= 10 turns that is a few KB;
// page it off a cursor if the turn count ever grows.
async function resolveTranscript(interviewId: string) {
  const questions = await prisma.question.findMany({
    where: { round: { interview_id: interviewId } },
    select: {
      id: true,
      text: true,
      order_index: true,
      round: { select: { type: true } },
      answers: { select: { transcript: true, answered_at: true }, orderBy: { answered_at: 'asc' } },
    },
  });

  return orderTranscript(questions as TranscriptQuestion[]);
}

/**
 * C02 — the conversation, which since the conductor landed is the interview's actual state.
 *
 * `transcript` above is question/answer pairs, and it stays: the report ledger and the report
 * page read it, and pairs are what a finished interview looks like. This is the other view —
 * what was said, in order, including everything a pair cannot hold: the welcome, the
 * clarifications, the handover, and the system line where the server overrode the interviewer.
 *
 * A room rebuilds itself from this alone (§3.8), which is the whole reason assistant rows are
 * written before they are spoken rather than after.
 */
async function resolveMessages(interviewId: string) {
  const rows = await prisma.chatMessage.findMany({
    // C07 — the refusal notes stay out of the room. They are written for the interviewer, and
    // showing them to the candidate would narrate the guard that just stopped them: "the server
    // refused because this round has not covered enough questions yet" is a recipe. The drift
    // note is different and stays visible — it is about the candidate's own turn, not about a
    // rule they could aim at.
    //
    // The null branch is load-bearing: every candidate turn has `action = null`, and both
    // `NOT: { action: 'refused' }` and `action: { not: 'refused' }` compile to SQL that is
    // NULL — and so excludes the row — wherever `action` is null. Without the explicit
    // `action: null`, the whole candidate side of the conversation vanishes from the room.
    where: {
      interview_id: interviewId,
      OR: [{ action: null }, { action: { not: 'refused' } }],
    },
    // Same order the conductor replays in. A user utterance and the reply to it are written
    // inside one request and can share a millisecond; `id` breaks that tie the same way twice.
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      role: true,
      content: true,
      action: true,
      question_id: true,
      created_at: true,
      // Which interviewer said it. Without this the room labels every past line with whoever
      // holds the floor *now*, so after the handover the HR round's questions are attributed to
      // the technical interviewer — a transcript that misreports who asked what.
      //
      // Derived from the question rather than stored on the message: the round a question
      // belongs to is already a fact of the schema, and a copy on `chat_messages` would be a
      // second place for it to be wrong.
      question: { select: { round: { select: { type: true } } } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    action: m.action,
    questionId: m.question_id,
    // Null for the lines that belong to no question — the welcome, the handover, the closing
    // line. The room falls back to whoever has the floor for those, which is right: they are
    // said by the interviewer who is speaking at that moment.
    roundType: m.question?.round.type ?? null,
    createdAt: m.created_at,
  }));
}

export interface TimedInterview extends Ceilinged {
  mode: string;
}

/**
 * The window the room counts down (S09, speech AC-12). `expiresAt` is `speechExpiresAt` — the
 * instant `isPastSpeechCeiling` refuses on — so a rendered countdown and a `VOICE_SESSION_EXPIRED`
 * cannot name different times.
 *
 * Text reports `expiresAt: null` rather than a number: the ceiling is enforced only by the two
 * speech routes, both of which refuse `mode !== 'voice'`, so any deadline here would be one
 * nothing applies. A downgraded interview lands in the same branch on its next refetch.
 *
 * `elapsedSeconds` is I16's active time and is reported in both modes — it is the room's own
 * readout, not the ceiling, and a text interview has one too. It is a snapshot, so the client
 * ticks forward from the instant it received it rather than treating it as still current;
 * `startedAt` is no longer the anchor for that and remains only as the interview's date.
 */
export function interviewWindow(interview: TimedInterview, now: Date = clock.now()) {
  const expiresAt = interview.mode === 'voice' ? speechExpiresAt(interview, now) : null;
  return {
    startedAt: interview.started_at?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    elapsedSeconds: Math.floor(activeSeconds(interview, now)),
  };
}

// req.interview is attached by resolveInterview (ownership.ts); a non-owned or deleted id
// never reaches this handler (404 INTERVIEW_NOT_FOUND).
export const getInterviewState: RequestHandler = async (req, res) => {
  const interview = req.interview!;

  // Every field is derived from the DB, nothing from the request: a refreshed room with no
  // client memory reconstructs to the same place (§3.8, @AC-9).
  const [{ persona, personas }, currentQuestion, transcript, messages] = await Promise.all([
    resolvePersonas(interview),
    deliverCurrentQuestion(interview),
    resolveTranscript(interview.id),
    resolveMessages(interview.id),
  ]);

  res.status(200).json({
    interviewId: interview.id,
    state: interview.state,
    mode: interview.mode,
    currentIndex: interview.current_index,
    targetQuestionCount: interview.target_question_count,
    endedReason: interview.ended_reason,
    language: interview.language,
    ...interviewWindow(interview),
    persona,
    personas,
    currentQuestion,
    transcript,
    messages,
    // Answers, not messages. This was `chatMessage.count(...)` and the two were the same number
    // only because `chat_messages` held exactly one row per answered turn. C02 puts the
    // interviewer's own lines in the same table, so counting rows would make the cursor jump on
    // a greeting — `interview_flow.feature` caught it as "3 answers" reading 4. The field means
    // how far through the transcript the interview is, and that is still the answer count.
    transcriptCursor: messages.filter((m) => m.role === 'user').length,
  });
};

export default getInterviewState;
