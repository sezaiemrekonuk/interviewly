/**
 * D02 self-check — candidate assembly shape, no DB, no HTTP, no test framework.
 *
 * Calls `StubAiClient.generateCandidates` directly to prove the seam returns exactly
 * three schema-valid candidates covering easier/same/harder and both same-topic and
 * new-topic. DB persistence is confirmed by D03's `@adaptive-questions` acceptance run.
 *
 * Run: `npx tsx backend/modules/interview/candidate-prep.selftest.ts`
 */
import assert from 'node:assert/strict';

import { CandidateSchema, StubAiClient } from '@interviewly/ai';

(async () => {
  const stub = new StubAiClient();
  const ctx = { interviewId: 'selftest-interview', traceId: 'selftest-trace' };
  const currentTopic = 'stub-topic-1';

  const candidates = await stub.generateCandidates({
    priorQuestion: 'What is REST?',
    priorScore: 3,
    topicsUsed: [currentTopic],
    jobListing: 'Backend engineer building HTTP APIs on Node.js and PostgreSQL.',
    language: 'en',
    ctx,
  });

  assert.equal(candidates.length, 3, 'should return exactly three candidates');

  const difficulties = candidates.map((c) => c.difficulty);
  assert.ok(difficulties.includes('easy'), 'should include an easier candidate');
  assert.ok(difficulties.includes('medium'), 'should include a same-difficulty candidate');
  assert.ok(difficulties.includes('hard'), 'should include a harder candidate');

  const topics = candidates.map((c) => c.topic);
  assert.ok(
    topics.some((t) => t === currentTopic),
    'at least one candidate should carry the same topic',
  );
  assert.ok(
    topics.some((t) => t !== currentTopic),
    'at least one candidate should carry a new topic',
  );

  for (const candidate of candidates) {
    const result = CandidateSchema.safeParse(candidate);
    assert.ok(result.success, `candidate fails schema: ${JSON.stringify(candidate)}`);
  }

  console.log('candidate-prep selftest OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
