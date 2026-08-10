import type { MyInterview, MyQuestion } from '../../lib/query';

/**
 * Everything the briefing home derives from the two lists it reads. Pure functions in their
 * own file because each one is a claim about the user's practice — "this is your weakest
 * answer", "you are better at HR than technical" — and a claim like that is worth a test.
 */

/** `InterviewState` split by what can still be done with the row, not by name. */
export const RESUMABLE = new Set(['created', 'profiling', 'hr_round', 'tech_round', 'paused']);
export const REPORTED = new Set(['evaluating', 'completed']);
/** Ended without a report. Reachable — the report route renders their transcript. */
export const UNFINISHED = new Set(['abandoned', 'failed']);

/** Below this, a trend line is three points pretending to be a direction. */
export const TREND_MINIMUM = 3;

/**
 * Below this, the round split states the two numbers and stops — no "practise that one".
 *
 * Two, not `TREND_MINIMUM`'s three, and the difference is what is being claimed. A trend is a
 * claim about *direction*, which needs a third point to have one. A recommendation is a claim
 * that the gap is a property of the candidate rather than of a single sitting, and one repeat
 * is what separates those. The averages themselves are true at n = 1; only the advice is not.
 */
export const ADVICE_MINIMUM = 2;

/**
 * At or below this, an answer is something to work on. Above it, printing it under a heading
 * that says "Work on this" — beside a reason that reads "clear situation and result" — tells a
 * user their best answer is a problem.
 *
 * 60 on the 0..100 scale (ADR-I39) is the old 3/5 cut, and the same number the backend's
 * selector holds difficulty at — "adequate" is the top of what is worth practising.
 */
export const WEAKNESS_CEILING = 60;

/** Filled steps above the empty ground in the practice grid. */
export const ACTIVITY_TIERS = 3;


/**
 * The one interview still open, if there is one. Newest first, because the list is — an older
 * abandoned attempt is not what "carry on" should mean.
 */
export function inFlight(items: MyInterview[]): MyInterview | null {
  return items.find((item) => RESUMABLE.has(item.state)) ?? null;
}

/**
 * Interviews with a score, oldest → newest, which is the order a trend is read in.
 *
 * The type test rather than `!== null`: a replica serving the older `/me/interviews` omits the
 * key, and `undefined !== null` is true — which would put an interview with no score into the
 * trend as a hole.
 */
export function scoredRuns(items: MyInterview[]): MyInterview[] {
  return items
    .filter((item) => typeof item.overallScore === 'number')
    .slice()
    .reverse();
}

export interface Standing {
  latest: number | null;
  best: number | null;
  /** Latest minus the one before it. Null with fewer than two scores — not zero. */
  delta: number | null;
  count: number;
}

export function standing(items: MyInterview[]): Standing {
  const runs = scoredRuns(items);
  const scores = runs.map((run) => run.overallScore as number);
  if (scores.length === 0) return { latest: null, best: null, delta: null, count: 0 };

  const latest = scores[scores.length - 1];
  return {
    latest,
    best: Math.max(...scores),
    delta: scores.length > 1 ? latest - scores[scores.length - 2] : null,
    count: scores.length,
  };
}

/**
 * The mean of each round across every scored interview. This is the sentence the product could
 * never say before — "you are an 84 at HR and a 56 at technical" — and `roundScores` was added
 * to `GET /me/interviews` so it costs one request rather than one per interview.
 *
 * Rounded to one decimal, because two would claim a precision that averaging four integers
 * does not have.
 *
 * `n` is how many interviews the averages were taken from, and it travels with them because
 * every sentence written from them has to say so. Not `scoredRuns().length`: a report can carry
 * round scores without an overall one, and the count that qualifies these two numbers is the
 * count of rows that contributed to them.
 */
export function roundAverages(items: MyInterview[]): {
  hr: number | null;
  tech: number | null;
  n: number;
} {
  const mean = (values: number[]) =>
    values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

  // `roundScores` is optional-chained rather than trusted: a replica still serving the older
  // `/me/interviews` omits the key entirely, and a briefing that throws on a rolling deploy is
  // worse than one that shows an empty round split for a few minutes.
  const of = (round: 'hr' | 'tech') =>
    mean(items.map((i) => i.roundScores?.[round]).filter((v): v is number => typeof v === 'number'));

  const n = items.filter(
    (i) => typeof i.roundScores?.hr === 'number' || typeof i.roundScores?.tech === 'number',
  ).length;

  return { hr: of('hr'), tech: of('tech'), n };
}

/**
 * The answers worth working on — scored at or below `WEAKNESS_CEILING`, lowest first, then by
 * age, because of two answers marked 40 the older one has had longer to go unaddressed.
 *
 * The ceiling, not just the bottom `limit`: taking the bottom three unconditionally meant a
 * candidate whose floor is an 80 had two congratulatory reasons printed under "Work on this" as
 * "the reason it was marked down". The list is allowed to come back empty; that is a result,
 * and `Focus` renders it as one.
 *
 * Unscored questions are dropped rather than sorted to the front: a question whose report has
 * not landed is not a weakness, and putting it at the top of "work on this" would be wrong on
 * the one screen that is supposed to be worth trusting.
 */
export function weakest(questions: MyQuestion[], limit: number): MyQuestion[] {
  return questions
    .filter((q) => q.score !== null && q.score <= WEAKNESS_CEILING)
    .slice()
    .sort((a, b) => {
      const byScore = (a.score as number) - (b.score as number);
      if (byScore !== 0) return byScore;
      return (a.answeredAt ?? '').localeCompare(b.answeredAt ?? '');
    })
    .slice(0, limit);
}

/** One square of the practice grid. A `null` day is the padding before the 1st. */
export interface ActivityCell {
  /** `YYYY-MM-DD`, or null for a leading blank that only exists to align the columns. */
  date: string | null;
  count: number;
  /** 0 is the empty ground; 1..`ACTIVITY_TIERS` are the filled steps. */
  tier: number;
}

/**
 * Which filled step a day's count lands on, scaled to the busiest day of the month shown.
 *
 * Relative, not absolute: "three tiers rising to the day with the most" is what the grid
 * claims, and a fixed 1/2/3+ ladder would render a quiet month entirely in the lightest step
 * and say nothing about its shape. The consequence is that in a month where every active day
 * held one interview, every active day is the top step — true, and the sentence underneath
 * carries the actual number.
 */
export function activityTier(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(ACTIVITY_TIERS, Math.ceil((count / max) * ACTIVITY_TIERS));
}

/** ISO weekday of the 1st, 0-indexed from Monday — how many blanks the first row needs. */
function leadingBlanks(year: number, month: number): number {
  return (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
}

/**
 * One month as Monday-first rows of seven: leading blanks, then every day of the month.
 *
 * Built from the month string rather than from `Date.now()` so the grid is the month the user
 * asked for and nothing about it depends on the machine's clock or zone. `days` carries only
 * the days that were practised on (the endpoint groups), so everything else is a zero here.
 */
export function monthGrid(month: string, days: { date: string; count: number }[], max: number): ActivityCell[] {
  const [year, index] = month.split('-').map(Number);
  const counts = new Map(days.map((day) => [day.date, day.count]));
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();

  const blanks: ActivityCell[] = Array.from({ length: leadingBlanks(year, index) }, () => ({
    date: null,
    count: 0,
    tier: 0,
  }));

  return blanks.concat(
    Array.from({ length }, (_, offset) => {
      const date = `${month}-${String(offset + 1).padStart(2, '0')}`;
      const count = counts.get(date) ?? 0;
      return { date, count, tier: activityTier(count, max) };
    }),
  );
}

/** The month one step either side of `YYYY-MM`, for the picker's two buttons. */
export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM` for an instant, in UTC — the same zone the endpoint buckets in. */
export function monthOf(at: number): string {
  const date = new Date(at);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The sparkline's `points` attribute for a 0..max series, drawn in a `width × height` box.
 *
 * An SVG geometry attribute, not a style attribute — which is the whole reason the trend can
 * be an SVG at all under `style-src 'self' 'nonce-…'`.
 */
export function sparkPoints(
  scores: number[],
  { width, height, max }: { width: number; height: number; max: number },
): string {
  if (scores.length === 0) return '';
  if (scores.length === 1) return `0,${height / 2} ${width},${height / 2}`;

  const step = width / (scores.length - 1);
  return scores
    .map((score, index) => {
      const y = height - (Math.min(Math.max(score, 0), max) / max) * height;
      return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
