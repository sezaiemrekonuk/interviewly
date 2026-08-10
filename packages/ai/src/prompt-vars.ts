/**
 * The `AiClient` method → prompt name + template variables mapping, in one place.
 *
 * `StubAiClient` and `LiveAiClient` compile the same prompts from the same arguments. When
 * that mapping lived in both, a new `{{var}}` in a prompt file would only ever be noticed by
 * whichever client the next test happened to run — the other would throw
 * `AI_PROMPT_BUILD_FAILED` in production. One table, both callers.
 */
import type {
  ConductTurnArgs,
  GenerateCandidatesArgs,
  GenerateInterviewTitleArgs,
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ScoreAnswerArgs,
} from './AiClient';

export const PROMPT_NAMES = {
  generateRoundQuestions: 'interview.question.generate',
  generateReport: 'interview.report.generate',
  scoreAnswer: 'interview.answer.score',
  generateCandidates: 'interview.question.candidates',
  generateInterviewTitle: 'interview.title.generate',
  conductTurn: 'interview.conduct.turn',
} as const;

export type AiMethod = keyof typeof PROMPT_NAMES;

export function questionVars(args: GenerateRoundQuestionsArgs): Record<string, unknown> {
  return {
    roundType: args.roundType,
    count: args.count,
    language: args.language,
    jobListing: args.jobListing,
    candidateProfile: args.candidateProfile,
    candidateCv: args.candidateCv,
    priorTopics: args.priorTopics?.join(', ') || 'none',
  };
}

export function reportVars(args: GenerateReportArgs): Record<string, unknown> {
  return {
    language: args.language,
    perAnswerScores: args.perAnswerScores ? JSON.stringify(args.perAnswerScores) : 'none',
    transcript: args.transcript,
    candidateProfile: args.candidateProfile,
    candidateCv: args.candidateCv,
    endedReason: args.endedReason,
    // One string rather than two numbers: the prompt has to reason about the *ratio*, and a
    // model told "3" and "8" in separate fields reliably scores as though it saw eight.
    coverage: `${args.answeredCount} of ${args.plannedCount} planned questions were answered`,
  };
}

/**
 * The one call whose variables are mostly conversation. `conversation` is flattened here
 * rather than in the client so both clients send the provider the same bytes — a builder that
 * received an array would `String(...)` it into `[object Object]` and the prompt would be
 * silently blind to the interview it is conducting.
 */
export function conductVars(args: ConductTurnArgs): Record<string, unknown> {
  return {
    personaBrief: args.personaBrief,
    personaName: args.personaName,
    roundType: args.roundType,
    language: args.language,
    jobListing: args.jobListing,
    candidateProfile: args.candidateProfile,
    candidateCv: args.candidateCv,
    currentQuestion: args.currentQuestion ?? 'none — you have not asked anything yet',
    currentIntent: args.currentIntent ?? 'none recorded',
    remainingTopics: args.remainingTopics.join(', ') || 'none',
    conversation: formatConversation(args.conversation),
    turnsLeftOnQuestion: args.turnsLeftOnQuestion,
    allowedActions: allowedActions(args).join(', '),
  };
}

/** `SPEAKER: text` blocks, oldest first — the shape the score prompt already uses for turns. */
function formatConversation(turns: ConductTurnArgs['conversation']): string {
  if (turns.length === 0) return 'none — the interview has not started';
  const speaker = { user: 'CANDIDATE', assistant: 'INTERVIEWER', system: 'SYSTEM' } as const;
  return turns.map((t) => `${speaker[t.role]}: ${t.content}`).join('\n\n');
}

/**
 * The guards, stated to the model as well as enforced by the server. Enforcement alone would
 * be enough for correctness and produces a worse interview: an interviewer that keeps trying
 * to hand over and keeps being refused spends its turns on the refusal instead of the
 * candidate. Telling it the truth up front is cheaper than correcting it afterwards — but it
 * is a hint, never the check. `conductor.ts` re-derives all of this.
 */
function allowedActions(args: ConductTurnArgs): string[] {
  const actions = ['continue', 'next_question', 'show_widget'];
  if (args.mayHandOver) actions.push('handover');
  if (args.mayEnd) actions.push('end_interview');
  return actions;
}

export function scoreVars(args: ScoreAnswerArgs): Record<string, unknown> {
  return {
    language: args.language,
    question: args.question,
    transcript: args.transcript,
    candidateProfile: args.candidateProfile,
  };
}

export function titleVars(args: GenerateInterviewTitleArgs): Record<string, unknown> {
  return {
    language: args.language,
    jobListing: args.jobListing,
  };
}

export function candidateVars(args: GenerateCandidatesArgs): Record<string, unknown> {
  return {
    language: args.language,
    priorScore: args.priorScore,
    priorQuestion: args.priorQuestion,
    topicsUsed: args.topicsUsed.join(', ') || 'none',
  };
}
