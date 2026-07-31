/**
 * `@interviewly/ai` — the single AI seam shared by `api` and `worker` (K1).
 *
 * Callers import `AiClient` and the schemas. Nothing outside this package imports a
 * provider SDK; I02 adds the openai→gemini chain behind this same interface.
 */
export type {
  AiClient,
  AiCtx,
  GenerateCandidatesArgs,
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ScoreAnswerArgs,
} from './AiClient';
export { TIMEOUT_MS } from './AiClient';

export {
  CandidateSchema,
  DifficultySchema,
  QuestionBatchSchema,
  QuestionKindSchema,
  QuestionSchema,
  ReportPayloadSchema,
  RoundTypeSchema,
  ScoresSchema,
} from './schemas';
export type {
  Candidate,
  Difficulty,
  Question,
  QuestionBatch,
  QuestionKind,
  ReportPayload,
  RoundType,
  Scores,
} from './schemas';

export { PromptRegistry, loadPromptRegistry, PROMPTS_DIR } from './registry';
export type { PromptFile } from './registry';

export { PromptBuilder, createPromptBuilder, MAX_BLOCK_CHARS } from './prompt-builder';
export type { BuildArgs, BuiltPrompt, BuiltPromptMessage } from './prompt-builder';

export { ModelPrices, loadModelPrices, loadInjectionPatterns, CONFIG_DIR } from './config';
export type { InjectionPattern, ModelPrice } from './config';

export { StubAiClient } from './stub';

export { detectLanguage, SCRIPT_MARGIN, STOPWORD_MARGIN } from './detect-language';
export type { LanguageDetection } from './detect-language';

export { AiError, noopLogger } from './errors';
export type { AiErrorCode, AiLogger } from './errors';
