/**
 * The steps the visitor has explicitly moved past — Skip, or Continue on a card they left
 * empty — during this page session.
 *
 * Module state on purpose. `/onboarding/[step]` remounts on every param change, so a ref
 * inside the page would be wiped by the very navigation it needs to remember; and a full
 * page load evaluates this module afresh, which is exactly the line the resume guard has
 * to draw. Server-derived resume protects a *deep link* (a cold load straight to step 3),
 * not someone who just chose, in this session, to leave a card blank.
 */
export const passedSteps = new Set<number>();
