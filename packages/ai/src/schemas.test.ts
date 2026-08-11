import { describe, expect, it } from 'vitest';
import {
  CandidateSchema,
  QuestionBatchSchema,
  QuestionSchema,
  ReportPayloadSchema,
  ScoresSchema,
} from './schemas';

const question = {
  text: 'Tell me about a deadline you missed.',
  kind: 'behavioral',
  difficulty: 'medium',
  topic: 'ownership',
  orderIndex: 1,
};

const report = {
  overall_impression: 'Solid answers throughout, with concrete examples in the technical round.',
  overall_score: 80,
  strengths: ['Concrete examples', 'Clear structure'],
  improvements: ['Quantify outcomes', 'Tighten the opening'],
  rounds: [{ type: 'hr', score: 80, summary: 'Warm and specific.' }],
  questions: [{ question_id: 'q1', score: 80, reason: 'Named the trade-off.', star_adherence: 0.8 }],
  language: 'en',
};

const scores = {
  overall: 60,
  relevance: 4,
  depth: 2,
  structure: 3,
  star_adherence: 0.5,
  reasons: ['Addressed the question but skipped the result.'],
};

describe('QuestionSchema', () => {
  it('accepts a typed question', () => {
    expect(QuestionSchema.parse(question)).toEqual(question);
  });

  it.each([
    ['an unknown kind', { ...question, kind: 'trivia' }],
    ['an unknown difficulty', { ...question, difficulty: 'brutal' }],
    ['a zero orderIndex', { ...question, orderIndex: 0 }],
    ['an empty topic', { ...question, topic: '' }],
  ])('rejects %s', (_label, invalid) => {
    expect(QuestionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('QuestionBatchSchema', () => {
  it('accepts any length — the caller owns the count check, not the schema', () => {
    for (const length of [0, 3, 5, 8]) {
      const batch = {
        questions: Array.from({ length }, (_, i) => ({ ...question, orderIndex: i + 1 })),
      };
      expect(QuestionBatchSchema.parse(batch).questions).toHaveLength(length);
    }
  });

  it('rejects a batch holding a malformed question', () => {
    const batch = { questions: [{ ...question, difficulty: 'brutal' }] };
    expect(QuestionBatchSchema.safeParse(batch).success).toBe(false);
  });
});

describe('CandidateSchema', () => {
  it('accepts a candidate and rejects one carrying an orderIndex-less bad difficulty', () => {
    const candidate = { text: 'And what did that cost?', difficulty: 'hard', topic: 'trade-offs' };
    expect(CandidateSchema.parse(candidate)).toEqual(candidate);
    expect(CandidateSchema.safeParse({ ...candidate, difficulty: 'spicy' }).success).toBe(false);
  });
});

describe('ScoresSchema', () => {
  it('accepts a valid score set', () => {
    expect(ScoresSchema.parse(scores)).toEqual(scores);
  });

  it.each([
    ['a non-integer overall', { ...scores, overall: 60.5 }],
    ['an out-of-range overall', { ...scores, overall: 101 }],
    ['star_adherence above 1', { ...scores, star_adherence: 1.2 }],
    ['no reasons', { ...scores, reasons: [] }],
  ])('rejects %s', (_label, invalid) => {
    expect(ScoresSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('ReportPayloadSchema', () => {
  it('accepts the K15 payload', () => {
    expect(ReportPayloadSchema.parse(report)).toEqual(report);
  });

  // The interview that produced this is real: `cut_short` after one answered question of ten.
  // The prompt asks for 2–5 strengths and also forbids padding a thin interview, so the model
  // returned one — and the lower bound turned that into `AI_OUTPUT_INVALID` on every attempt
  // and a candidate with no report at all. A short report is the honest output for a short
  // interview; only the ceiling is a real defect.
  it('accepts a thin report from an interview that was stopped early', () => {
    const thin = { ...report, strengths: ['Explained the one answer clearly'], improvements: [] };
    expect(ReportPayloadSchema.safeParse(thin).success).toBe(true);
  });

  it.each([
    // The exact shape schema_validation.feature @AC-11 drives the stub with.
    ['overall_score 101', { ...report, overall_score: 101 }],
    ['a non-integer round score', { ...report, rounds: [{ ...report.rounds[0], score: 62.5 }] }],
    ['six strengths', { ...report, strengths: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    ['six improvements', { ...report, improvements: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    [
      'star_adherence above 1',
      { ...report, questions: [{ ...report.questions[0], star_adherence: 4 }] },
    ],
  ])('rejects %s', (_label, invalid) => {
    expect(ReportPayloadSchema.safeParse(invalid).success).toBe(false);
  });
});
