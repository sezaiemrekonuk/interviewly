/**
 * T07 — the note the dying page leaves for the one that replaces it.
 *
 * A `pagehide` flush is a beacon: it leaves, and then the server spends a second or three on STT
 * and the completeness gate before the fragment exists to be read. The reloaded room asks
 * `GET /state` long before that — measured at ~2 s early on the run that found this — and the
 * recovery notice reads that answer ONCE and freezes it (ADR-T05, deliberately: a notice that
 * kept growing would be the live provisional transcript the ADR rejected). So the honest null it
 * latches is permanent, and the candidate has to refresh a second time to see their own words.
 *
 * `sessionStorage` is what crosses the gap: same tab, survives the reload, gone when the tab is.
 * The marker says only "a flush left here" — never what was said, which stays server-side (K6).
 *
 * Every function is total. Private-mode Safari throws on `sessionStorage` access, and a room that
 * cannot read a hint is a room with no hint, not a broken one.
 */

const KEY = 'interviewly:voice-flush';

/**
 * How long the reloaded room will wait for a flushed fragment to appear before deciding nothing
 * survived. The measured round trip is the beacon's upload, Scribe, and the gate: ~2 s on the run
 * that found this (upload at 11:42:47, held at 11:42:49), and the gate alone costs 780 ms. Six is
 * that with room for a long answer's transcription, and it is a ceiling rather than a target —
 * the notice appears the moment the fragment does.
 */
export const FLUSH_GRACE_MS = 6_000;

/** How often `/state` is re-read while waiting. Nothing else in the room polls it. */
export const FLUSH_POLL_MS = 1_000;

/** Remember that a beacon left this tab for `interviewId`. Called as the page is torn down. */
export function markFlushed(interviewId: string): void {
  try {
    sessionStorage.setItem(KEY, interviewId);
  } catch {
    // No storage, no hint. The notice then behaves exactly as it did before T07.
  }
}

/**
 * Read the marker and clear it in one go — a hint is worth one reload, and leaving it behind
 * would make every later refresh of this tab wait for a flush that already landed.
 */
export function takeFlushed(interviewId: string): boolean {
  try {
    const held = sessionStorage.getItem(KEY);
    if (held === null) return false;
    sessionStorage.removeItem(KEY);
    return held === interviewId;
  } catch {
    return false;
  }
}
