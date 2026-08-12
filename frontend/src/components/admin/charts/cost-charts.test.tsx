import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COST_RANGES, type AdminCostsResponse, type CostRange } from '../../../lib/query';
import { messages, renderWithIntl, renderWithProviders } from '../../../test/render';

const costsQuery = vi.hoisted(() => ({ useAdminCosts: vi.fn() }));

vi.mock('../../../lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/query')>()),
  useAdminCosts: costsQuery.useAdminCosts,
}));

import { CostPanel } from '../cost-panel';

import { ChartPanel } from './chart-panel';
import { ModelLegend } from './model-legend';
import { ModelTable } from './model-table';
import { heatGrid, pad } from './spend-heatmap';

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

const VIEW_MARKS: [string, string][] = [
  ['trend', 'line'],
  ['perDay', 'line'],
  ['mix', 'polygon'],
  ['share', 'circle'],
  ['delta', 'rect'],
  ['hours', '[data-testid="heat-0-0"]'],
];

const TYPES_PER_VIEW: [string, string[]][] = [
  ['trend', ['line', 'area', 'columns']],
  ['perDay', ['line', 'columns']],
  ['mix', ['stackedArea', 'stackedColumns', 'lines']],
  ['share', ['donut', 'bars']],
  ['delta', []],
  ['hours', []],
];

const ZERO_VIEWS: [string, string][] = [
  ['trend', 'line'],
  ['perDay', 'line'],
  ['mix', 'line'],
  ['share', 'circle'],
  ['delta', 'line'],
  ['hours', '[data-testid="heat-0-0"]'],
];

function openPanel(
  data: AdminCostsResponse = FIXTURE,
  onDaysChange: (days: CostRange) => void = vi.fn(),
) {
  const result = renderWithIntl(<ChartPanel data={data} days={30} onDaysChange={onDaysChange} />);
  return { ...result, view: within(result.container).getByTestId('admin-cost-view') };
}

async function pick(select: HTMLElement, value: string) {
  await act(async () => {
    await userEvent.selectOptions(select, value);
  });
}

const typeSelect = (container: HTMLElement) => within(container).queryByTestId('admin-cost-type');

const typeOptions = (container: HTMLElement) =>
  [...(typeSelect(container)?.querySelectorAll('option') ?? [])].map((option) => option.value);

const captionOf = (container: HTMLElement) =>
  container.querySelector('figcaption')?.textContent?.trim() ?? '';

const highestMark = (container: HTMLElement) =>
  Math.min(
    ...[...container.querySelectorAll('polyline, polygon')].flatMap((node) =>
      (node.getAttribute('points') ?? '')
        .split(' ')
        .filter(Boolean)
        .map((pair) => Number(pair.split(',')[1])),
    ),
  );

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

    const legend = renderWithIntl(<ModelLegend data={FIXTURE} money />);
    const row = within(legend.container).getByText(OTHER);
    expect(row.textContent?.trim()).toBe(OTHER);
    expect(within(legend.container).queryByText('null')).not.toBeInTheDocument();
    expect(within(legend.container).queryByText('null · null')).not.toBeInTheDocument();
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

  it.each(VIEW_MARKS)(
    'the %s view hides its drawing from assistive tech and captions the figure',
    async (id, marks) => {
      const { container, view } = openPanel();
      await pick(view, id);

      expect(container.querySelectorAll(marks).length).toBeGreaterThan(0);
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      }

      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(captionOf(container)).toBeTruthy();
    },
  );

  it('offers only the drawings the chosen view can be drawn as, and hides the picker when there is one', async () => {
    const { container, view } = openPanel();

    for (const [id, expected] of TYPES_PER_VIEW) {
      await pick(view, id);
      if (expected.length === 0) {
        expect(typeSelect(container)).toBeNull();
      } else {
        expect(typeSelect(container)).not.toBeNull();
        expect(typeOptions(container)).toEqual(expected);
      }
    }
  });

  it('redraws the same view when the drawing changes and keeps the caption the view owns', async () => {
    const { container, view } = openPanel();
    await pick(view, 'mix');

    const caption = captionOf(container);
    expect(container.querySelectorAll('polygon').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('rect')).toHaveLength(0);

    await pick(within(container).getByTestId('admin-cost-type'), 'stackedColumns');

    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('polygon')).toHaveLength(0);
    expect(captionOf(container)).toBe(caption);
  });

  it('remembers the drawing chosen for each view instead of resetting it', async () => {
    const { container, view } = openPanel();

    await pick(within(container).getByTestId('admin-cost-type'), 'area');
    expect(within(container).getByTestId('admin-cost-type')).toHaveValue('area');

    await pick(view, 'perDay');
    expect(within(container).getByTestId('admin-cost-type')).toHaveValue('line');

    await pick(view, 'trend');
    expect(within(container).getByTestId('admin-cost-type')).toHaveValue('area');
  });

  it('scales one line per model against the tallest model, not against the stacked total', async () => {
    const { container, view } = openPanel();
    await pick(view, 'mix');

    const stacked = highestMark(container);

    await pick(within(container).getByTestId('admin-cost-type'), 'lines');

    const lines = highestMark(container);
    expect(Number.isFinite(stacked)).toBe(true);
    expect(Number.isFinite(lines)).toBe(true);
    expect(lines).toBeLessThan(stacked);
  });

  it.each(ZERO_VIEWS)(
    'the %s view draws a zeroed surface rather than a spinner or a blank',
    async (id, marks) => {
      const { container, view } = openPanel(ZEROED);
      await pick(view, id);

      expect(container.querySelectorAll(marks).length).toBeGreaterThan(0);
      expect(captionOf(container)).toBeTruthy();
      expect(within(container).queryByTestId('admin-cost-loading')).not.toBeInTheDocument();
      expect(within(container).getAllByText(NO_SPEND).length).toBe(1);
    },
  );

  it('resolves a tie for the busiest bucket to the lower day then the lower hour', async () => {
    expect(heatGrid(TIED.hourly)).toMatchObject({ max: 2000, peakDow: 1, peakHour: 5 });
    expect(heatGrid([])).toMatchObject({ max: 0, peakDow: 0, peakHour: 0 });
    expect(pad(5)).toBe('05');

    const first = openPanel(TIED);
    await pick(first.view, 'hours');
    const caption = captionOf(first.container);
    first.unmount();

    const second = openPanel(TIED);
    await pick(second.view, 'hours');

    expect(captionOf(second.container)).toBe(caption);
    expect(caption).toContain(copy.weekday1);
    expect(caption).toContain('05');
    expect(caption).not.toContain(copy.weekday3);
  });

  it('pins exactly one range at a time and reports the newly chosen span', async () => {
    const onDaysChange = vi.fn();
    const { container } = openPanel(FIXTURE, onDaysChange);

    const buttons = COST_RANGES.map((option) =>
      within(container).getByTestId(`admin-cost-range-${option}`),
    );
    expect(buttons).toHaveLength(COST_RANGES.length);
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(
      1,
    );
    expect(within(container).getByTestId('admin-cost-range-30')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await act(async () => {
      await userEvent.click(within(container).getByTestId('admin-cost-range-7'));
    });

    expect(onDaysChange).toHaveBeenCalledWith(7);
  });

  it('moves the pinned range and refetches the newly chosen span', async () => {
    renderWithProviders(<CostPanel items={[]} stats={undefined} />);

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
