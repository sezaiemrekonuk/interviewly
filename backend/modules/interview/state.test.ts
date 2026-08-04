/**
 * `order_index` is per-round, so a raw findMany interleaves the two rounds: the room would show
 * technical turn 1 above HR turn 3. The global order (K2) is HR round first, then technical.
 */
import { describe, expect, it } from 'vitest';

import { orderTranscript, type TranscriptQuestion } from './state';

const question = (
  id: string,
  order_index: number,
  type: 'hr' | 'tech',
  answer?: string,
): TranscriptQuestion => ({
  id,
  text: `${id}?`,
  order_index,
  round: { type },
  answers: answer ? [{ transcript: answer, answered_at: new Date() }] : [],
});

describe('orderTranscript', () => {
  it('orders HR turns before technical ones, by order_index within a round', () => {
    const rows = [
      question('t1', 1, 'tech', 'tech one'),
      question('h2', 2, 'hr', 'hr two'),
      question('h1', 1, 'hr', 'hr one'),
    ];

    expect(orderTranscript(rows).map((turn) => turn.answer)).toEqual([
      'hr one',
      'hr two',
      'tech one',
    ]);
  });

  it('drops questions with no answer — the transcript is answered turns only', () => {
    const rows = [question('h1', 1, 'hr', 'hr one'), question('h2', 2, 'hr')];

    expect(orderTranscript(rows)).toEqual([
      { questionId: 'h1', question: 'h1?', answer: 'hr one', roundType: 'hr' },
    ]);
  });
});
