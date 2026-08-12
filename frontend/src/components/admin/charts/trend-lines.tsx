'use client';

import { useTranslations } from 'next-intl';

import type { AdminCostsResponse } from '../../../lib/query';
import { sparkPoints } from '../../dashboard/summary';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';
import { labelledIndexes, niceMax, tickValues } from './geometry';

const GUTTER = 64;
const TOP = 12;
const PLOT_W = 600;
const PLOT_H = 176;
const FOOT = 28;
const RIGHT = 8;
const WIDTH = GUTTER + PLOT_W + RIGHT;
const HEIGHT = TOP + PLOT_H + FOOT;
const TICKS = 4;
const DATE_LABELS = 4;
const TICK_GAP = 8;
const TICK_RISE = 4;
const DATE_DROP = 18;
const DOT = 4;

const MICRO = 1_000_000;

const usd = (micro: number) => (micro / MICRO).toFixed(6);
const usdTick = (micro: number) => (micro / MICRO).toFixed(4);
const monthDay = (iso: string) => iso.slice(5, 10);

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function anchorFor(order: number, count: number): 'start' | 'middle' | 'end' {
  if (order === 0) return 'start';
  if (order === count - 1) return 'end';
  return 'middle';
}

function TrendLine({
  title,
  caption,
  empty,
  values,
  buckets,
  mean,
}: {
  title: string;
  caption: string;
  empty: string | null;
  values: number[];
  buckets: string[];
  mean: number;
}) {
  const max = niceMax(Math.max(0, ...values));
  const y = (value: number) => PLOT_H - (Math.min(Math.max(value, 0), max) / max) * PLOT_H;
  const xOf = (index: number) =>
    buckets.length > 1 ? (index * PLOT_W) / (buckets.length - 1) : PLOT_W / 2;

  const points = sparkPoints(values, { width: PLOT_W, height: PLOT_H, max });
  const vertices = points === '' ? [] : points.split(' ');
  const tail = vertices[vertices.length - 1]?.split(',').map(Number) ?? [];
  const dates = labelledIndexes(buckets.length, DATE_LABELS);

  return (
    <figure className={styles.card}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.scroller}>
        <svg
          className={styles.plot}
          width={WIDTH}
          height={HEIGHT}
          aria-hidden="true"
          focusable="false"
        >
          {tickValues(max, TICKS).map((tick) => (
            <g key={tick}>
              <line
                className={styles.grid}
                x1={GUTTER}
                x2={GUTTER + PLOT_W}
                y1={TOP + y(tick)}
                y2={TOP + y(tick)}
              />
              <text
                className={styles.tick}
                x={GUTTER - TICK_GAP}
                y={TOP + y(tick) + TICK_RISE}
                textAnchor="end"
              >
                {usdTick(tick)}
              </text>
            </g>
          ))}
          <line className={styles.axis} x1={GUTTER} x2={GUTTER} y1={TOP} y2={TOP + PLOT_H} />
          <line
            className={styles.axis}
            x1={GUTTER}
            x2={GUTTER + PLOT_W}
            y1={TOP + PLOT_H}
            y2={TOP + PLOT_H}
          />
          <g transform={`translate(${GUTTER},${TOP})`}>
            <line
              className={styles.mean}
              x1={0}
              x2={PLOT_W}
              y1={y(mean)}
              y2={y(mean)}
              strokeDasharray="4 4"
            />
            <polyline
              className={styles.line}
              points={points}
              vectorEffect="non-scaling-stroke"
            />
            {tail.length === 2 ? (
              <circle className={styles.point} cx={tail[0]} cy={tail[1]} r={DOT} />
            ) : null}
          </g>
          {dates.map((index, order) => (
            <text
              key={buckets[index]}
              className={styles.tick}
              x={GUTTER + xOf(index)}
              y={TOP + PLOT_H + DATE_DROP}
              textAnchor={anchorFor(order, dates.length)}
            >
              {monthDay(buckets[index])}
            </text>
          ))}
        </svg>
      </div>
      {empty === null ? null : <p className={styles.empty}>{empty}</p>}
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}

export function SpendTrend({ data }: { data: AdminCostsResponse }) {
  const t = useTranslations('admin');
  const values = data.daily.costUsd.map(microUsd);
  const mean = average(values);

  return (
    <TrendLine
      title={t('costs.trendTitle')}
      caption={t('costs.trendCaption', {
        from: data.from,
        to: data.to,
        mean: usd(mean),
        last: usd(values.at(-1) ?? 0),
      })}
      empty={values.every((value) => value === 0) ? t('costs.noSpendRange') : null}
      values={values}
      buckets={data.buckets}
      mean={mean}
    />
  );
}

export function PerInterviewTrend({ data }: { data: AdminCostsResponse }) {
  const t = useTranslations('admin');
  const values = data.daily.costUsd.map((costUsd, index) => {
    const interviews = data.daily.interviews[index] ?? 0;
    return interviews > 0 ? microUsd(costUsd) / interviews : 0;
  });
  const mean =
    data.totals.interviews > 0 ? microUsd(data.totals.costUsd) / data.totals.interviews : 0;

  return (
    <TrendLine
      title={t('costs.perDayTitle')}
      caption={t('costs.perDayCaption', { from: data.from, to: data.to, mean: usd(mean) })}
      empty={values.every((value) => value === 0) ? t('costs.noSpendRange') : null}
      values={values}
      buckets={data.buckets}
      mean={mean}
    />
  );
}
