/**
 * D01 — Adaptive score→question selection (pure module, K4 / ai spec B5).
 *
 * Maps a scored answer to the next question's difficulty/topic move. It is the belt-and-braces
 * guard for the ledger invariant: **a malformed or schema-invalid score must never select a
 * graded next question.** A score that fails `ScoresSchema` returns the `fallback` outcome —
 * never a graded move, never a thrown error — and the caller (D03) keeps the default next row.
 *
 * Pure by contract: same inputs → same output, no DB, no network, no logging, no clock, no
 * randomness. That is what makes it provable by `adaptive-select.selftest.ts` with no fixtures.
 * D03 attaches this to `answers.ts`; the difficulty label it returns is persisted for
 * admin/audit (K4) and is never surfaced as user-facing copy.
 */
import { ScoresSchema } from '@interviewly/ai';
import type { ChosenReason, Difficulty } from '@prisma/client';

/** Difficulty ordered easy < medium < hard — the axis the level shift clamps against. */
const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'] as const satisfies readonly Difficulty[];

/**
 * The two cut points of the B5 selection table on the 0..100 scale (ADR-I39): at or below
 * `LOW_CEILING` the next question gets easier, at or below `MID_CEILING` it holds, above it
 * the candidate is moved on. They are the old 0..5 cuts (2 and 3) times twenty, so a run that
 * scored the same answers the same way takes the same path through the table.
 *
 * The frontend's display bands (`frontend/src/lib/score.ts`) use the same two numbers and are
 * a deliberate second copy: nothing in the browser can import this package.
 */
const LOW_CEILING = 40;
const MID_CEILING = 60;

/**
 * Discriminated union on `graded`. `chosenReason` values are derived from the Prisma
 * `ChosenReason` enum (F02), not restated inline, so a renamed enum member fails the compile
 * here rather than silently drifting. `language_switch` belongs to I10, never to this module.
 */
export type AdaptiveSelection =
  | { graded: false; chosenReason: Extract<ChosenReason, 'fallback'> }
  | {
      graded: true;
      difficulty: Difficulty;
      topicMove: 'same' | 'new';
      chosenReason: Extract<ChosenReason, 'score_low' | 'score_mid' | 'score_high'>;
    };

/**
 * Shift `current` by `delta` levels along DIFFICULTY_ORDER, clamped at both ends. `current` is
 * typed `Difficulty`, so its index is always 0..2; the clamp is what keeps `hard`+1 at `hard`
 * and `easy`-1 at `easy` instead of running off the enum.
 */
function shiftDifficulty(current: Difficulty, delta: -1 | 0 | 1): Difficulty {
  const idx = DIFFICULTY_ORDER.indexOf(current);
  const clamped = Math.min(DIFFICULTY_ORDER.length - 1, Math.max(0, idx + delta));
  return DIFFICULTY_ORDER[clamped];
}

/**
 * Select the next question's difficulty/topic move from a raw (unvalidated) answer score.
 *
 * `rawScore` is `unknown` on purpose: it is re-validated against `ScoresSchema` (I01) at this
 * boundary before `overall` is read. A validation failure is the fallback path — never a graded
 * pick, never a throw. `current.topic` is part of the caller's contract (D03 uses it to pick the
 * concrete new topic); this pure selector only decides whether the topic *moves*.
 */
export function selectNextQuestion(
  rawScore: unknown,
  current: { difficulty: Difficulty; topic: string },
): AdaptiveSelection {
  const parsed = ScoresSchema.safeParse(rawScore);
  if (!parsed.success) {
    return { graded: false, chosenReason: 'fallback' };
  }

  // Read `overall` only after the schema validates — a malformed object has no trustworthy one.
  const overall = parsed.data.overall; // integer 0..100, schema-guaranteed.

  if (overall <= LOW_CEILING) {
    return {
      graded: true,
      difficulty: shiftDifficulty(current.difficulty, -1),
      topicMove: 'same',
      chosenReason: 'score_low',
    };
  }

  if (overall <= MID_CEILING) {
    return {
      graded: true,
      difficulty: shiftDifficulty(current.difficulty, 0),
      topicMove: 'same',
      chosenReason: 'score_mid',
    };
  }

  // overall is above MID_CEILING.
  return {
    graded: true,
    difficulty: shiftDifficulty(current.difficulty, 1),
    topicMove: 'new',
    chosenReason: 'score_high',
  };
}
