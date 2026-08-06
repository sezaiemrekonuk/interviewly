/**
 * The fold is what keeps the log index at four columns instead of one per call site, so its
 * shape is the contract: the event name in `title`, the fields as a JSON string in `msg`.
 */
import { describe, expect, it } from 'vitest';

import { foldFields } from './logger';

describe('foldFields', () => {
  it('puts the event name in title and the fields in msg as JSON', () => {
    expect(
      foldFields([
        { traceId: 't1', interviewId: 'i1', roundType: 'hr', expected: 3, received: 2 },
        'AI_OUTPUT_SCHEMA_INVALID',
      ]),
    ).toEqual([
      { title: 'AI_OUTPUT_SCHEMA_INVALID' },
      '{"traceId":"t1","interviewId":"i1","roundType":"hr","expected":3,"received":2}',
    ]);
  });

  it('keeps an error readable, which JSON.stringify alone does not', () => {
    const [, msg] = foldFields([{ err: new Error('boom') }, 'INTERVIEW_PAUSE_FAILED']) as [
      unknown,
      string,
    ];
    expect(JSON.parse(msg).err).toContain('Error: boom');
  });

  it('gives a bare event name a title too', () => {
    expect(foldFields(['WORKER_READY'])).toEqual([{ title: 'WORKER_READY' }, '{}']);
  });
});
