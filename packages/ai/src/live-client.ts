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
  GenerateCandidatesArgs,
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ScoreAnswerArgs,
} from './AiClient';
import { AiError } from './errors';
import { createPromptBuilder, type PromptBuilder } from './prompt-builder';
import { detectLanguage, type LanguageDetection } from './detect-language';
import { buildChain, runChain, type ChainDeps } from './providers';
import {
  PROMPT_NAMES,
  candidateVars,
  questionVars,
  reportVars,
  scoreVars,
} from './prompt-vars';
import {
  CandidateSchema,
  QuestionBatchSchema,
  ReportPayloadSchema,
  ScoresSchema,
  type Candidate,
  type QuestionBatch,
  type ReportPayload,
  type Scores,
} from './schemas';

/** Some models still wrap JSON in a fence despite being told not to; unwrap before parsing. */
const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

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
  ): Promise<T> {
    const built = this.builder.build({ promptName, vars, ctx });
    return runChain({
      built,
      chain: buildChain(built, this.deps.keys),
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
