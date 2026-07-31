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
async function deliverCurrentQuestion(interview: IndexedInterview) {
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

// ponytail: avatarState is a fixed 'idle' placeholder — driving it off live SSE interaction
// is I07's job (§3.6). Upgrade when the SSE avatar driver lands.
async function resolvePersona(interviewId: string, state: string) {
  const roundType = state === 'hr_round' ? 'hr' : state === 'tech_round' ? 'tech' : null;
  if (!roundType) return null;

  const round = await prisma.interviewRound.findFirst({
    where: { interview_id: interviewId, type: roundType },
    include: { persona: true },
  });
  if (!round) return null;

  return { role: round.persona.role, name: round.persona.name, avatarState: 'idle' as const };
}

// req.interview is attached by resolveInterview (ownership.ts); a non-owned or deleted id
// never reaches this handler (404 INTERVIEW_NOT_FOUND).
export const getInterviewState: RequestHandler = async (req, res) => {
  const interview = req.interview!;

  // Every field is derived from the DB, nothing from the request: a refreshed room with no
  // client memory reconstructs to the same place (§3.8, @AC-9).
  const [persona, currentQuestion, transcriptCursor] = await Promise.all([
    resolvePersona(interview.id, interview.state),
    deliverCurrentQuestion(interview),
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
    currentQuestion,
    transcriptCursor,
  });
};

export default getInterviewState;
