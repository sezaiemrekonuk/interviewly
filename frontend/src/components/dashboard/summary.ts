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
 */
export const WEAKNESS_CEILING = 3;

/** Weeks in the practice grid. Twelve is a quarter — long enough to show a gap. */
export const RHYTHM_WEEKS = 12;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

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
 * never say before — "you are a 4.2 at HR and a 2.8 at technical" — and `roundScores` was added
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
 * age, because of two answers marked 2 the older one has had longer to go unaddressed.
 *
 * The ceiling, not just the bottom `limit`: taking the bottom three unconditionally meant a
 * candidate whose floor is a 4 had two congratulatory reasons printed under "Work on this" as
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

export interface RhythmWeek {
  /** Weeks back from the current one; 0 is this week. */
  offset: number;
  count: number;
  startsAt: string;
}

/**
 * Interviews per week for the last `RHYTHM_WEEKS`, oldest first.
 *
 * `now` is a parameter rather than a `Date.now()` call so the grid is deterministic in a test
 * and so the server and the first client paint agree on which week is "this" one.
 */
export function rhythm(items: MyInterview[], now: number, weeks = RHYTHM_WEEKS): RhythmWeek[] {
  const buckets = Array.from({ length: weeks }, (_, index) => ({
    offset: weeks - 1 - index,
    count: 0,
    startsAt: new Date(now - (weeks - 1 - index) * WEEK_MS).toISOString(),
  }));

  for (const item of items) {
    const age = now - new Date(item.createdAt).getTime();
    if (age < 0) continue;
    const offset = Math.floor(age / WEEK_MS);
    if (offset >= weeks) continue;
    const bucket = buckets.find((b) => b.offset === offset);
    if (bucket) bucket.count += 1;
  }

  return buckets;
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
