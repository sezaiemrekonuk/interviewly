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
    relevance: 3,
    depth: 3,
    structure: 3,
    star_adherence: 0.5,
    reasons: ['ok'],
  };
}

// --- The five representative B5 rows, from a `medium` current ---------------------------------
assert.deepEqual(selectNextQuestion(scores(0), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'easy',
  topicMove: 'same',
  chosenReason: 'score_low',
});
assert.deepEqual(selectNextQuestion(scores(2), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'easy',
  topicMove: 'same',
  chosenReason: 'score_low',
});
assert.deepEqual(selectNextQuestion(scores(3), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'medium',
  topicMove: 'same',
  chosenReason: 'score_mid',
});
assert.deepEqual(selectNextQuestion(scores(4), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'hard',
  topicMove: 'new',
  chosenReason: 'score_high',
});
assert.deepEqual(selectNextQuestion(scores(5), { difficulty: 'medium', topic: 'apis' }), {
  graded: true,
  difficulty: 'hard',
  topicMove: 'new',
  chosenReason: 'score_high',
});

// --- Both end-clamps ------------------------------------------------------------------------
// hard + 5 stays hard (no level above hard), topic still moves new.
assert.deepEqual(selectNextQuestion(scores(5), { difficulty: 'hard', topic: 'sql' }), {
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

// --- The malformed-score guard, four ways → always fallback, never a graded pick ------------
const fallback = { graded: false, chosenReason: 'fallback' };
for (const bad of [{ overall: 9 }, null, 'bad', { overall: 3.5 }]) {
  assert.deepEqual(
    selectNextQuestion(bad, { difficulty: 'medium', topic: 'apis' }),
    fallback,
    `expected fallback for ${JSON.stringify(bad)}`,
  );
}

console.log('adaptive-select selftest OK');
process.exit(0);
