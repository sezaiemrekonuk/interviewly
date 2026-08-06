/**
 * I10 — per-turn language classification and the two-consecutive-turn switch (§3.4, ADR-I09).
 *
 * The classifier itself is I01's pure heuristic, reached through the `AiClient` seam: it makes
 * no provider call and writes no `llm_calls` row. What lives here is the rule that acts on it —
 * `interviews.language` moves only after two *consecutive* turns in the other language.
 */
import type { Interview } from '@prisma/client';

import { aiClient } from '../ai';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

/** MVP interview languages (ai Q1). A turn in any other language is not a switch target. */
const SUPPORTED = new Set(['en', 'tr']);
const SWITCH_AFTER = 2;

/**
 * Consecutive same-other-language turns, keyed by interview id. Deleted on the turn that
 * breaks the streak and on the turn that switches, so nothing accumulates for an interview
 * that keeps answering in one language.
 *
 * ponytail: process-local Map. A second api replica would count each interview's streak
 * separately — move to Redis (`lang_streak:<id>`) if the api is ever scaled out.
 */
const streaks = new Map<string, { language: string; count: number }>();

export interface TrackLanguageOpts {
  traceId: string;
}

/** Drops an interview's streak entry. Call when it reaches a state with no more turns coming. */
export function clearLanguageStreak(interviewId: string): void {
  streaks.delete(interviewId);
}

/**
 * Classifies one answered turn and returns the language the interview runs in afterwards —
 * unchanged except on the turn that completes a switch.
 */
export async function trackLanguage(
  interview: Interview,
  transcript: string,
  opts: TrackLanguageOpts,
): Promise<string> {
  const detection = aiClient().detectLanguage(transcript, interview.language);

  // The trap: consecutive, not cumulative. A below-margin turn, a turn already in the
  // interview's language, and a turn in a language the product does not run in all reset it.
  if (
    detection.ambiguous ||
    detection.language === interview.language ||
    !SUPPORTED.has(detection.language)
  ) {
    streaks.delete(interview.id);
    return interview.language;
  }

  const previous = streaks.get(interview.id);
  const count = previous?.language === detection.language ? previous.count + 1 : 1;
  if (count < SWITCH_AFTER) {
    streaks.set(interview.id, { language: detection.language, count });
    return interview.language;
  }

  streaks.delete(interview.id);
  await prisma.interview.update({
    where: { id: interview.id },
    data: { language: detection.language },
  });
  logger.info(
    {
      traceId: opts.traceId,
      interviewId: interview.id,
      from: interview.language,
      to: detection.language,
    },
    'LANGUAGE_SWITCHED',
  );

  // No candidate regeneration here. This used to fire a D02 refresh for the N+1 row, on the
  // theory that a pool written before the switch was stale. Ordering makes that unnecessary:
  // `advanceWithAnswer` calls this *before* the K4 hook and adopts the returned language, so
  // the pool for the row about to be asked is generated after the switch, in the new language
  // — never refreshed, because it is never written in the old one (#148).
  return detection.language;
}
