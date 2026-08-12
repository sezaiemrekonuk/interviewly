'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { COST_RANGES, type AdminCostsResponse, type CostRange } from '../../../lib/query';
import { Select } from '../../ui';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';
import { niceMax } from './geometry';
import { ModelColumns } from './model-columns';
import { ModelLegend } from './model-legend';
import { ModelShare } from './model-share';
import {
  AreaMarks,
  ColumnMarks,
  LineMarks,
  MultiLineMarks,
  Plot,
  StackedAreaMarks,
  StackedColumnMarks,
} from './plot';
import { seriesToken } from './series';
import { heatGrid, pad, SpendHeatmap } from './spend-heatmap';

type ViewId = 'trend' | 'perDay' | 'mix' | 'share' | 'delta' | 'hours';

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

const VIEWS: { id: ViewId; title: string; types: TypeId[] }[] = [
  { id: 'trend', title: 'costs.trendTitle', types: ['line', 'area', 'columns'] },
  { id: 'perDay', title: 'costs.perDayTitle', types: ['line', 'columns'] },
  { id: 'mix', title: 'costs.mixTitle', types: ['stackedArea', 'stackedColumns', 'lines'] },
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

const DEFAULTS = Object.fromEntries(VIEWS.map((view) => [view.id, view.types[0]])) as Record<
  ViewId,
  TypeId
>;

const usd = (micro: number) => (micro / 1_000_000).toFixed(6);

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

  const active = VIEWS.find((entry) => entry.id === view) ?? VIEWS[0];
  const type = chosen[view];

  const labels = data.buckets.map((bucket) => bucket.slice(5));
  const spend = data.daily.costUsd.map(microUsd);
  const perInterview = data.daily.costUsd.map((cost, index) =>
    data.daily.interviews[index] > 0 ? microUsd(cost) / data.daily.interviews[index] : 0,
  );
  const mix = data.models.map((row) => row.daily.map(microUsd));
  const tokens = data.models.map((row, index) => seriesToken(row, index));
  const stackTotals = labels.map((_, index) =>
    mix.reduce((sum, values) => sum + (values[index] ?? 0), 0),
  );

  const spendMean = spend.length === 0 ? 0 : spend.reduce((sum, v) => sum + v, 0) / spend.length;
  const perInterviewMean =
    data.totals.interviews > 0 ? microUsd(data.totals.costUsd) / data.totals.interviews : 0;
  const grid = heatGrid(data.hourly);

  function body() {
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
            <ModelLegend data={data} />
          </>
        );
      }
      case 'lines': {
        const max = niceMax(Math.max(0, ...mix.flat()));
        return (
          <>
            <Plot max={max} labels={labels}>
              <MultiLineMarks series={mix} max={max} tokens={tokens} />
            </Plot>
            <ModelLegend data={data} />
          </>
        );
      }
      case 'donut':
        return <ModelShare data={data} />;
      case 'bars':
        return <ModelColumns data={data} compare={false} />;
      case 'grouped':
        return <ModelColumns data={data} compare />;
      default:
        return <SpendHeatmap grid={grid} />;
    }
  }

  function isEmpty() {
    if (view === 'trend') return spend.every((value) => value === 0);
    if (view === 'perDay') return perInterview.every((value) => value === 0);
    if (view === 'hours') return grid.max <= 0;
    if (data.models.length === 0) return true;
    if (view === 'delta')
      return data.models.every(
        (row) => microUsd(row.costUsd) === 0 && microUsd(row.previousCostUsd) === 0,
      );
    if (view === 'share') return data.models.every((row) => microUsd(row.costUsd) === 0);
    return mix.flat().every((value) => value === 0);
  }

  function caption() {
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

      {body()}

      <figcaption className={styles.caption}>{caption()}</figcaption>
    </figure>
  );
}
