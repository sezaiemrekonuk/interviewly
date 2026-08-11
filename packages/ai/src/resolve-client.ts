/**
 * B7 — the `AI_ENABLED` kill switch and the boot-time provider-key check.
 *
 * Both live here rather than in `backend` because both need the prompt registry, and the
 * registry is this package's. What `backend` supplies is the two things this package cannot
 * have: the `llm_calls` writer (Prisma) and the keys (env).
 */
import type { AiClient, ConductTurnArgs, GenerateCandidatesArgs, GenerateInterviewTitleArgs, GenerateReportArgs, GenerateRoundQuestionsArgs, ScoreAnswerArgs, TurnCompleteArgs, ValidateListingArgs } from './AiClient';
import { DEFAULT_UNIT_KIND } from './cost';
import { AiError, noopLogger, type AiLogger } from './errors';
import { LiveAiClient } from './live-client';
import { createPromptBuilder, type PromptBuilder } from './prompt-builder';
import { PROMPT_NAMES, type AiMethod } from './prompt-vars';
import { FALLBACK_STEP, type ChainDeps, type ProviderKeys } from './providers';
import { loadPromptRegistry, type PromptRegistry } from './registry';
import { StubAiClient } from './stub';
import type { LanguageDetection } from './detect-language';
import type { AiCtx } from './prompt-builder';
import type { Candidate, ConductorTurn, InterviewTitle, ListingCheck, QuestionBatch, ReportPayload, Scores, TurnComplete } from './schemas';

export interface AiRuntimeConfig {
  AI_ENABLED: boolean;
}

export interface ResolveOpts {
  builder?: PromptBuilder;
  registry?: PromptRegistry;
}

export function resolveAiClient(
  config: AiRuntimeConfig,
  deps: ChainDeps,
  opts: ResolveOpts = {},
): AiClient {
  const builder = opts.builder ?? createPromptBuilder({ logger: deps.logger });
  if (config.AI_ENABLED) return new LiveAiClient(deps, { builder });

  // Stub mode still audits. The interview costs nothing, but "nothing" is a number the
  // cost report has to be able to show — an interview with no rows at all looks like an
  // interview that was never run.
  return new StubRecordingClient(
    new StubAiClient({ builder }),
    deps,
    opts.registry ?? loadPromptRegistry(),
  );
}

export interface KeyValidation {
  /** True when `AI_ENABLED=false` — a teammate with no key still boots (§9.1). */
  skipped: boolean;
  /** Providers actually checked. Empty when skipped. */
  validated: string[];
}

/**
 * B7. Every provider named by a loaded prompt file must have a key, or startup fails before
 * serving anything.
 *
 * Tier-2 is deliberately NOT fatal: no prompt file names gemini, the chain does (B6). A
 * missing tier-2 key costs the fallback, not the service, so it warns and boots — failing
 * here would take the whole API down over a degraded retry path.
 */
export function validateProviderKeys(
  config: AiRuntimeConfig,
  keys: ProviderKeys,
  opts: { registry?: PromptRegistry; logger?: AiLogger } = {},
): KeyValidation {
  if (!config.AI_ENABLED) return { skipped: true, validated: [] };

  const logger = opts.logger ?? noopLogger;
  const registry = opts.registry ?? loadPromptRegistry();
  const declared = registry.providers();

  const missing = declared.filter((provider) => !keys[provider]);
  if (missing.length > 0) {
    // Names the provider, never the key or the variable it should have come from.
    throw new AiError(
      'PROVIDER_KEY_MISSING',
      `no api key configured for provider(s): ${missing.join(', ')}`,
    );
  }

  if (!keys[FALLBACK_STEP.provider]) {
    logger.warn(
      { provider: FALLBACK_STEP.provider, fatal: false },
      'PROVIDER_KEY_MISSING',
    );
  }

  return { skipped: false, validated: declared };
}

/**
 * `StubAiClient` cannot write its own audit row — it lives in a package that depends on
 * neither Prisma nor `backend` (I01 hand-off). This wrapper is where the injected writer
 * finally meets it.
 */
class StubRecordingClient implements AiClient {
  constructor(
    private readonly stub: StubAiClient,
    private readonly deps: ChainDeps,
    private readonly registry: PromptRegistry,
  ) {}

  generateRoundQuestions(args: GenerateRoundQuestionsArgs): Promise<QuestionBatch> {
    return this.audited('generateRoundQuestions', args.ctx, () =>
      this.stub.generateRoundQuestions(args),
    );
  }

  generateReport(args: GenerateReportArgs): Promise<ReportPayload> {
    return this.audited('generateReport', args.ctx, () => this.stub.generateReport(args));
  }

  scoreAnswer(args: ScoreAnswerArgs): Promise<Scores> {
    return this.audited('scoreAnswer', args.ctx, () => this.stub.scoreAnswer(args));
  }

  generateCandidates(args: GenerateCandidatesArgs): Promise<Candidate[]> {
    return this.audited('generateCandidates', args.ctx, () =>
      this.stub.generateCandidates(args),
    );
  }

  generateInterviewTitle(args: GenerateInterviewTitleArgs): Promise<InterviewTitle> {
    return this.audited('generateInterviewTitle', args.ctx, () =>
      this.stub.generateInterviewTitle(args),
    );
  }

  validateListing(args: ValidateListingArgs): Promise<ListingCheck> {
    return this.audited('validateListing', args.ctx, () => this.stub.validateListing(args));
  }

  conductTurn(args: ConductTurnArgs): Promise<ConductorTurn> {
    return this.audited('conductTurn', args.ctx, () => this.stub.conductTurn(args));
  }

  /** Audited like the rest, and fail-open like the live one: the wrapper's own write must
   * not be what turns a stubbed gate into a thrown error at the call site (ADR-T03). */
  turnComplete(args: TurnCompleteArgs): Promise<TurnComplete> {
    return this.audited('turnComplete', args.ctx, () => this.stub.turnComplete(args)).catch(
      () => ({ finished: true }),
    );
  }

  detectLanguage(text: string, current: string): LanguageDetection {
    return this.stub.detectLanguage(text, current);
  }

  private async audited<T>(method: AiMethod, ctx: AiCtx, run: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const value = await run();
    const latencyMs = Date.now() - startedAt;

    // The prompt was really compiled, so the row names the real prompt version — a stubbed
    // interview stays traceable to the prompt lineage that produced it.
    const prompt = this.registry.resolve(PROMPT_NAMES[method]);

    (this.deps.logger ?? noopLogger).warn(
      { traceId: ctx.traceId, interviewId: ctx.interviewId, method },
      'AI_DISABLED_STUB_MODE',
    );

    await this.deps.recordLlmCall({
      interviewId: ctx.interviewId,
      provider: prompt.provider,
      model: prompt.model,
      promptUuid: prompt.uuid,
      promptVersion: prompt.version,
      attemptNo: 1,
      fellBackFrom: null,
      units: 0,
      unitKind: DEFAULT_UNIT_KIND,
      inputTokens: null,
      outputTokens: null,
      // Zero, not null: nothing was spent, and that is a known cost rather than a missing
      // price (which is what null means everywhere else in this table).
      costUsd: 0,
      latencyMs,
      traceId: ctx.traceId,
    });

    return value;
  }
}
