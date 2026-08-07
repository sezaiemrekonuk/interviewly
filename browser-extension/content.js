/**
 * LinkedIn's job action bar has no stable selector across redesigns/locales, and its pane
 * re-renders on every job click without a page navigation. Rather than chase that DOM, the
 * button is fixed to the viewport (top-right) once and stays there; it re-reads whatever
 * job is on screen at click time, so it never needs to track LinkedIn's re-renders at all.
 */

const BUTTON_ID = 'interviewly-start-interview-btn';
const DEFAULT_ORIGIN = 'http://localhost';

function findDescriptionEl() {
  // LinkedIn has shipped at least two markups for the description container: the older
  // `#job-details` id, and the current SDUI wrapper tagged `data-sdui-component`. The
  // "…more" toggle is a CSS clamp, not real truncation, so textContent already holds the
  // full text in both cases — no need to click anything.
  return (
    document.querySelector('#job-details') ??
    document.querySelector('[data-sdui-component*="aboutTheJob"]')
  );
}

function elementToText(el) {
  // textContent ignores block-level layout entirely (no newline between <p>s or <li>s) and
  // would also swallow the "…more" toggle's own label text. Strip the toggle, then turn
  // block boundaries into real newlines before reading the text back out.
  const clone = el.cloneNode(true);
  clone.querySelectorAll('[data-testid="expandable-text-button"]').forEach((n) => n.remove());
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  clone.querySelectorAll('p, li, div, h1, h2, h3, h4').forEach((block) => block.append('\n'));
  return clone.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function currentJobId() {
  return new URLSearchParams(location.search).get('currentJobId') ?? '';
}

function ascend(el, levels) {
  let node = el;
  for (let i = 0; i < levels && node?.parentElement; i++) node = node.parentElement;
  return node;
}

function buildPrefillUrl(origin) {
  // Scope title/company lookups to an ancestor of the description element, not the whole
  // document — the search-results page renders both a job list and a detail pane at once,
  // and a bare `document.querySelector('h1')`/`.closest('div')` (one level) can grab text
  // from the wrong job or miss the company link entirely. Climbing from the description
  // (unique to the selected job) keeps both fields tied to the same job.
  const descEl = findDescriptionEl();
  const scope = ascend(descEl, 12) ?? document;

  const title = scope.querySelector('h1')?.textContent?.trim() ?? '';
  const company =
    scope.querySelector('a[href*="/company/"]')?.textContent?.trim() ??
    scope.querySelector('[aria-label^="Company,"]')?.getAttribute('aria-label')
      ?.replace(/^Company,\s*/, '')
      ?.replace(/\.$/, '')
      ?.trim() ??
    '';

  const description = descEl ? elementToText(descEl) : '';
  const text = [title, company, '', description].filter(Boolean).join('\n');

  const params = new URLSearchParams({ prefill: text });
  if (title) params.set('jobTitle', title);
  if (company) params.set('jobCompany', company);
  const jobId = currentJobId();
  if (jobId) params.set('jobId', jobId);

  return `${origin}/interviews/new?${params.toString()}`;
}

async function getOrigin() {
  try {
    const { interviewlyOrigin } = await chrome.storage.sync.get('interviewlyOrigin');
    return interviewlyOrigin || DEFAULT_ORIGIN;
  } catch {
    // "Extension context invalidated" fires when the extension is reloaded/updated while
    // this tab's old content script is still alive — a dev-reload artifact, not a real
    // failure. The tab still has a perfectly good default to fall back to.
    return DEFAULT_ORIGIN;
  }
}

// Chrome only allows window.open to bypass the popup blocker when it's called
// synchronously inside the click handler — the `await` on chrome.storage broke that chain
// silently (no console error, the button just did nothing). Cache the origin ahead of time
// so the click handler itself stays synchronous.
let cachedOrigin = DEFAULT_ORIGIN;
getOrigin().then((origin) => {
  cachedOrigin = origin;
});
if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.interviewlyOrigin) cachedOrigin = changes.interviewlyOrigin.newValue || DEFAULT_ORIGIN;
  });
}

function hasJobSelected() {
  return new URLSearchParams(location.search).has('currentJobId');
}

function injectButton() {
  const btn = document.getElementById(BUTTON_ID);
  if (!hasJobSelected()) {
    btn?.remove();
    return;
  }
  if (btn) return;

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.className = 'interviewly-start-btn';
  button.textContent = 'Start Interview';
  button.addEventListener('click', () => {
    window.open(buildPrefillUrl(cachedOrigin), '_blank', 'noopener');
  });

  document.body.appendChild(button);
}

// `currentJobId` changes via pushState when a job is selected/deselected — no reload, so a
// plain load listener only fires once. Patching pushState/replaceState is the standard way
// to observe SPA route changes without polling.
for (const method of ['pushState', 'replaceState']) {
  const original = history[method];
  history[method] = function (...args) {
    original.apply(this, args);
    injectButton();
  };
}
window.addEventListener('popstate', injectButton);

injectButton();

