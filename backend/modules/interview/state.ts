import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';

// current_index is global 1..N across both rounds (hr then tech, K2). The trap: at setup
// current_index = 0 and there is no question yet — do not seed it to 1, I04/I06 advance it.
async function resolveCurrentQuestion(
  interviewId: string,
  hrQuestionCount: number,
  currentIndex: number,
) {
  if (currentIndex <= 0) return null;
  const roundType = currentIndex <= hrQuestionCount ? 'hr' : 'tech';
  const orderIndex = roundType === 'hr' ? currentIndex : currentIndex - hrQuestionCount;

  const round = await prisma.interviewRound.findFirst({
    where: { interview_id: interviewId, type: roundType },
  });
  if (!round) return null;

  const question = await prisma.question.findFirst({
    where: { round_id: round.id, order_index: orderIndex },
  });
  if (!question) return null;

  return {
    id: question.id,
    text: question.text,
    kind: question.kind,
    // ponytail: widget question kind isn't built yet (I04/I06 scope); always null for now.
    widget: null,
    deliveredAt: question.asked_at,
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

  const [persona, currentQuestion, transcriptCursor] = await Promise.all([
    resolvePersona(interview.id, interview.state),
    resolveCurrentQuestion(interview.id, interview.hr_question_count, interview.current_index),
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
