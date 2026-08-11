/**
 * `@interviewly/ai` — the single AI seam shared by `api` and `worker` (K1).
 *
 * Callers import `AiClient` and the schemas. Nothing outside this package imports a
 * provider SDK; I02 adds the openai→gemini chain behind this same interface.
 */
export type {
  AiClient,
  AiCtx,
  ConductTurnArgs,
  GenerateCandidatesArgs,
  GenerateInterviewTitleArgs,
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ReportIntegrity,
  ScoreAnswerArgs,
  TurnCompleteArgs,
} from './AiClient';
export { TIMEOUT_MS } from './AiClient';

export {
  CandidateSchema,
  ConductorTurnSchema,
  DifficultySchema,
  INTERVIEW_TITLE_MAX,
  InterviewTitleSchema,
  QuestionBatchSchema,
  QuestionKindSchema,
  QuestionSchema,
  ReportPayloadSchema,
  RoundTypeSchema,
  SCORE_MAX,
  ScoresSchema,
  TurnCompleteSchema,
  WidgetSchema,
} from './schemas';
export type {
  Candidate,
  ConductorTurn,
  Difficulty,
  InterviewTitle,
  Question,
  QuestionBatch,
  QuestionKind,
  ReportPayload,
  RoundType,
  Scores,
  TurnComplete,
  Widget,
} from './schemas';

export { PromptRegistry, loadPromptRegistry, PROMPTS_DIR } from './registry';
export type { PromptFile } from './registry';

export { PromptBuilder, createPromptBuilder, MAX_BLOCK_CHARS } from './prompt-builder';
export type { BuildArgs, BuiltPrompt, BuiltPromptMessage } from './prompt-builder';

export { ModelPrices, loadModelPrices, loadInjectionPatterns, CONFIG_DIR } from './config';
export type { InjectionPattern, ModelPrice } from './config';

export { StubAiClient } from './stub';

// The var mappings are exported because callers outside this package legitimately need to
// compile the same prompt a client compiled internally — I04's acceptance steps assert on
// the message an HTTP request produced. Re-deriving the mapping at the call site is exactly
// the drift this module exists to prevent.
export {
  PROMPT_NAMES,
  candidateVars,
  conductVars,
  questionVars,
  reportVars,
  scoreVars,
  titleVars,
  turnCompleteVars,
} from './prompt-vars';
export type { AiMethod } from './prompt-vars';

export { costFor, roundCostUsd, DEFAULT_UNIT_KIND } from './cost';
export type { CallCost, TokenUsage } from './cost';

export {
  BACKOFF_BASE_MS,
  DEFAULT_TRANSPORTS,
  FALLBACK_STEP,
  ProviderCallError,
  buildChain,
  buildSoloChain,
  geminiTransport,
  openaiTransport,
  runChain,
} from './providers';
export type {
  ChainDeps,
  ChainStep,
  FailureKind,
  LlmCallRecord,
  ProviderKeys,
  ProviderRequest,
  ProviderResponse,
  ProviderTransport,
  RecordLlmCall,
} from './providers';

export { LiveAiClient, parseOutput } from './live-client';

export { resolveAiClient, validateProviderKeys } from './resolve-client';
export type { AiRuntimeConfig, KeyValidation, ResolveOpts } from './resolve-client';

export { detectLanguage, SCRIPT_MARGIN, STOPWORD_MARGIN } from './detect-language';
export type { LanguageDetection } from './detect-language';

export { AiError, noopLogger } from './errors';
export type { AiErrorCode, AiLogger } from './errors';

export { AI_CHAT_DEBUG_EVENT, AI_VOICE_DEBUG_EVENT, logAiCall } from './ai-debug';
export type { AiDebugCall, AiDebugMessage } from './ai-debug';
