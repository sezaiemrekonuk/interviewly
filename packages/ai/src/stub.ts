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
  ConductTurnArgs,
  GenerateCandidatesArgs,
  GenerateInterviewTitleArgs,
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ScoreAnswerArgs,
  TurnCompleteArgs,
} from './AiClient';
import { createPromptBuilder, type PromptBuilder } from './prompt-builder';
import { detectLanguage, type LanguageDetection } from './detect-language';
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
  INTERVIEW_TITLE_MAX,
  InterviewTitleSchema,
  QuestionBatchSchema,
  ReportPayloadSchema,
  ScoresSchema,
  TurnCompleteSchema,
  type Candidate,
  type ConductorTurn,
  type Difficulty,
  type InterviewTitle,
  type QuestionBatch,
  type QuestionKind,
  type ReportPayload,
  type Scores,
  type TurnComplete,
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
          intent: `Stub intent ${i + 1}.`,
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

  /**
   * The stub conducts the interview the way the pre-C02 code did: one candidate utterance is
   * one answer, and the question always advances. That is not laziness about the fake — it is
   * what keeps every acceptance scenario written against `POST /answers` true of the turn
   * loop as well. A stub that decided to `continue` sometimes would make the question count
   * of a keyless interview depend on canned text.
   *
   * The exception is the opening turn, which the empty conversation identifies: nothing has
   * been said, so there is nothing to advance past and the turn is a welcome. The server does
   * not advance on it either — `conductor.ts` treats the first assistant message for a
   * question row as the *asking* of it, whatever action came back.
   */
  async conductTurn(args: ConductTurnArgs): Promise<ConductorTurn> {
    this.builder.build({
      promptName: PROMPT_NAMES.conductTurn,
      vars: conductVars(args),
      ctx: args.ctx,
    });

    if (args.conversation.length === 0) {
      return parse(
        ConductorTurnSchema,
        {
          say: `Welcome. I am ${args.personaName} and I will be running this ${args.roundType} round.`,
          action: 'next_question',
          question: 'Stub opening question.',
        },
        'conductTurn',
      );
    }

    return parse(
      ConductorTurnSchema,
      { say: 'Stub acknowledgement. Stub next question.', action: 'next_question', question: 'Stub next question.' },
      'conductTurn',
    );
  }

  /**
   * T01. Deterministic and text-driven rather than always-true, so an acceptance run with no
   * provider key still exercises the hold path: a fragment ending in a comma or a conjunction
   * is unfinished, everything else is finished. Keeping both branches reachable is the point —
   * a stub that always forwarded would make every keyless scenario blind to the gate.
   */
  async turnComplete(args: TurnCompleteArgs): Promise<TurnComplete> {
    this.builder.build({
      promptName: PROMPT_NAMES.turnComplete,
      vars: turnCompleteVars(args),
      ctx: args.ctx,
    });

    const text = args.utterance.trim().toLowerCase();
    return parse(TurnCompleteSchema, { finished: !UNFINISHED_TAIL.test(text) }, 'turnComplete');
  }

  detectLanguage(text: string, current: string): LanguageDetection {
    return detectLanguage(text, current);
  }
}

/**
 * A trailing comma, or a trailing conjunction in either interview language. `(^|\s)` rather
 * than `\b`: `\b` does not see a boundary in front of `çünkü`, so the Turkish half would never
 * match.
 */
const UNFINISHED_TAIL =
  /(,|(^|\s)(and|but|so|because|that|which|with|to|we|ve|ama|çünkü|ki|için|ile))$/;

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
