import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COST_RANGES, type AdminCostsResponse } from '../../../lib/query';
import { messages, renderWithIntl, renderWithProviders } from '../../../test/render';

const costsQuery = vi.hoisted(() => ({ useAdminCosts: vi.fn() }));

vi.mock('../../../lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/query')>()),
  useAdminCosts: costsQuery.useAdminCosts,
}));

import { CostPanel } from '../cost-panel';

import { ModelDelta } from './model-delta';
import { ModelMix } from './model-mix';
import { ModelShare } from './model-share';
import { ModelTable } from './model-table';
import { SpendHeatmap } from './spend-heatmap';
import { PerInterviewTrend, SpendTrend } from './trend-lines';

type Chart = (props: { data: AdminCostsResponse }) => ReactElement;

const copy = messages.admin.costs as Record<string, string>;
const OTHER = copy.otherModels;
const NO_SPEND = copy.noSpendRange;

const BUCKETS = ['2026-08-09', '2026-08-10', '2026-08-11'];

const FIXTURE: AdminCostsResponse = {
  days: 30,
  from: '2026-07-13',
  to: '2026-08-11',
  buckets: BUCKETS,
  daily: {
    costUsd: ['0.315000', '0.416000', '0.517000'],
    interviews: [8, 9, 7],
  },
  totals: { costUsd: '1.248000', calls: 492, tokens: 89310, interviews: 24 },
  previous: { costUsd: '0.624000' },
  models: [
    {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      costUsd: '1.200000',
      previousCostUsd: '0.600000',
      calls: 420,
      tokens: 84210,
      averageLatencyMs: 950,
      daily: ['0.300000', '0.400000', '0.500000'],
    },
    {
      provider: 'anthropic',
      model: 'claude-haiku',
      costUsd: '0.012000',
      previousCostUsd: '0.024000',
      calls: 60,
      tokens: 4200,
      averageLatencyMs: 610,
      daily: ['0.003000', '0.004000', '0.005000'],
    },
    {
      provider: null,
      model: null,
      costUsd: '0.036000',
      previousCostUsd: '0.000000',
      calls: 12,
      tokens: 900,
      averageLatencyMs: 400,
      daily: ['0.012000', '0.012000', '0.012000'],
    },
  ],
  hourly: [
    { dow: 1, hour: 9, costUsd: '0.400000' },
    { dow: 4, hour: 14, costUsd: '0.848000' },
  ],
};

const ZEROED: AdminCostsResponse = {
  ...FIXTURE,
  daily: { costUsd: ['0.000000', '0.000000', '0.000000'], interviews: [0, 0, 0] },
  totals: { costUsd: '0.000000', calls: 0, tokens: 0, interviews: 0 },
  previous: { costUsd: '0.000000' },
  models: [],
  hourly: [],
};

const TIED: AdminCostsResponse = {
  ...FIXTURE,
  hourly: [
    { dow: 3, hour: 2, costUsd: '0.002000' },
    { dow: 1, hour: 9, costUsd: '0.002000' },
    { dow: 1, hour: 5, costUsd: '0.002000' },
  ],
};

const SVG_CHARTS: [string, Chart][] = [
  ['trendTitle', SpendTrend],
  ['perDayTitle', PerInterviewTrend],
  ['mixTitle', ModelMix],
  ['deltaTitle', ModelDelta],
  ['shareTitle', ModelShare],
];

const ZERO_CHARTS: [string, Chart, string][] = [
  ['trendTitle', SpendTrend, 'line'],
  ['perDayTitle', PerInterviewTrend, 'line'],
  ['mixTitle', ModelMix, 'line'],
  ['deltaTitle', ModelDelta, 'line'],
  ['shareTitle', ModelShare, 'circle'],
  ['modelsTitle', ModelTable, ''],
  ['heatTitle', SpendHeatmap, '[data-testid="heat-0-0"]'],
];

describe('admin cost charts (W11)', () => {
  beforeEach(() => {
    costsQuery.useAdminCosts.mockReset();
    costsQuery.useAdminCosts.mockReturnValue({ data: FIXTURE, error: null });
  });

  it('prints every money figure as the backend spelled it, never re-rounded', () => {
    renderWithIntl(<ModelTable data={FIXTURE} />);

    expect(screen.getByText('1.200000')).toBeInTheDocument();
    expect(screen.getByText('0.012000')).toBeInTheDocument();
    expect(screen.getByText('0.036000')).toBeInTheDocument();
    expect(screen.getByText('1.248000')).toBeInTheDocument();
    expect(screen.queryByText('1.2')).not.toBeInTheDocument();
    expect(screen.queryByText('$1.20')).not.toBeInTheDocument();
  });

  it('labels the provider-less row rather than leaving a blank cell or printing null', () => {
    const table = renderWithIntl(<ModelTable data={FIXTURE} />);
    const cell = within(table.container).getByText(OTHER);
    expect(cell.textContent?.trim()).toBe(OTHER);
    expect(within(table.container).queryByText('null')).not.toBeInTheDocument();
    expect(within(table.container).queryByText('null · null')).not.toBeInTheDocument();
    table.unmount();

    const mix = renderWithIntl(<ModelMix data={FIXTURE} />);
    expect(
      within(within(mix.container).getByTestId('admin-cost-mix')).getByText(OTHER),
    ).toBeInTheDocument();
    expect(within(mix.container).queryByText('null')).not.toBeInTheDocument();
    mix.unmount();

    const share = renderWithIntl(<ModelShare data={FIXTURE} />);
    expect(
      within(within(share.container).getByTestId('admin-cost-share')).getByText(OTHER),
    ).toBeInTheDocument();
    expect(within(share.container).queryByText('null')).not.toBeInTheDocument();
  });

  it('scales every sparkline against one shared maximum, so a small model draws small', () => {
    const { container } = renderWithIntl(<ModelTable data={FIXTURE} />);

    const points = [...container.querySelectorAll('polyline')].map((line) =>
      line.getAttribute('points'),
    );
    expect(points).toHaveLength(FIXTURE.models.length);
    for (const value of points) expect(value).toBeTruthy();

    expect(points[0]).not.toBe(points[1]);
    expect(new Set(points).size).toBe(FIXTURE.models.length);
  });

  it.each(SVG_CHARTS)('%s hides its drawing from assistive tech and captions the figure', (_key, Chart) => {
    const { container, unmount } = renderWithIntl(<Chart data={FIXTURE} />);

    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true');

    const caption = container.querySelector('figcaption');
    expect(caption?.textContent?.trim()).toBeTruthy();
    unmount();
  });

  it('hides the sparkline svgs and gives the model table a visually hidden caption', () => {
    const { container } = renderWithIntl(<ModelTable data={FIXTURE} />);

    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs).toHaveLength(FIXTURE.models.length);
    for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true');

    expect(container.querySelector('caption')?.textContent?.trim()).toBeTruthy();
  });

  it('hides the heatmap grid from assistive tech and captions the figure', () => {
    const { container } = renderWithIntl(<SpendHeatmap data={FIXTURE} />);

    const grid = container.querySelector('[aria-hidden="true"]');
    expect(grid).not.toBeNull();
    expect(within(container).getByTestId('heat-0-0')).toBeInTheDocument();
    expect(container.querySelector('figcaption')?.textContent?.trim()).toBeTruthy();
  });

  it.each(ZERO_CHARTS)('%s draws a zeroed surface rather than a spinner or a blank', (key, Chart, selector) => {
    const { container, unmount } = renderWithIntl(<Chart data={ZEROED} />);

    expect(container.querySelector('h3')).not.toBeNull();
    expect(within(container).getByRole('heading', { name: copy[key] })).toBeInTheDocument();
    expect(within(container).getByText(NO_SPEND)).toBeInTheDocument();
    expect(within(container).queryByTestId('admin-cost-loading')).not.toBeInTheDocument();
    expect(container.textContent?.trim()).toBeTruthy();
    if (selector !== '') expect(container.querySelectorAll(selector).length).toBeGreaterThan(0);
    unmount();
  });

  it('names one deterministic peak bucket when two buckets tie on cost', () => {
    const first = renderWithIntl(<SpendHeatmap data={TIED} />);
    const caption = first.container.querySelector('figcaption')?.textContent ?? '';
    first.unmount();

    const second = renderWithIntl(<SpendHeatmap data={TIED} />);
    expect(second.container.querySelector('figcaption')?.textContent).toBe(caption);

    expect(caption).toContain(copy.weekday1);
    expect(caption).toContain('05');
    expect(caption).not.toContain(copy.weekday3);
  });

  it('pins exactly one range at a time and refetches the newly chosen span', async () => {
    renderWithProviders(<CostPanel items={[]} stats={undefined} />);

    const buttons = COST_RANGES.map((option) => screen.getByTestId(`admin-cost-range-${option}`));
    expect(buttons).toHaveLength(COST_RANGES.length);
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(
      1,
    );
    expect(screen.getByTestId('admin-cost-range-30')).toHaveAttribute('aria-pressed', 'true');
    expect(costsQuery.useAdminCosts).toHaveBeenLastCalledWith(true, 30);

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-cost-range-7'));
    });

    expect(screen.getByTestId('admin-cost-range-7')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('admin-cost-range-30')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('admin-cost-range-90')).toHaveAttribute('aria-pressed', 'false');
    expect(costsQuery.useAdminCosts).toHaveBeenLastCalledWith(true, 7);
    expect(screen.queryByTestId('admin-cost-loading')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('admin-window-spend')).getByText('1.248000')).toBeInTheDocument();
  });
});
