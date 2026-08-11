/**
 * `AiClient` against real providers. Every method is the same four steps: compile through
 * the builder (the §7.1 trust boundary — never skipped), run the chain, validate against the
 * method's Zod schema, return.
 *
 * The per-method timeouts are `TIMEOUT_MS` from the seam itself (B6/Q3): 15 s for the three
 * interactive calls, 90 s for the report.
 */
import { z } from 'zod';

import { TIMEOUT_MS } from './AiClient';
import type {
  AiClient,
  ConductTurnArgs,
  GenerateCandidatesArgs,
  GenerateInterviewTitleArgs,
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ScoreAnswerArgs,
  TurnCompleteArgs,
} from './AiClient';
import { AiError } from './errors';
import { createPromptBuilder, type BuiltPrompt, type PromptBuilder } from './prompt-builder';
import { detectLanguage, type LanguageDetection } from './detect-language';
import {
  buildChain,
  buildSoloChain,
  runChain,
  type ChainDeps,
  type ChainStep,
  type ProviderKeys,
} from './providers';
import {
  PROMPT_NAMES,
  candidateVars,
  conductVars,
  questionVars,
  reportVars,
  scoreVars,
  titleVars,
  turnCompleteVars,
} from './prompt-vars';
import {
  CandidateSchema,
  ConductorTurnSchema,
  InterviewTitleSchema,
  QuestionBatchSchema,
  ReportPayloadSchema,
  ScoresSchema,
  TurnCompleteSchema,
  type Candidate,
  type ConductorTurn,
  type InterviewTitle,
  type QuestionBatch,
  type ReportPayload,
  type Scores,
  type TurnComplete,
} from './schemas';

/** Some models still wrap JSON in a fence despite being told not to; unwrap before parsing. */
const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

/** ADR-T03. Frozen so a caller cannot mutate the shared default into `false`. */
const FAIL_OPEN: TurnComplete = Object.freeze({ finished: true });

export class LiveAiClient implements AiClient {
  private readonly builder: PromptBuilder;

  constructor(
    private readonly deps: ChainDeps,
    opts: { builder?: PromptBuilder } = {},
  ) {
    this.builder = opts.builder ?? createPromptBuilder({ logger: deps.logger });
  }

  generateRoundQuestions(args: GenerateRoundQuestionsArgs): Promise<QuestionBatch> {
    return this.call(
      PROMPT_NAMES.generateRoundQuestions,
      questionVars(args),
      QuestionBatchSchema,
      TIMEOUT_MS.generateRoundQuestions,
      args.ctx,
    );
  }

  generateReport(args: GenerateReportArgs): Promise<ReportPayload> {
    return this.call(
      PROMPT_NAMES.generateReport,
      reportVars(args),
      ReportPayloadSchema,
      TIMEOUT_MS.generateReport,
      args.ctx,
    );
  }

  scoreAnswer(args: ScoreAnswerArgs): Promise<Scores> {
    return this.call(
      PROMPT_NAMES.scoreAnswer,
      scoreVars(args),
      ScoresSchema,
      TIMEOUT_MS.scoreAnswer,
      args.ctx,
    );
  }

  generateCandidates(args: GenerateCandidatesArgs): Promise<Candidate[]> {
    return this.call(
      PROMPT_NAMES.generateCandidates,
      candidateVars(args),
      z.array(CandidateSchema),
      TIMEOUT_MS.generateCandidates,
      args.ctx,
    );
  }

  generateInterviewTitle(args: GenerateInterviewTitleArgs): Promise<InterviewTitle> {
    return this.call(
      PROMPT_NAMES.generateInterviewTitle,
      titleVars(args),
      InterviewTitleSchema,
      TIMEOUT_MS.generateInterviewTitle,
      args.ctx,
    );
  }

  conductTurn(args: ConductTurnArgs): Promise<ConductorTurn> {
    return this.call(
      PROMPT_NAMES.conductTurn,
      conductVars(args),
      ConductorTurnSchema,
      TIMEOUT_MS.conductTurn,
      args.ctx,
    );
  }

  /**
   * T01. Two departures from every other method here, both ADR-T03:
   *
   * - `buildSoloChain` instead of `buildChain` — no tier-2 step. The gate sits in front of a
   *   10 s `conductTurn`, so a fall-through costs a 3 s timeout plus a whole second attempt
   *   before the candidate hears anything, for a boolean we already know how to default.
   * - the `try` — throw, timeout, malformed output, no configured key, all of it resolves to
   *   `finished: true`. Forwarding an unfinished utterance is what ships today; holding one
   *   nobody will release is a candidate sitting in silence. `try`/`catch` rather than
   *   `.catch()`, because `builder.build` is synchronous and a failed compile throws before
   *   there is a promise to attach to.
   */
  async turnComplete(args: TurnCompleteArgs): Promise<TurnComplete> {
    try {
      return await this.call(
        PROMPT_NAMES.turnComplete,
        turnCompleteVars(args),
        TurnCompleteSchema,
        TIMEOUT_MS.turnComplete,
        args.ctx,
        buildSoloChain,
      );
    } catch {
      return FAIL_OPEN;
    }
  }

  /** No call, no row, no network (ai AC-13) — the seam's one synchronous method. */
  detectLanguage(text: string, current: string): LanguageDetection {
    return detectLanguage(text, current);
  }

  private call<T>(
    promptName: string,
    vars: Record<string, unknown>,
    schema: z.ZodType<T>,
    timeoutMs: number,
    ctx: { interviewId: string; traceId: string },
    chainFor: (built: BuiltPrompt, keys: ProviderKeys) => ChainStep[] = buildChain,
  ): Promise<T> {
    const built = this.builder.build({ promptName, vars, ctx });
    return runChain({
      built,
      chain: chainFor(built, this.deps.keys),
      timeoutMs,
      validate: parseOutput(schema),
      ctx,
      deps: this.deps,
    });
  }
}

/**
 * The §5.5 layer-2 validator. It throws `AI_OUTPUT_INVALID`, which the chain classifies as a
 * fallback trigger — a malformed body is one more reason to try tier-2, not a value handed
 * back to the caller.
 *
 * The message never carries the offending text: that text is model output about a real
 * transcript or listing and has no business in a log line or an error body (K6).
 */
export function parseOutput<T>(schema: z.ZodType<T>): (text: string) => T {
  return (text: string): T => {
    let json: unknown;
    try {
      json = JSON.parse(text.replace(FENCE, '$1'));
    } catch {
      throw new AiError('AI_OUTPUT_INVALID', 'provider returned a body that is not JSON');
    }

    const result = schema.safeParse(json);
    if (!result.success) {
      throw new AiError('AI_OUTPUT_INVALID', 'provider output failed its schema');
    }
    return result.data;
  };
}
