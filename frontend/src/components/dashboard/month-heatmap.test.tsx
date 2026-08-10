/**
 * The practice grid, and the three things it must not get wrong: which month it is showing,
 * where the picker is allowed to go, and a month with nothing in it reading as a failed load.
 *
 * The counts are asserted against the endpoint's answer, never against `/me/interviews` — that
 * separation is the whole reason issue 245 needed a backend change, so a test that faked the
 * numbers from a list would be testing the bug.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';

import { MonthHeatmap } from './month-heatmap';

/** ICU fill, so an assertion names a key instead of hard-coding polished copy. */
const copy = (template: string, vars: Record<string, string | number>) =>
  template
    .replace(/\{(\w+), plural,.*?\}\}/g, (match) => {
      const [, one] = /one \{([^}]*)\}/.exec(match) ?? [];
      const [, other] = /other \{([^}]*)\}/.exec(match) ?? [];
      const [, name] = /\{(\w+), plural/.exec(match) ?? [];
      return Number(vars[name]) === 1 ? one : other;
    })
    .replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key]));

const AUGUST = new Date('2026-08-17T09:00:00.000Z').getTime();

interface Activity {
  days?: { date: string; count: number }[];
  max?: number;
  earliest?: string | null;
}

/** Keyed by month, so stepping the picker is answered with that month's own body. */
function stub(months: Record<string, Activity>) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const month = new URL(url, 'http://x').searchParams.get('month') ?? '';
      asked.push(url);
      const body = months[month] ?? { days: [], max: 0, earliest: null };
      return new Response(
        JSON.stringify({
          month,
          days: body.days ?? [],
          max: body.max ?? 0,
          earliest: body.earliest ?? null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  return asked;
}

async function render() {
  await act(async () => {
    renderWithProviders(<MonthHeatmap now={AUGUST} />);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the practice grid', () => {
  it('shades each day against the busiest day of the month shown', async () => {
    stub({
      '2026-08': {
        max: 4,
        days: [
          { date: '2026-08-03', count: 4 },
          { date: '2026-08-05', count: 3 },
          { date: '2026-08-11', count: 2 },
          { date: '2026-08-19', count: 1 },
        ],
        earliest: '2026-05',
      },
    });
    await render();

    // Four steps: the empty ground, then three rising to the month's busiest day.
    await waitFor(() => expect(screen.getByTestId('day-2026-08-03')).toHaveAttribute('data-tier', '3'));
    expect(screen.getByTestId('day-2026-08-05')).toHaveAttribute('data-tier', '3');
    expect(screen.getByTestId('day-2026-08-11')).toHaveAttribute('data-tier', '2');
    expect(screen.getByTestId('day-2026-08-19')).toHaveAttribute('data-tier', '1');
    // A day nobody practised on is the empty ground, not a missing cell.
    expect(screen.getByTestId('day-2026-08-04')).toHaveAttribute('data-tier', '0');
  });

  it('draws every day of the month and no day of another', async () => {
    stub({ '2026-08': { max: 1, days: [{ date: '2026-08-01', count: 1 }] } });
    await render();

    await waitFor(() => expect(screen.getByTestId('day-2026-08-31')).toBeInTheDocument());
    expect(screen.queryByTestId('day-2026-08-32')).toBeNull();
    expect(screen.queryByTestId('day-2026-07-31')).toBeNull();
    expect(screen.queryByTestId('day-2026-09-01')).toBeNull();
  });

  // The count that a page of twenty rows could not have carried. `/me/interviews` answers 20
  // and this month holds 26 — the number has to come from the aggregate or it is wrong.
  it('reports a month heavier than one page of the interview list', async () => {
    stub({
      '2026-08': {
        max: 26,
        days: [
          { date: '2026-08-02', count: 26 },
          { date: '2026-08-09', count: 4 },
        ],
      },
    });
    await render();

    await waitFor(() =>
      expect(screen.getByTestId('practice-summary')).toHaveTextContent(
        copy(messages.dashboard.practice.summary, { total: 30, days: 2, month: 'August 2026' }),
      ),
    );
  });

  // Caught in the browser, not here: the module printed "0 interviews across 0 days" over an
  // all-empty grid for as long as the request was in flight — a claim nobody had established,
  // and indistinguishable from a month spent doing nothing.
  it('claims nothing while the month is still arriving', async () => {
    let answer: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    await render();

    expect(screen.queryByTestId('practice-summary')).toBeNull();
    expect(screen.queryByTestId('practice-empty')).toBeNull();
    // The ground is still drawn, so the card does not grow once the answer lands.
    expect(screen.getByTestId('day-2026-08-01')).toBeInTheDocument();

    await act(async () => {
      answer(
        new Response(JSON.stringify({ month: '2026-08', days: [], max: 0, earliest: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    await waitFor(() => expect(screen.getByTestId('practice-empty')).toBeInTheDocument());
  });

  it('says a month is empty instead of drawing thirty blank squares', async () => {
    stub({ '2026-08': { days: [], max: 0, earliest: '2026-05' } });
    await render();

    await waitFor(() => expect(screen.getByTestId('practice-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('day-2026-08-01')).toBeNull();
  });

  // The grid is a graphic; a screen reader gets the one sentence under it, not thirty cells.
  it('keeps the grid decorative and the numbers in text', async () => {
    stub({ '2026-08': { max: 2, days: [{ date: '2026-08-06', count: 2 }] } });
    await render();

    await waitFor(() => expect(screen.getByTestId('practice-summary')).toBeInTheDocument());
    expect(screen.getByTestId('day-2026-08-06').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByTestId('practice-summary')).toHaveTextContent(
      copy(messages.dashboard.practice.summary, { total: 2, days: 1, month: 'August 2026' }),
    );
  });
});

describe('the month picker', () => {
  it('steps back a month and asks the endpoint for that month', async () => {
    const asked = stub({
      '2026-08': { max: 1, days: [{ date: '2026-08-06', count: 1 }], earliest: '2026-05' },
      '2026-07': { max: 1, days: [{ date: '2026-07-02', count: 1 }], earliest: '2026-05' },
    });
    await render();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('practice-month')).toHaveTextContent('August 2026'));
    await user.click(screen.getByRole('button', { name: messages.dashboard.practice.previousMonth }));

    await waitFor(() => expect(screen.getByTestId('practice-month')).toHaveTextContent('July 2026'));
    expect(asked.some((url) => url.includes('month=2026-07'))).toBe(true);
    await waitFor(() => expect(screen.getByTestId('day-2026-07-02')).toHaveAttribute('data-tier', '3'));
  });

  it('does not go into the future', async () => {
    stub({ '2026-08': { max: 1, days: [{ date: '2026-08-06', count: 1 }], earliest: '2026-05' } });
    await render();

    await waitFor(() => expect(screen.getByTestId('practice-month')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: messages.dashboard.practice.nextMonth })).toBeDisabled();
  });

  // An account that started in August can still look at February and see for itself that
  // there is nothing there. The first interview as the floor made both arrows dead on a fresh
  // account, which is a control that does nothing.
  it('goes back past the first interview to the start of the calendar year', async () => {
    stub({ '2026-08': { max: 1, days: [{ date: '2026-08-06', count: 1 }], earliest: '2026-08' } });
    await render();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('practice-month')).toHaveTextContent('August 2026'));
    const back = screen.getByRole('button', { name: messages.dashboard.practice.previousMonth });

    for (const expected of ['July', 'June', 'May', 'April', 'March', 'February', 'January']) {
      await user.click(back);
      await waitFor(() =>
        expect(screen.getByTestId('practice-month')).toHaveTextContent(`${expected} 2026`),
      );
    }
    // …and no further: a practice log has nothing to say about the year before it.
    expect(back).toBeDisabled();
  });

  // Older history is still reachable — the year is a floor for accounts that have none, not a
  // ceiling on the ones that do.
  it('goes back past January when the account is older than the year', async () => {
    stub({
      '2026-01': { max: 1, days: [{ date: '2026-01-06', count: 1 }], earliest: '2025-11' },
      '2026-08': { max: 1, days: [{ date: '2026-08-06', count: 1 }], earliest: '2025-11' },
    });
    await render();

    await waitFor(() => expect(screen.getByTestId('practice-month')).toBeInTheDocument());
    expect(
      screen.getByRole('button', { name: messages.dashboard.practice.previousMonth }),
    ).toBeEnabled();
  });
});
