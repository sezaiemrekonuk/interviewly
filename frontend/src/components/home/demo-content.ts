/**
 * The landing demo's measurements.
 *
 * The *words* live in `messages/{en,tr}.json` under `landing.demo` like every other string in
 * the product. Only the numbers live here, because they are not copy: they are the scores the
 * demo shows on its meters, and a translator moving an 80 to a 60 would make the two locales
 * disagree about how good the same answer is.
 *
 * Everything in this file is authored demonstration material for an anonymous visitor. It is
 * not a recording of a real session and the surface says so (`landing.demo.sampleNote`). Real
 * scores come from the model and are stored per question on `report_questions`.
 */
import { SCORE_MAX } from '../../lib/score';

export const DEMO_ROLES = ['frontend', 'product', 'data'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export const DEMO_ROUNDS = ['hr', 'tech'] as const;
export type DemoRound = (typeof DEMO_ROUNDS)[number];

/**
 * Three answers per question. `a` is the strong one throughout, which is a property of the
 * *data* and never of the screen: `demo-interview.tsx` draws them in an order shuffled per
 * question per mount, so nothing about the position or the length of an answer tells the
 * visitor which it is before they read it. Finding out is the demonstration.
 */
export const DEMO_CHOICES = ['a', 'b', 'c'] as const;
export type DemoChoice = (typeof DEMO_CHOICES)[number];

/**
 * Exactly the facts a real report carries per question (`report_questions`, and
 * `ReportPayload.questions[]` in `packages/ai/src/schemas.ts`): a score, a written reason and —
 * on narrative questions only — STAR adherence.
 *
 * Deliberately *not* the four-axis `answers.scores` shape. That column exists and is gated by
 * the same schema file, but `promoteNextQuestion` returns early when a question has no
 * pre-generated candidates, which is every interview today — so it is null far more often than
 * not. Showing four filling meters here would promise a breakdown most users never receive.
 */
export interface DemoScore {
  overall: number;
  /**
   * 0..1, shown as a percentage — the same field the report renders.
   *
   * Absent on the technical rounds, and that is the product, not an omission: STAR is a
   * behavioural-story rubric, and the model returns `star_adherence: 0` for non-narrative
   * questions (ai spec §"0 for non-narrative questions"). Printing 68% beside "how would you
   * keep a worker idempotent?" would advertise a measurement no real report contains.
   */
  star?: number;
}

/** The demo prints real report shapes, so it prints the real ceiling. */
export const DEMO_MAX = SCORE_MAX;

type RoleScores = Record<DemoRound, Record<DemoChoice, DemoScore>>;

/**
 * Answer `a` is the strong one in every set, `b` under-answers at length, `c` answers a
 * different question at length. Kept consistent across roles so the spread is a property of the
 * answer and not of which chip the visitor happened to press.
 *
 * `star` appears on the HR rounds only — see `DemoScore.star`.
 */
export const DEMO_SCORES: Record<DemoRole, RoleScores> = {
  frontend: {
    hr: {
      a: { overall: 82, star: 0.82 },
      b: { overall: 41, star: 0.34 },
      c: { overall: 36, star: 0.26 },
    },
    tech: {
      a: { overall: 91 },
      b: { overall: 38 },
      c: { overall: 57 },
    },
  },
  product: {
    hr: {
      a: { overall: 88, star: 0.88 },
      b: { overall: 43, star: 0.4 },
      c: { overall: 58, star: 0.45 },
    },
    tech: {
      a: { overall: 79 },
      b: { overall: 40 },
      c: { overall: 61 },
    },
  },
  data: {
    hr: {
      a: { overall: 84, star: 0.79 },
      b: { overall: 37, star: 0.33 },
      c: { overall: 55, star: 0.41 },
    },
    tech: {
      a: { overall: 93 },
      b: { overall: 24 },
      c: { overall: 62 },
    },
  },
};

/**
 * The overall the sample report shows, given the two answers the visitor actually picked.
 *
 * Floored, not rounded. A real report's `overall_score` is an integer the model produced and
 * `report-rail.tsx` prints it as-is, so a decimal here would be a shape the product never
 * shows — and rounding a 70.5 up to 71 is the one thing a demo about honest marking may not do.
 */
export function demoOverall(hr: DemoScore, tech: DemoScore): number {
  return Math.floor((hr.overall + tech.overall) / 2);
}
