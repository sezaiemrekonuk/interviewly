/**
 * D01 self-check — pure selector, no DB, no network, no test framework.
 *
 * One runnable file: plain `node:assert/strict`. Covers every row of the B5 selection table,
 * both end-clamps, and the malformed-score guard (the ledger invariant). A failing assert
 * throws and exits non-zero; on success it prints `adaptive-select selftest OK` and exits 0.
 *
 * Run: `npx tsx backend/modules/interview/adaptive-select.selftest.ts`
 */
import assert from 'node:assert/strict';

import { selectNextQuestion } from './adaptive-select';

/** A schema-valid `Scores` object with the given `overall`; the other fields are in range. */
function scores(overall: number): unknown {
  return {
    overall,
    relevance: 60,
    depth: 60,
    structure: 60,
    star_adherence: 0.5,
    reasons: ['ok'],
  };
}

// --- The five representative B5 rows, from a `medium` current, on the 0..100 scale ------------
assert.deepEqual(selectNextQuestion(scores(0), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'easy',
  topicMove: 'same',
  chosenReason: 'score_low',
});
assert.deepEqual(selectNextQuestion(scores(40), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'easy',
  topicMove: 'same',
  chosenReason: 'score_low',
});
assert.deepEqual(selectNextQuestion(scores(60), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'medium',
  topicMove: 'same',
  chosenReason: 'score_mid',
});
assert.deepEqual(selectNextQuestion(scores(80), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'hard',
  topicMove: 'new',
  chosenReason: 'score_high',
});
assert.deepEqual(selectNextQuestion(scores(100), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'hard',
  topicMove: 'new',
  chosenReason: 'score_high',
});

// --- Both end-clamps ------------------------------------------------------------------------
// hard + 100 stays hard (no level above hard), topic still moves new.
assert.deepEqual(selectNextQuestion(scores(100), { difficulty: 'hard', topic: 'sql' }), {
  graded: true,
  difficulty: 'hard',
  topicMove: 'new',
  chosenReason: 'score_high',
});
// easy + 0 stays easy (no level below easy), topic stays same.
assert.deepEqual(selectNextQuestion(scores(0), { difficulty: 'easy', topic: 'sql' }), {
  graded: true,
  difficulty: 'easy',
  topicMove: 'same',
  chosenReason: 'score_low',
});

// --- The band edges, where a rescale goes wrong quietly (ADR-I39) --------------------------
const band = (overall: number) =>
  (selectNextQuestion(scores(overall), { difficulty: 'medium', topic: 'apis' }) as { chosenReason: string })
    .chosenReason;
assert.equal(band(40), 'score_low');
assert.equal(band(41), 'score_mid');
assert.equal(band(60), 'score_mid');
assert.equal(band(61), 'score_high');

// --- The malformed-score guard, four ways → always fallback, never a graded pick ------------
const fallback = { graded: false, chosenReason: 'fallback' };
for (const bad of [{ overall: 101 }, null, 'bad', { overall: 60.5 }]) {
  assert.deepEqual(
    selectNextQuestion(bad, { difficulty: 'medium', topic: 'apis' }),
    fallback,
    `expected fallback for ${JSON.stringify(bad)}`,
  );
}

console.log('adaptive-select selftest OK');
process.exit(0);
