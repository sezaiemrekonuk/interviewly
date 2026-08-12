'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { COST_RANGES, type AdminCostModel, type AdminCostsResponse, type CostRange } from '../../../lib/query';
import { Select } from '../../ui';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';
import { byProvider, foldTop } from './fold';
import { niceMax } from './geometry';
import { ModelColumns } from './model-columns';
import { ModelLegend } from './model-legend';
import { ModelShare } from './model-share';
import {
  AreaMarks,
  asCount,
  asUsd,
  ColumnMarks,
  LineMarks,
  MultiLineMarks,
  Plot,
  StackedAreaMarks,
  StackedColumnMarks,
} from './plot';
import { COMPARE_LIMIT, seriesKey, seriesLabel, seriesStyle, seriesToken, solid } from './series';
import { SeriesPicker } from './series-picker';
import { heatGrid, pad, SpendHeatmap } from './spend-heatmap';

type ViewId = 'trend' | 'perDay' | 'mix' | 'share' | 'delta' | 'hours' | 'compare';

type TypeId =
  | 'line'
  | 'area'
  | 'columns'
  | 'stackedArea'
  | 'stackedColumns'
  | 'lines'
  | 'donut'
  | 'bars'
  | 'grouped'
  | 'heatmap';

type Dimension = 'provider' | 'model';

type Measure = 'cost' | 'calls' | 'tokens' | 'latency';

const VIEWS: { id: ViewId; title: string; types: TypeId[] }[] = [
  { id: 'trend', title: 'costs.trendTitle', types: ['line', 'area', 'columns'] },
  { id: 'perDay', title: 'costs.perDayTitle', types: ['line', 'columns'] },
  { id: 'mix', title: 'costs.mixTitle', types: ['stackedArea', 'stackedColumns', 'lines'] },
  { id: 'compare', title: 'costs.viewCompare', types: ['line', 'area'] },
  { id: 'share', title: 'costs.shareTitle', types: ['donut', 'bars'] },
  { id: 'delta', title: 'costs.deltaTitle', types: ['grouped'] },
  { id: 'hours', title: 'costs.heatTitle', types: ['heatmap'] },
];

const TYPE_LABEL: Record<TypeId, string> = {
  line: 'costs.typeLine',
  area: 'costs.typeArea',
  columns: 'costs.typeColumns',
  stackedArea: 'costs.typeStackedArea',
  stackedColumns: 'costs.typeStackedColumns',
  lines: 'costs.typeLines',
  donut: 'costs.typeDonut',
  bars: 'costs.typeBars',
  grouped: 'costs.typeGrouped',
  heatmap: 'costs.typeHeatmap',
};

const DIMENSIONS: Dimension[] = ['provider', 'model'];

const DIMENSION_LABEL: Record<Dimension, string> = {
  provider: 'costs.byProvider',
  model: 'costs.byModel',
};

const MEASURES: Measure[] = ['cost', 'calls', 'tokens', 'latency'];

const MEASURE_LABEL: Record<Measure, string> = {
  cost: 'costs.measureCost',
  calls: 'costs.measureCalls',
  tokens: 'costs.measureTokens',
  latency: 'costs.measureLatency',
};

const DEFAULTS = Object.fromEntries(VIEWS.map((view) => [view.id, view.types[0]])) as Record<
  ViewId,
  TypeId
>;

const DEFAULT_COMPARE = 3;

const usd = (micro: number) => (micro / 1_000_000).toFixed(6);

function valuesOf(row: AdminCostModel, measure: Measure): number[] {
  if (measure === 'cost') return row.daily.costUsd.map(microUsd);
  if (measure === 'calls') return row.daily.calls;
  if (measure === 'tokens') return row.daily.tokens;
  return row.daily.latencyMs;
}

export function ChartPanel({
  data,
  days,
  onDaysChange,
}: {
  data: AdminCostsResponse;
  days: CostRange;
  onDaysChange: (days: CostRange) => void;
}) {
  const t = useTranslations('admin');
  const [view, setView] = useState<ViewId>('trend');
  const [chosen, setChosen] = useState<Record<ViewId, TypeId>>(DEFAULTS);
  const [dimension, setDimension] = useState<Dimension>('provider');
  const [measure, setMeasure] = useState<Measure>('cost');
  const [picked, setPicked] = useState<string[] | null>(null);

  const active = VIEWS.find((entry) => entry.id === view) ?? VIEWS[0];
  const type = chosen[view];

  const labels = data.buckets.map((bucket) => bucket.slice(5));
  const folded = foldTop(data.models);
  const spend = data.daily.costUsd.map(microUsd);
  const perInterview = data.daily.costUsd.map((cost, index) =>
    data.daily.interviews[index] > 0 ? microUsd(cost) / data.daily.interviews[index] : 0,
  );
  const mix = folded.map((row) => row.daily.costUsd.map(microUsd));
  const tokens = folded.map((row, index) => seriesToken(row, index));
  const stackTotals = labels.map((_, index) =>
    mix.reduce((sum, values) => sum + (values[index] ?? 0), 0),
  );

  const spendMean = spend.length === 0 ? 0 : spend.reduce((sum, v) => sum + v, 0) / spend.length;
  const perInterviewMean =
    data.totals.interviews > 0 ? microUsd(data.totals.costUsd) / data.totals.interviews : 0;
  const grid = heatGrid(data.hourly);

  const comparable = dimension === 'provider' ? byProvider(data.models) : data.models;
  const available = comparable.map(seriesKey);
  const selected = (picked ?? available.slice(0, DEFAULT_COMPARE)).filter((key) =>
    available.includes(key),
  );
  const compared = selected
    .map((key) => comparable.find((row) => seriesKey(row) === key))
    .filter((row): row is AdminCostModel => row !== undefined);
  const compareSeries = compared.map((row) => valuesOf(row, measure));
  const tokenless =
    measure === 'tokens'
      ? compared.filter((row) => row.tokens === 0 && row.calls > 0)
      : [];

  function onDimension(next: Dimension) {
    setDimension(next);
    setPicked(null);
  }

  function onToggle(key: string) {
    const current = picked ?? available.slice(0, DEFAULT_COMPARE);
    if (current.includes(key)) {
      setPicked(current.filter((entry) => entry !== key));
      return;
    }
    if (current.length >= COMPARE_LIMIT) return;
    setPicked([...current, key]);
  }

  function body() {
    if (view === 'compare') {
      if (compared.length === 0) return null;
      const max = niceMax(Math.max(0, ...compareSeries.flat()));
      return (
        <Plot max={max} labels={labels} format={measure === 'cost' ? asUsd : asCount}>
          <MultiLineMarks
            series={compareSeries}
            max={max}
            styles={compared.map((_, index) => seriesStyle(index))}
            filled={type === 'area'}
          />
        </Plot>
      );
    }

    switch (type) {
      case 'line':
      case 'area':
      case 'columns': {
        const values = view === 'perDay' ? perInterview : spend;
        const mean = view === 'perDay' ? perInterviewMean : spendMean;
        const max = niceMax(Math.max(0, ...values));
        return (
          <Plot max={max} labels={labels}>
            {type === 'columns' ? (
              <ColumnMarks values={values} max={max} />
            ) : type === 'area' ? (
              <AreaMarks values={values} max={max} mean={mean} />
            ) : (
              <LineMarks values={values} max={max} mean={mean} />
            )}
          </Plot>
        );
      }
      case 'stackedArea':
      case 'stackedColumns': {
        const max = niceMax(Math.max(0, ...stackTotals));
        return (
          <>
            <Plot max={max} labels={labels}>
              {type === 'stackedArea' ? (
                <StackedAreaMarks series={mix} max={max} tokens={tokens} />
              ) : (
                <StackedColumnMarks series={mix} max={max} tokens={tokens} />
              )}
            </Plot>
            <ModelLegend models={folded} totalUsd={data.totals.costUsd} />
          </>
        );
      }
      case 'lines': {
        const max = niceMax(Math.max(0, ...mix.flat()));
        return (
          <>
            <Plot max={max} labels={labels}>
              <MultiLineMarks series={mix} max={max} styles={tokens.map(solid)} />
            </Plot>
            <ModelLegend models={folded} totalUsd={data.totals.costUsd} />
          </>
        );
      }
      case 'donut':
        return <ModelShare models={folded} totalUsd={data.totals.costUsd} />;
      case 'bars':
        return <ModelColumns models={folded} days={data.days} compare={false} />;
      case 'grouped':
        return <ModelColumns models={folded} days={data.days} compare />;
      default:
        return <SpendHeatmap grid={grid} />;
    }
  }

  function isEmpty() {
    if (view === 'trend') return spend.every((value) => value === 0);
    if (view === 'perDay') return perInterview.every((value) => value === 0);
    if (view === 'hours') return grid.max <= 0;
    if (view === 'compare')
      return compared.length > 0 && compareSeries.flat().every((value) => value === 0);
    if (data.models.length === 0) return true;
    if (view === 'delta')
      return folded.every(
        (row) => microUsd(row.costUsd) === 0 && microUsd(row.previousCostUsd) === 0,
      );
    if (view === 'share') return folded.every((row) => microUsd(row.costUsd) === 0);
    return mix.flat().every((value) => value === 0);
  }

  function caption() {
    if (view === 'compare' && compared.length === 0) return t('costs.seriesEmpty');
    if (isEmpty()) return t('costs.noSpendRange');

    switch (view) {
      case 'trend':
        return t('costs.trendCaption', {
          from: data.from,
          to: data.to,
          mean: usd(spendMean),
          last: usd(spend.at(-1) ?? 0),
        });
      case 'perDay':
        return t('costs.perDayCaption', {
          from: data.from,
          to: data.to,
          mean: usd(perInterviewMean),
        });
      case 'mix':
        return t('costs.mixCaption', { from: data.from, to: data.to });
      case 'compare':
        return t('costs.compareCaption', {
          from: data.from,
          to: data.to,
          count: compared.length,
          measure: t(MEASURE_LABEL[measure]),
        });
      case 'share':
        return t('costs.shareCaption', { total: data.totals.costUsd });
      case 'delta':
        return t('costs.deltaCaption', { days: data.days });
      default:
        return grid.max <= 0
          ? t('costs.noSpendRange')
          : t('costs.heatCaption', {
              day: t(`costs.weekday${grid.peakDow}`),
              hour: pad(grid.peakHour),
              cost: usd(grid.max),
            });
    }
  }

  return (
    <figure className={styles.card} data-testid="admin-cost-panel">
      <div className={styles.controls}>
        <label className={styles.control}>
          <span className={styles.controlLabel}>{t('costs.view')}</span>
          <Select
            data-testid="admin-cost-view"
            value={view}
            onChange={(event) => setView(event.target.value as ViewId)}
          >
            {VIEWS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t(entry.title)}
              </option>
            ))}
          </Select>
        </label>

        {active.types.length > 1 ? (
          <label className={styles.control}>
            <span className={styles.controlLabel}>{t('costs.type')}</span>
            <Select
              data-testid="admin-cost-type"
              value={type}
              onChange={(event) =>
                setChosen((all) => ({ ...all, [view]: event.target.value as TypeId }))
              }
            >
              {active.types.map((option) => (
                <option key={option} value={option}>
                  {t(TYPE_LABEL[option])}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        {view === 'compare' ? (
          <>
            <label className={styles.control}>
              <span className={styles.controlLabel}>{t('costs.by')}</span>
              <Select
                data-testid="admin-cost-by"
                value={dimension}
                onChange={(event) => onDimension(event.target.value as Dimension)}
              >
                {DIMENSIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(DIMENSION_LABEL[option])}
                  </option>
                ))}
              </Select>
            </label>

            <label className={styles.control}>
              <span className={styles.controlLabel}>{t('costs.measure')}</span>
              <Select
                data-testid="admin-cost-measure"
                value={measure}
                onChange={(event) => setMeasure(event.target.value as Measure)}
              >
                {MEASURES.map((option) => (
                  <option key={option} value={option}>
                    {t(MEASURE_LABEL[option])}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : null}

        <div className={styles.range} role="group" aria-label={t('costs.range')}>
          <span className={styles.rangeLabel}>{t('costs.range')}</span>
          {COST_RANGES.map((option) => (
            <button
              className={styles.rangeButton}
              key={option}
              type="button"
              aria-pressed={option === days}
              data-testid={`admin-cost-range-${option}`}
              onClick={() => onDaysChange(option)}
            >
              {t('costs.rangeOption', { days: option })}
            </button>
          ))}
        </div>
      </div>

      {view === 'compare' ? (
        <SeriesPicker models={comparable} chosen={selected} onToggle={onToggle} />
      ) : null}

      {view === 'compare' && tokenless.length > 0 ? (
        <p className={styles.pickerNote} data-testid="admin-cost-tokenless">
          {t('costs.tokenlessNote', {
            models: tokenless.map((row) => seriesLabel(row, t('costs.otherModels'))).join(', '),
          })}
        </p>
      ) : null}

      {view === 'compare' && data.truncated > 0 ? (
        <p className={styles.pickerNote}>{t('costs.truncatedNote', { count: data.truncated })}</p>
      ) : null}

      {body()}

      <figcaption className={styles.caption}>{caption()}</figcaption>
    </figure>
  );
}
