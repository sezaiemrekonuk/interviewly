import type { RequestHandler } from 'express';

import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

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

/**
 * The active speaker plus the full round roster. The room shows two tiles and only one may be
 * live (§3.2, K2), so the inactive tile needs an identity the client cannot invent — `persona`
 * alone forced W06 to guess one. `avatar_set` rides along because it is the only source of the
 * content-addressed `personas/{id}/{state}-{sha}.webp` keys.
 *
 * ponytail: avatarState is a fixed 'idle' placeholder — driving it off live SSE interaction
 * is I07's job (§3.6). Upgrade when the SSE avatar driver lands.
 */
async function resolvePersonas(interviewId: string, state: string) {
  const rounds = await prisma.interviewRound.findMany({
    where: { interview_id: interviewId },
    include: { persona: true },
  });

  const personas = rounds
    .slice()
    .sort((a, b) => ROUND_ORDER[a.type] - ROUND_ORDER[b.type])
    .map((round) => ({
      id: round.persona.id,
      role: round.persona.role,
      name: round.persona.name,
      roundType: round.type,
      avatarSet: round.persona.avatar_set,
    }));

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
    where: { interview_id: interviewId },
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

// req.interview is attached by resolveInterview (ownership.ts); a non-owned or deleted id
// never reaches this handler (404 INTERVIEW_NOT_FOUND).
export const getInterviewState: RequestHandler = async (req, res) => {
  const interview = req.interview!;

  // Every field is derived from the DB, nothing from the request: a refreshed room with no
  // client memory reconstructs to the same place (§3.8, @AC-9).
  const [{ persona, personas }, currentQuestion, transcript, messages] = await Promise.all([
    resolvePersonas(interview.id, interview.state),
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
