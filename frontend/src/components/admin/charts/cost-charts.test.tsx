import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COST_RANGES,
  type AdminCostDaily,
  type AdminCostModel,
  type AdminCostsResponse,
  type CostRange,
} from '../../../lib/query';
import { messages, renderWithIntl, renderWithProviders } from '../../../test/render';

const costsQuery = vi.hoisted(() => ({ useAdminCosts: vi.fn() }));

vi.mock('../../../lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/query')>()),
  useAdminCosts: costsQuery.useAdminCosts,
}));

import { CostPanel } from '../cost-panel';
import { microUsd } from '../interview-table';

import { ChartPanel } from './chart-panel';
import styles from './charts.module.css';
import { foldTop } from './fold';
import { ModelLegend } from './model-legend';
import { ModelTable } from './model-table';
import { heatGrid, pad } from './spend-heatmap';

const copy = messages.admin.costs as Record<string, string>;
const OTHER = copy.otherModels;
const NO_SPEND = copy.noSpendRange;

const BUCKETS = ['2026-08-09', '2026-08-10', '2026-08-11'];

const usd = (micro: number) => (micro / 1_000_000).toFixed(6);

function model(
  provider: string,
  name: string,
  previousCostUsd: string,
  daily: AdminCostDaily,
): AdminCostModel {
  const calls = daily.calls.reduce((sum, value) => sum + value, 0);
  const weighted = daily.latencyMs.reduce(
    (sum, value, index) => sum + value * daily.calls[index],
    0,
  );

  return {
    provider,
    model: name,
    costUsd: usd(daily.costUsd.reduce((sum, value) => sum + microUsd(value), 0)),
    previousCostUsd,
    calls,
    tokens: daily.tokens.reduce((sum, value) => sum + value, 0),
    averageLatencyMs: calls === 0 ? 0 : Math.round(weighted / calls),
    daily,
  };
}

const TTS = model('elevenlabs', 'tts', '0.600000', {
  costUsd: ['0.300000', '0.400000', '0.500000'],
  calls: [140, 150, 130],
  tokens: [0, 0, 0],
  latencyMs: [900, 950, 1000],
});

const MINI = model('openai', 'gpt-4.1-mini', '0.400000', {
  costUsd: ['0.150000', '0.200000', '0.250000'],
  calls: [60, 70, 50],
  tokens: [30000, 31000, 23210],
  latencyMs: [600, 650, 700],
});

const STT = model('elevenlabs', 'stt', '0.000000', {
  costUsd: ['0.012000', '0.012000', '0.012000'],
  calls: [4, 4, 4],
  tokens: [0, 0, 0],
  latencyMs: [400, 400, 400],
});

const FLASH = model('google', 'gemini-2.5-flash', '0.024000', {
  costUsd: ['0.003000', '0.004000', '0.005000'],
  calls: [20, 20, 20],
  tokens: [1400, 1400, 1400],
  latencyMs: [610, 610, 610],
});

const NANO = model('openai', 'gpt-4.1-nano', '0.001000', {
  costUsd: ['0.001000', '0.001000', '0.001000'],
  calls: [5, 5, 5],
  tokens: [300, 300, 300],
  latencyMs: [300, 300, 300],
});

const HAIKU = model('anthropic', 'claude-haiku', '0.000000', {
  costUsd: ['0.001000', '0.000500', '0.000500'],
  calls: [3, 3, 4],
  tokens: [100, 100, 100],
  latencyMs: [500, 500, 500],
});

const SMALL = model('mistral', 'small', '0.000000', {
  costUsd: ['0.000400', '0.000300', '0.000300'],
  calls: [2, 2, 2],
  tokens: [50, 50, 50],
  latencyMs: [700, 700, 700],
});

const FIXTURE: AdminCostsResponse = {
  days: 30,
  from: '2026-07-13',
  to: '2026-08-11',
  buckets: BUCKETS,
  daily: {
    costUsd: ['0.466000', '0.617000', '0.768000'],
    interviews: [8, 9, 7],
  },
  totals: { costUsd: '1.851000', calls: 687, tokens: 89310, interviews: 24 },
  previous: { costUsd: '1.025000' },
  models: [TTS, MINI, STT, FLASH, NANO],
  truncated: 0,
  hourly: [
    { dow: 1, hour: 9, costUsd: '0.400000' },
    { dow: 4, hour: 14, costUsd: '0.848000' },
  ],
};

const CAPPED: AdminCostsResponse = {
  ...FIXTURE,
  models: [...FIXTURE.models, HAIKU, SMALL],
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
  ['compare', 'polyline'],
  ['share', 'circle'],
  ['delta', 'rect'],
  ['hours', '[data-testid="heat-0-0"]'],
];

const TYPES_PER_VIEW: [string, string[]][] = [
  ['trend', ['line', 'area', 'columns']],
  ['perDay', ['line', 'columns']],
  ['mix', ['stackedArea', 'stackedColumns', 'lines']],
  ['compare', ['line', 'area']],
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

async function tap(button: HTMLElement) {
  await act(async () => {
    await userEvent.click(button);
  });
}

async function openCompare(data: AdminCostsResponse = FIXTURE, by: 'provider' | 'model' = 'provider') {
  const panel = openPanel(data);
  await pick(panel.view, 'compare');
  if (by !== 'provider') {
    await pick(within(panel.container).getByTestId('admin-cost-by'), by);
  }
  return panel;
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

const chipKeys = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid^="admin-cost-series-"]')].map((node) =>
    (node.getAttribute('data-testid') ?? '').slice('admin-cost-series-'.length),
  );

const chip = (container: HTMLElement, key: string) =>
  within(container).getByTestId(`admin-cost-series-${key}`);

const linePoints = (container: HTMLElement) =>
  [...container.querySelectorAll('polyline')].map((node) => node.getAttribute('points'));

const lineClasses = (container: HTMLElement) =>
  [...container.querySelectorAll('polyline')].map((node) => node.getAttribute('class') ?? '');

const tickTexts = (container: HTMLElement) =>
  [...container.querySelectorAll('text')].map((node) => node.textContent);

describe('admin cost charts (W11)', () => {
  beforeEach(() => {
    costsQuery.useAdminCosts.mockReset();
    costsQuery.useAdminCosts.mockReturnValue({ data: FIXTURE, error: null });
  });

  it('prints every money figure as the backend spelled it, never re-rounded', () => {
    renderWithIntl(<ModelTable data={FIXTURE} />);

    expect(screen.getByText('1.200000')).toBeInTheDocument();
    expect(screen.getByText('0.600000')).toBeInTheDocument();
    expect(screen.getByText('0.036000')).toBeInTheDocument();
    expect(screen.getByText('0.003000')).toBeInTheDocument();
    expect(screen.getByText('1.851000')).toBeInTheDocument();
    expect(screen.queryByText('1.2')).not.toBeInTheDocument();
    expect(screen.queryByText('$1.20')).not.toBeInTheDocument();
  });

  it('labels the folded residual rather than leaving a blank cell or printing null', () => {
    const legend = renderWithIntl(
      <ModelLegend models={foldTop(FIXTURE.models)} totalUsd={FIXTURE.totals.costUsd} money />,
    );
    const row = within(legend.container).getByText(OTHER);
    expect(row.textContent?.trim()).toBe(OTHER);
    expect(within(legend.container).queryByText('null')).not.toBeInTheDocument();
    expect(within(legend.container).queryByText('null · null')).not.toBeInTheDocument();
    legend.unmount();

    const table = renderWithIntl(<ModelTable data={FIXTURE} />);
    expect(within(table.container).queryByText('null')).not.toBeInTheDocument();
    expect(within(table.container).queryByText('null · null')).not.toBeInTheDocument();
  });

  it('lists every ranked model in the table instead of three and a bucket', () => {
    const { container } = renderWithIntl(<ModelTable data={FIXTURE} />);

    for (const row of FIXTURE.models) {
      expect(within(container).getByText(`${row.provider} · ${row.model}`)).toBeInTheDocument();
    }
    expect(within(container).queryByText(OTHER)).not.toBeInTheDocument();
  });

  it('swatches only the models the charts actually colour, and marks no other row as residual', () => {
    const { container } = renderWithIntl(<ModelTable data={FIXTURE} />);

    const swatches = [...container.querySelectorAll(`.${styles.swatch}`)];
    expect(swatches).toHaveLength(FIXTURE.models.length);
    expect(swatches.slice(0, 3).map((node) => node.getAttribute('data-series'))).toEqual([
      's1',
      's2',
      's3',
    ]);
    for (const node of swatches.slice(3)) {
      expect(node.getAttribute('data-series')).toBeNull();
    }
  });

  it('says what the cap dropped on the table that claims to be the whole list', () => {
    const whole = renderWithIntl(<ModelTable data={FIXTURE} />);
    expect(within(whole.container).queryByTestId('admin-cost-truncated')).not.toBeInTheDocument();

    const capped = renderWithIntl(<ModelTable data={{ ...FIXTURE, truncated: 4 }} />);
    expect(within(capped.container).getByTestId('admin-cost-truncated')).toBeInTheDocument();
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

  it('folds the charted mix to three models plus one residual band', async () => {
    const { container, view } = openPanel();
    await pick(view, 'mix');

    const rows = [...container.querySelectorAll('li')];
    expect(rows).toHaveLength(4);
    expect(rows.at(-1)?.textContent).toContain(OTHER);
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

  it('rolls the models up to one chip per provider, keyed by the bare provider name', async () => {
    const { container } = await openCompare();

    expect(chipKeys(container)).toEqual(['elevenlabs', 'openai', 'google']);
  });

  it('resets the chosen series to the new dimension default rather than drawing nothing', async () => {
    const { container } = await openCompare(FIXTURE, 'model');

    await tap(chip(container, 'openai:gpt-4.1-nano'));
    expect(chip(container, 'openai:gpt-4.1-nano')).toHaveAttribute('aria-pressed', 'true');

    await pick(within(container).getByTestId('admin-cost-by'), 'provider');

    expect(chipKeys(container)).toEqual(['elevenlabs', 'openai', 'google']);
    for (const key of chipKeys(container)) {
      expect(chip(container, key)).toHaveAttribute('aria-pressed', 'true');
    }
    expect(linePoints(container)).toHaveLength(3);
  });

  it('stops adding series at six and lets go again once one is dropped', async () => {
    const { container } = await openCompare(CAPPED, 'model');

    for (const key of ['google:gemini-2.5-flash', 'openai:gpt-4.1-nano', 'anthropic:claude-haiku']) {
      await tap(chip(container, key));
    }

    expect(linePoints(container)).toHaveLength(6);
    expect(chip(container, 'mistral:small')).toBeDisabled();
    expect(within(container).getByText(copy.seriesCap)).toBeInTheDocument();

    await tap(chip(container, 'anthropic:claude-haiku'));

    expect(chip(container, 'mistral:small')).toBeEnabled();
    expect(within(container).queryByText(copy.seriesCap)).not.toBeInTheDocument();
  });

  it('says the series list is empty rather than claiming nothing was spent', async () => {
    const { container } = await openCompare();

    for (const key of chipKeys(container)) await tap(chip(container, key));

    for (const key of chipKeys(container)) {
      expect(chip(container, key)).toHaveAttribute('aria-pressed', 'false');
    }
    expect(captionOf(container)).toBe(copy.seriesEmpty);
    expect(within(container).queryByText(NO_SPEND)).not.toBeInTheDocument();
  });

  it('redraws the lines and relabels the axis when the measure changes', async () => {
    const { container } = await openCompare(FIXTURE, 'model');

    const before = linePoints(container);
    expect(tickTexts(container)).toContain('0.0000');

    await pick(within(container).getByTestId('admin-cost-measure'), 'calls');

    const after = linePoints(container);
    expect(after).toHaveLength(before.length);
    expect(after).not.toEqual(before);
    expect(tickTexts(container)).not.toContain('0.0000');
  });

  it('warns that a token-free series bills per second, and only while tokens are on show', async () => {
    const { container } = await openCompare(FIXTURE, 'model');
    const measure = () => within(container).getByTestId('admin-cost-measure');

    await pick(measure(), 'tokens');
    expect(within(container).getByTestId('admin-cost-tokenless').textContent).toContain(
      'elevenlabs · tts',
    );

    await pick(measure(), 'cost');
    expect(within(container).queryByTestId('admin-cost-tokenless')).not.toBeInTheDocument();

    await pick(measure(), 'tokens');
    await tap(chip(container, 'elevenlabs:tts'));
    await tap(chip(container, 'elevenlabs:stt'));

    expect(chip(container, 'openai:gpt-4.1-mini')).toHaveAttribute('aria-pressed', 'true');
    expect(within(container).queryByTestId('admin-cost-tokenless')).not.toBeInTheDocument();
  });

  it('gives each compared series its own stroke, dashing the ones past the third hue', async () => {
    const { container } = await openCompare(FIXTURE, 'model');

    await tap(chip(container, 'google:gemini-2.5-flash'));

    const classes = lineClasses(container);
    expect(classes).toHaveLength(4);
    expect(new Set(classes).size).toBeGreaterThan(1);
    expect(classes.filter((value) => value.split(' ').includes(styles.dashed))).toHaveLength(1);
  });

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

    await tap(within(container).getByTestId('admin-cost-range-7'));

    expect(onDaysChange).toHaveBeenCalledWith(7);
  });

  it('moves the pinned range and refetches the newly chosen span', async () => {
    renderWithProviders(<CostPanel items={[]} stats={undefined} />);

    expect(screen.getByTestId('admin-cost-range-30')).toHaveAttribute('aria-pressed', 'true');
    expect(costsQuery.useAdminCosts).toHaveBeenLastCalledWith(true, 30);

    await tap(screen.getByTestId('admin-cost-range-7'));

    expect(screen.getByTestId('admin-cost-range-7')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('admin-cost-range-30')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('admin-cost-range-90')).toHaveAttribute('aria-pressed', 'false');
    expect(costsQuery.useAdminCosts).toHaveBeenLastCalledWith(true, 7);
    expect(screen.queryByTestId('admin-cost-loading')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('admin-window-spend')).getByText('1.851000')).toBeInTheDocument();
  });
});
