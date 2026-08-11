import type { RoomMessage } from '../../lib/query';

/** One thing the interviewer said, and everything the candidate said back before the next one. */
export interface Exchange {
  /** The interviewer's line: the question on the first, a clarification on every one after. */
  ask: string;
  /** The candidate's reply. Empty when they said nothing before the interview moved on. */
  answer: string;
}

/**
 * The conversation, regrouped per question into the exchanges it was made of.
 *
 * The report used to render `transcript[].answer`, which is every candidate utterance for a
 * question joined with a blank line (`answerWindow`, `conductor.ts`) under the question's own
 * text. A question that took three turns therefore read as one long answer to a question that
 * was asked once — the two clarifications that produced the second and third parts were
 * nowhere on the screen, so the answer looked like rambling rather than like a reply to
 * something. The messages already carry both halves separately, keyed by `questionId`.
 *
 * A `system` row (the server's forced-advance note) is skipped: it is not something either
 * party said, and `state.ts` has already filtered the refusal notes out of this list.
 *
 * Empty for an interview conducted before C02, or through `POST /answers` — those write no
 * assistant rows, so the caller falls back to the question/answer pair it already had.
 */
export function exchangesFor(messages: RoomMessage[]): Map<string, Exchange[]> {
  const byQuestion = new Map<string, Exchange[]>();

  for (const message of messages) {
    if (message.questionId === null) continue;
    if (message.role !== 'assistant' && message.role !== 'user') continue;

    const exchanges = byQuestion.get(message.questionId) ?? [];
    if (exchanges.length === 0) byQuestion.set(message.questionId, exchanges);

    if (message.role === 'assistant') {
      exchanges.push({ ask: message.content, answer: '' });
      continue;
    }

    // A candidate utterance with no interviewer line before it: the room's own opening turn is
    // written by `openRound`, so this only happens on a replayed or repaired interview. Give it
    // an exchange of its own rather than dropping the answer on the floor.
    const open = exchanges[exchanges.length - 1];
    if (!open) {
      exchanges.push({ ask: '', answer: message.content });
      continue;
    }
    open.answer = open.answer ? `${open.answer}\n\n${message.content}` : message.content;
  }

  return byQuestion;
}
