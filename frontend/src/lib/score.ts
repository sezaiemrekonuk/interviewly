/**
 * The score scale, once, for every surface that prints one (ADR-I39).
 *
 * `packages/ai/src/schemas.ts` owns the ceiling — it is the gate every stored score passed
 * through — and this is its second copy, because nothing in the browser bundle can import a
 * workspace package that pulls in zod and the prompt registry. The two numbers are the same
 * fact; change one and the other is wrong, which is why they are one constant per side rather
 * than a literal per component.
 */
export const SCORE_MAX = 100;

/**
 * The three display bands, matching the backend's selection cuts
 * (`backend/modules/interview/adaptive-select.ts`): at or below 40 an answer needs work, at or
 * below 60 it held, above that it landed. Returned as a string because the tone is applied by
 * `[data-band='…']` in CSS — the CSP forbids a style attribute, so the number cannot become a
 * colour anywhere but a stylesheet.
 */
export function scoreBand(score: number): 'low' | 'mid' | 'high' {
  if (score <= 40) return 'low';
  if (score <= 60) return 'mid';
  return 'high';
}
