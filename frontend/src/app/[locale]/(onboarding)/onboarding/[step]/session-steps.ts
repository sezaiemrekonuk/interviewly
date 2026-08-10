/**
 * The steps the visitor has explicitly moved past — Skip, or Continue on a card they left
 * empty — during this tab's session.
 *
 * Backed by `sessionStorage`, not module state (issue 77). Module state is wiped by a page
 * load, so F5 on step 2 made the server-derived resume guard fire again and bounce the
 * visitor back to step 1 — the card they had just deliberately skipped. That is the whole
 * mechanism behind "name/title is mandatory" and "education is mandatory": nothing is
 * required server-side (`auth/profile.ts` has every card-1 field optional), the requirement
 * was an illusion made by this bug.
 *
 * `sessionStorage` is the scope the old doc comment described and module state only
 * approximated: it survives F5 and back/forward, and dies with the tab. A cold load in a new
 * tab therefore starts empty, which is what keeps the deep-link guard intact — the guard
 * protects someone who typed `/onboarding/3`, not someone who chose to leave a card blank
 * thirty seconds ago.
 */
const KEY = 'onboarding:passed';

/** SSR has no `sessionStorage`, and a private-mode browser can throw on access, not just on write. */
function read(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    // Anything else is a key someone else wrote, or a shape from an older build.
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((step): step is number => typeof step === 'number'));
  } catch {
    return new Set();
  }
}

function write(steps: Set<number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify([...steps]));
  } catch {
    // Storage full or blocked: the flow still works, it just forgets across a reload — the
    // behaviour this replaces. Not worth failing a render over.
  }
}

export const passedSteps = {
  has(step: number): boolean {
    return read().has(step);
  },
  add(step: number): void {
    const steps = read();
    steps.add(step);
    write(steps);
  },
  /** Test seam, and what a fresh tab starts from. */
  clear(): void {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      // Same as `write`: nothing here is worth throwing over.
    }
  },
};
