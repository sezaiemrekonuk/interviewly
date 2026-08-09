import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import trMessages from '../../messages/tr.json';
import { DEFAULT_LANDING_PATH } from '../lib/auth-redirect';
import { messages, renderWithIntl } from '../test/render';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
// One stable object, as Next's own `useRouter()` returns.
const router = { ...nav, prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/',
}));
const replace = nav.replace;

import landing from '../components/home/landing.module.css';

import styles from './page.module.css';
import Home from './page';

const demo = messages.landing.demo;
const FRONTEND = demo.roles.frontend;

describe('landing (screen 1)', () => {
  it('renders the hero and every documentary band', () => {
    renderWithIntl(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messages.landing.hero);
    expect(screen.getByText(messages.landing.subhead)).toBeInTheDocument();

    // The page is no longer a hero and three props: each band below the stage is a section
    // with a real subject, and a missing one is a page that got emptied out again.
    for (const title of [
      messages.landing.mechanism.title,
      messages.landing.modes.title,
      messages.landing.report.title,
      messages.landing.languages.title,
      messages.landing.faq.title,
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('opens with Ada holding the floor and her question already asked', () => {
    renderWithIntl(<Home />);

    const hr = screen.getByTestId('demo-tile-hr');
    const tech = screen.getByTestId('demo-tile-tech');
    expect(hr).toHaveAttribute('data-floor', 'true');
    expect(tech).toHaveAttribute('data-floor', 'false');
    // Never colour alone: the tile that has the floor says so in words.
    expect(within(hr).getByText(demo.hasFloor)).toBeInTheDocument();
    expect(within(tech).getByText(demo.roundWaiting)).toBeInTheDocument();

    expect(screen.getByTestId('demo-question')).toHaveTextContent(FRONTEND.hr.question);
  });

  it('scores the answer the visitor picks, with the written reason', async () => {
    renderWithIntl(<Home />);

    await userEvent.click(screen.getByRole('button', { name: FRONTEND.hr.answers.a }));

    const score = screen.getByTestId('demo-score');
    // 4 of 5 for this answer (`demo-content.ts`).
    expect(screen.getByTestId('demo-score-overall')).toHaveTextContent('82');
    expect(within(score).getByText(FRONTEND.hr.reasons.a)).toBeInTheDocument();
    expect(within(score).getByText('STAR 82%')).toBeInTheDocument();

    // Both measurements are named and state their own number as text — the bars are
    // decorative, so a meter that lost its label would leave the score readable by width alone.
    for (const axis of [demo.axes.score, demo.axes.star]) {
      expect(within(score).getByText(axis)).toBeInTheDocument();
    }
    expect(within(score).getAllByRole('progressbar', { hidden: true })).toHaveLength(2);
  });

  // The marking is the climax and it belongs to the exchange. Rendered under the stage it left
  // the room a flat rectangle with a question stranded at the top and pushed the written reason
  // off a 900px screen — so this pins *where*, not just that it exists.
  it('marks the answer inside the room, in the answer list’s place', async () => {
    const { container } = renderWithIntl(<Home />);
    const stage = container.querySelector(`.${landing.stage}`);
    expect(stage).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: FRONTEND.hr.answers.a }));

    expect(stage).toContainElement(screen.getByTestId('demo-result'));
    expect(stage).toContainElement(screen.getByTestId('demo-score'));
    // Taking its place, not sitting under it: two lists of the same three answers would be
    // asking the visitor to choose again after they already have.
    expect(screen.queryByTestId('demo-answers')).toBeNull();
  });

  it('hands the floor to Turing for the technical round, then assembles a report', async () => {
    renderWithIntl(<Home />);

    await userEvent.click(screen.getByRole('button', { name: FRONTEND.hr.answers.a }));
    await userEvent.click(screen.getByRole('button', { name: `Turing takes the technical round` }));

    expect(screen.getByTestId('demo-tile-tech')).toHaveAttribute('data-floor', 'true');
    expect(screen.getByTestId('demo-question')).toHaveTextContent(FRONTEND.tech.question);
    // The report cannot exist before both rounds are answered.
    expect(screen.queryByTestId('demo-report')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: FRONTEND.tech.answers.a }));

    const report = await screen.findByTestId('demo-report');
    // hr 82, tech 91 → 86. Floored, never rounded: a demo about honest marking may not round
    // an 86.5 up, and a real `overall_score` is an integer the model produced.
    expect(screen.getByTestId('demo-report-overall')).toHaveTextContent('86');
    expect(within(report).getByRole('link', { name: demo.report.cta })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('switches the whole interview when the role changes', async () => {
    renderWithIntl(<Home />);

    await userEvent.click(screen.getByRole('button', { name: demo.roles.data.label }));

    expect(screen.getByTestId('demo-question')).toHaveTextContent(demo.roles.data.hr.question);
    expect(screen.getByText(demo.roles.data.listing)).toBeInTheDocument();
    // A part-finished interview from the previous role would score against the wrong answers.
    expect(screen.queryByTestId('demo-score')).toBeNull();
  });

  it('says plainly that the demo is sample material', () => {
    renderWithIntl(<Home />);
    expect(screen.getByText(demo.sampleNote)).toBeInTheDocument();
  });

  it('closes with a quiet CTA band that is not a second --primary', () => {
    const { container } = renderWithIntl(<Home />);
    expect(screen.getByText(messages.landing.closing.line)).toBeInTheDocument();
    const closing = container.querySelector(`.${styles.closingCta}`);
    expect(closing).toHaveAttribute('href', '/register');
    expect(closing).not.toHaveClass(styles.cta);
  });

  it('has exactly one --primary CTA and it links to /register', () => {
    const { container } = renderWithIntl(<Home />);
    const ctas = container.querySelectorAll(`.${styles.cta}`);
    expect(ctas).toHaveLength(1);
    expect(ctas[0]).toHaveAttribute('href', '/register');
    expect(ctas[0]).toHaveTextContent(messages.landing.cta);
  });

  // Direction B: the only picture on the landing is a session. No character, and therefore
  // no image request and no `<link rel=preload as=image>` in the §8.1 budget either.
  it('draws no mascot and preloads no image', () => {
    const { container } = renderWithIntl(<Home />);
    expect(container.querySelector('img')).toBeNull();
    expect(document.querySelector('link[rel="preload"][as="image"]')).toBeNull();
  });

  it('resolves its copy in Turkish, demo included', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={trMessages}>
        <Home />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(trMessages.landing.hero);
    expect(screen.getByRole('link', { name: trMessages.landing.cta })).toBeInTheDocument();
    // The demo carries most of the page's words; an English fallback would show up here first.
    expect(screen.getByTestId('demo-question')).toHaveTextContent(
      trMessages.landing.demo.roles.frontend.hr.question,
    );
    expect(
      screen.getByRole('button', { name: trMessages.landing.demo.roles.data.label }),
    ).toBeInTheDocument();
  });

  it('links both legal pages from the footer (issue 009)', () => {
    renderWithIntl(<Home />);

    expect(screen.getByRole('link', { name: messages.chrome.privacy })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: messages.chrome.terms })).toHaveAttribute(
      'href',
      '/terms',
    );
  });

  // Issue 96: `<header>`/`<footer>` used to sit inside `<main>`, which leaves a screen-reader
  // user with no banner and no contentinfo to jump between — and there was no skip link, so
  // reaching the content past the section anchors cost six Tab presses on every navigation.
  it('exposes the three landmarks and a skip link into main', () => {
    renderWithIntl(<Home />);

    const main = screen.getByRole('main');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    // Siblings, not descendants — the nesting is what suppressed the landmarks.
    expect(main).not.toContainElement(screen.getByRole('banner'));
    expect(main).not.toContainElement(screen.getByRole('contentinfo'));
    // And the target the skip link names actually exists on this page.
    expect(main).toHaveAttribute('id', 'content');
  });

  it('pulls no React Query into the landing tree (§8.1 JS budget)', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toContain('@tanstack/react-query');
    expect(source).not.toContain('./providers');

    // The gate is the boundary: a shared `/me` probe and a redirect. Nothing signed-in is
    // imported into this tree at all, lazily or otherwise — including through the two modules
    // it does reach for, which is where a React Query import would sneak in unnoticed.
    for (const path of [
      ['components', 'home', 'home-switch.tsx'],
      ['lib', 'session-probe.ts'],
      ['lib', 'first-run.ts'],
    ]) {
      const source = readFileSync(join(__dirname, '..', ...path), 'utf8');
      expect({ path, hasQuery: source.includes('@tanstack/react-query') }).toEqual({
        path,
        hasQuery: false,
      });
    }
  });
});

// --------------------------------------------------------------------------- signed in

describe('landing — a visitor who is already signed in', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // `router` is one object shared by every case, so its spies are too.
    replace.mockClear();
  });

  // Issue 80: `/` applies the K8.7 first-run rule rather than sending every session to one
  // landing path. Sending them all to the signed-in home is what let a Google user — who
  // arrives here after the callback — skip onboarding entirely and keep an empty profile.
  it.each([
    ['who has not finished onboarding', { onboardingCompletedAt: null, interviewCount: 0 }, '/onboarding/1'],
    ['with no interviews yet', { onboardingCompletedAt: 'now', interviewCount: 0 }, '/interviews/new'],
    ['who is fully set up', { onboardingCompletedAt: 'now', interviewCount: 3 }, DEFAULT_LANDING_PATH],
  ])('sends a visitor %s to %s', async (_name, account, destination) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ user: { id: 'u1', email: 'a@b.c', ...account } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await act(async () => {
      renderWithIntl(<Home />);
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith(destination));
  });

  // Issue 130: the header and the redirect gate each probed `/me` for themselves, so the
  // app's most-visited page made two identical requests — two 401s and two red console lines
  // anonymously, two authenticated requests (each a Postgres write) signed in.
  it.each([
    ['unauthenticated', 401, { error: { code: 'UNAUTHENTICATED' } }],
    ['authenticated', 200, { user: { id: 'u1', email: 'a@b.c' } }],
  ])('probes the session exactly once (%s), not once per reader', async (_name, status, body) => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    await act(async () => {
      renderWithIntl(<Home />);
    });

    expect(urls.filter((url) => url === '/api/me')).toHaveLength(1);
  });

  it('leaves an anonymous visitor exactly where they are', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await act(async () => {
      renderWithIntl(<Home />);
    });

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messages.landing.hero);
  });
});
