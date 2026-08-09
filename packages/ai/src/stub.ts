/**
 * The §5.5 fake: every scenario that is not asserting the provider chain runs against this.
 *
 * It compiles its prompts through the real `PromptBuilder` rather than skipping straight to
 * canned content. That is the point — `security.feature` @AC-5 asserts that generating a
 * round with an injecting listing still emits SECURITY_PROMPT_INJECTION_SUSPECTED, which is
 * only true if the generation path actually crosses the trust boundary.
 *
 * What it does NOT do: write `llm_calls` rows. That needs Prisma, and this package is
 * shared by `api` and `worker` and depends on neither. I02's api-side adapter records the
 * `cost_usd = 0` stub row and logs AI_DISABLED_STUB_MODE around these calls.
 */
import type {
  AiClient,
  GenerateCandidatesArgs,
  GenerateInterviewTitleArgs,
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ScoreAnswerArgs,
} from './AiClient';
import { createPromptBuilder, type PromptBuilder } from './prompt-builder';
import { detectLanguage, type LanguageDetection } from './detect-language';
import {
  PROMPT_NAMES,
  candidateVars,
  questionVars,
  reportVars,
  scoreVars,
  titleVars,
} from './prompt-vars';
import {
  CandidateSchema,
  INTERVIEW_TITLE_MAX,
  InterviewTitleSchema,
  QuestionBatchSchema,
  ReportPayloadSchema,
  ScoresSchema,
  type Candidate,
  type Difficulty,
  type InterviewTitle,
  type QuestionBatch,
  type QuestionKind,
  type ReportPayload,
  type Scores,
} from './schemas';
import { z } from 'zod';

const HR_KINDS: QuestionKind[] = ['open', 'behavioral'];
const TECH_KINDS: QuestionKind[] = ['technical', 'open'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export class StubAiClient implements AiClient {
  private readonly builder: PromptBuilder;

  constructor(opts: { builder?: PromptBuilder } = {}) {
    this.builder = opts.builder ?? createPromptBuilder();
  }

  async generateRoundQuestions(args: GenerateRoundQuestionsArgs): Promise<QuestionBatch> {
    this.builder.build({
      promptName: PROMPT_NAMES.generateRoundQuestions,
      vars: questionVars(args),
      ctx: args.ctx,
    });

    const kinds = args.roundType === 'hr' ? HR_KINDS : TECH_KINDS;
    return parse(
      QuestionBatchSchema,
      {
        questions: Array.from({ length: args.count }, (_, i) => ({
          text: `Stub ${args.roundType} question ${i + 1}.`,
          kind: kinds[i % kinds.length],
          difficulty: DIFFICULTIES[i % DIFFICULTIES.length],
          topic: `stub-topic-${i + 1}`,
          orderIndex: i + 1,
        })),
      },
      'generateRoundQuestions',
    );
  }

  async generateReport(args: GenerateReportArgs): Promise<ReportPayload> {
    this.builder.build({
      promptName: PROMPT_NAMES.generateReport,
      vars: reportVars(args),
      ctx: args.ctx,
    });

    return parse(
      ReportPayloadSchema,
      {
        overall_impression:
          'Stub report. The candidate answered every question and stayed on topic. ' +
          'Structure was consistent. Depth varied between rounds.',
        overall_score: 60,
        strengths: ['Answers stayed on topic', 'Consistent structure'],
        improvements: ['Add concrete metrics', 'Close each answer with the outcome'],
        rounds: [
          { type: 'hr', score: 60, summary: 'Stub HR round summary.' },
          { type: 'tech', score: 60, summary: 'Stub technical round summary.' },
        ],
        questions: [],
        language: args.language,
      },
      'generateReport',
    );
  }

  async scoreAnswer(args: ScoreAnswerArgs): Promise<Scores> {
    this.builder.build({
      promptName: PROMPT_NAMES.scoreAnswer,
      vars: scoreVars(args),
      ctx: args.ctx,
    });

    return parse(
      ScoresSchema,
      {
        overall: 60,
        relevance: 60,
        depth: 60,
        structure: 60,
        star_adherence: 0.5,
        reasons: ['Stub score: the answer addressed the question.'],
      },
      'scoreAnswer',
    );
  }

  async generateCandidates(args: GenerateCandidatesArgs): Promise<Candidate[]> {
    this.builder.build({
      promptName: PROMPT_NAMES.generateCandidates,
      vars: candidateVars(args),
      ctx: args.ctx,
    });

    // easier / same / harder, in that order — the B5 selection table indexes on it.
    return parse(
      z.array(CandidateSchema),
      DIFFICULTIES.map((difficulty, i) => ({
        text: `Stub ${difficulty} follow-up ${i + 1}.`,
        difficulty,
        topic: i === 2 ? 'stub-new-topic' : 'stub-topic-1',
      })),
      'generateCandidates',
    );
  }

  async generateInterviewTitle(args: GenerateInterviewTitleArgs): Promise<InterviewTitle> {
    this.builder.build({
      promptName: PROMPT_NAMES.generateInterviewTitle,
      vars: titleVars(args),
      ctx: args.ctx,
    });

    const firstLine =
      args.jobListing
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? 'Interview';
    return parse(
      InterviewTitleSchema,
      { title: firstLine.slice(0, INTERVIEW_TITLE_MAX).trim() || 'Interview' },
      'generateInterviewTitle',
    );
  }

  detectLanguage(text: string, current: string): LanguageDetection {
    return detectLanguage(text, current);
  }
}

/**
 * The stub is only useful if its canned content is schema-valid, so it validates its own
 * output through the same gate a real provider response goes through. A stub that drifts
 * out of schema must fail here, not three tasks downstream.
 */
function parse<T>(schema: z.ZodType<T>, value: unknown, method: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`StubAiClient.${method} produced schema-invalid content: ${result.error}`);
  }
  return result.data;
}
