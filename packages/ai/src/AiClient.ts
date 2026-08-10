/**
 * The one seam. `api` and `worker` reach AI work through this interface and no other way —
 * no module outside this package imports a provider SDK (I02 keeps them internal).
 *
 * Every async method binds a per-attempt timeout, records one `llm_calls` row per attempt
 * and returns a value already validated against its Zod schema (I02). `detectLanguage` is
 * the odd one out on purpose: it is synchronous, makes no call, and records nothing.
 */
import type { AiCtx } from './prompt-builder';
import type { LanguageDetection } from './detect-language';
import type {
  Candidate,
  ConductorTurn,
  InterviewTitle,
  QuestionBatch,
  ReportPayload,
  RoundType,
  Scores,
} from './schemas';

export type { AiCtx } from './prompt-builder';

/** Per-attempt timeouts, ai spec B6/Q3. Enforced by I02, declared here with the seam. */
export const TIMEOUT_MS = {
  generateRoundQuestions: 15_000,
  scoreAnswer: 15_000,
  generateCandidates: 15_000,
  generateReport: 90_000,
  generateInterviewTitle: 8_000,
  // C02: the only call a candidate waits on with nothing on screen. Every other interactive
  // call happens behind a question they are already reading, so 15 s there is a slow turn and
  // 15 s here is a room that looks dead. Ten is the point past which the retry costs less
  // than the wait.
  conductTurn: 10_000,
} as const;

export interface GenerateRoundQuestionsArgs {
  roundType: RoundType;
  count: number;
  jobListing: string;
  candidateProfile: unknown | null;
  candidateCv: string | null;
  language: string;
  priorTopics?: string[];
  ctx: AiCtx;
}

export interface GenerateReportArgs {
  transcript: string;
  perAnswerScores?: Scores[];
  candidateProfile: unknown | null;
  candidateCv: string | null;
  language: string;
  /**
   * C03 — why the interview stopped, and how much of it happened. An interview the
   * interviewer cut short answers fewer questions than it planned to, and the transcript
   * alone cannot tell the model whether that is a candidate who ran out of things to say or
   * one who was shown the door. Without it a two-of-eight interview was scored on the same
   * terms as a complete one and read as merely thin.
   */
  endedReason: string;
  answeredCount: number;
  plannedCount: number;
  ctx: AiCtx;
}

/**
 * C02 — one turn of the interview, conducted rather than counted.
 *
 * Everything here except `conversation` is server truth; `conversation` is the replayed
 * `chat_messages` for this interview and carries the candidate's own words, so it crosses
 * the §7.1 boundary and is compiled as a bound value like any other untrusted block.
 */
export interface ConductTurnArgs {
  /** `personas.system_prompt` — who is asking. Seeded since F02, unread until now. */
  personaBrief: string;
  personaName: string;
  roundType: RoundType;
  jobListing: string;
  candidateProfile: unknown | null;
  candidateCv: string | null;
  language: string;
  /** The question the interview is on, and what it was meant to find out. */
  currentQuestion: string | null;
  currentIntent: string | null;
  /** What this round still has to cover, so the conductor can pace itself. */
  remainingTopics: string[];
  /** The whole interview so far, oldest first. */
  conversation: { role: 'user' | 'assistant' | 'system'; content: string }[];
  /** How many more times it may answer before the server advances the question for it. */
  turnsLeftOnQuestion: number;
  /** False while the round is below its floor, which makes `handover` illegal (C02 guard 2). */
  mayHandOver: boolean;
  /** False on the opening turn, which makes `end_interview` illegal (C02 guard 3). */
  mayEnd: boolean;
  ctx: AiCtx;
}

export interface ScoreAnswerArgs {
  question: string;
  transcript: string;
  candidateProfile: unknown | null;
  language: string;
  ctx: AiCtx;
}

export interface GenerateInterviewTitleArgs {
  jobListing: string;
  language: string;
  ctx: AiCtx;
}

export interface GenerateCandidatesArgs {
  priorQuestion: string;
  priorScore: number;
  topicsUsed: string[];
  language: string;
  ctx: AiCtx;
}

export interface AiClient {
  /**
   * One call produces a whole round. The returned batch is schema-valid but its LENGTH is
   * the caller's check: `questions.length === count` or `AI_OUTPUT_INVALID` (I04).
   */
  generateRoundQuestions(args: GenerateRoundQuestionsArgs): Promise<QuestionBatch>;
  generateReport(args: GenerateReportArgs): Promise<ReportPayload>;
  /**
   * C02 — what to say next, and what the server should do about it. The returned action is a
   * request the caller re-validates against the interview's state; nothing here is authority.
   */
  conductTurn(args: ConductTurnArgs): Promise<ConductorTurn>;
  /** K4 hook consumed by the `adaptive` ledger; interface and stub ship in I01. */
  scoreAnswer(args: ScoreAnswerArgs): Promise<Scores>;
  /** K4 hook: easier / same / harder, in that order. */
  generateCandidates(args: GenerateCandidatesArgs): Promise<Candidate[]>;
  generateInterviewTitle(args: GenerateInterviewTitleArgs): Promise<InterviewTitle>;
  /** No LLM call, no `llm_calls` row, no network (ai AC-13). */
  detectLanguage(text: string, current: string): LanguageDetection;
}
