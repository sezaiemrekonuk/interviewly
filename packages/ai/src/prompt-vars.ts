/**
 * The `AiClient` method → prompt name + template variables mapping, in one place.
 *
 * `StubAiClient` and `LiveAiClient` compile the same prompts from the same arguments. When
 * that mapping lived in both, a new `{{var}}` in a prompt file would only ever be noticed by
 * whichever client the next test happened to run — the other would throw
 * `AI_PROMPT_BUILD_FAILED` in production. One table, both callers.
 */
import type {
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
  };
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
