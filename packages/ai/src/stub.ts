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
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ScoreAnswerArgs,
} from './AiClient';
import { createPromptBuilder, type PromptBuilder } from './prompt-builder';
import { detectLanguage, type LanguageDetection } from './detect-language';
import {
  CandidateSchema,
  QuestionBatchSchema,
  ReportPayloadSchema,
  ScoresSchema,
  type Candidate,
  type Difficulty,
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
      promptName: 'interview.question.generate',
      vars: {
        roundType: args.roundType,
        count: args.count,
        language: args.language,
        jobListing: args.jobListing,
        candidateProfile: args.candidateProfile,
        candidateCv: args.candidateCv,
        priorTopics: args.priorTopics?.join(', ') || 'none',
      },
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
      promptName: 'interview.report.generate',
      vars: {
        language: args.language,
        perAnswerScores: args.perAnswerScores ? JSON.stringify(args.perAnswerScores) : 'none',
        transcript: args.transcript,
        candidateProfile: args.candidateProfile,
        candidateCv: args.candidateCv,
      },
      ctx: args.ctx,
    });

    return parse(
      ReportPayloadSchema,
      {
        overall_impression:
          'Stub report. The candidate answered every question and stayed on topic. ' +
          'Structure was consistent. Depth varied between rounds.',
        overall_score: 3,
        strengths: ['Answers stayed on topic', 'Consistent structure'],
        improvements: ['Add concrete metrics', 'Close each answer with the outcome'],
        rounds: [
          { type: 'hr', score: 3, summary: 'Stub HR round summary.' },
          { type: 'tech', score: 3, summary: 'Stub technical round summary.' },
        ],
        questions: [],
        language: args.language,
      },
      'generateReport',
    );
  }

  async scoreAnswer(args: ScoreAnswerArgs): Promise<Scores> {
    this.builder.build({
      promptName: 'interview.answer.score',
      vars: {
        language: args.language,
        question: args.question,
        transcript: args.transcript,
        candidateProfile: args.candidateProfile,
      },
      ctx: args.ctx,
    });

    return parse(
      ScoresSchema,
      {
        overall: 3,
        relevance: 3,
        depth: 3,
        structure: 3,
        star_adherence: 0.5,
        reasons: ['Stub score: the answer addressed the question.'],
      },
      'scoreAnswer',
    );
  }

  async generateCandidates(args: GenerateCandidatesArgs): Promise<Candidate[]> {
    this.builder.build({
      promptName: 'interview.question.candidates',
      vars: {
        language: args.language,
        priorScore: args.priorScore,
        priorQuestion: args.priorQuestion,
        topicsUsed: args.topicsUsed.join(', ') || 'none',
      },
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
