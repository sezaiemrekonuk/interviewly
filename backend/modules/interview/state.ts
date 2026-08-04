import type { RequestHandler } from 'express';

import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';

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
  }

  return {
    id: question.id,
    text: question.text,
    kind: question.kind,
    // ponytail: widget question kind isn't built yet (I04/I06 scope); always null for now.
    widget: null,
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

// req.interview is attached by resolveInterview (ownership.ts); a non-owned or deleted id
// never reaches this handler (404 INTERVIEW_NOT_FOUND).
export const getInterviewState: RequestHandler = async (req, res) => {
  const interview = req.interview!;

  // Every field is derived from the DB, nothing from the request: a refreshed room with no
  // client memory reconstructs to the same place (§3.8, @AC-9).
  const [{ persona, personas }, currentQuestion, transcript, transcriptCursor] = await Promise.all([
    resolvePersonas(interview.id, interview.state),
    deliverCurrentQuestion(interview),
    resolveTranscript(interview.id),
    prisma.chatMessage.count({ where: { interview_id: interview.id } }),
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
    transcriptCursor,
  });
};

export default getInterviewState;
