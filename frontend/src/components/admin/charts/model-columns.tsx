'use client';

import { useTranslations } from 'next-intl';

import type { AdminCostsResponse } from '../../../lib/query';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';
import { bands, niceMax, tickValues } from './geometry';
import { seriesDelta, seriesKey, seriesLabel, seriesToken } from './series';

const GUTTER = 64;
const TOP = 20;
const PLOT_H = 168;
const FOOT = 44;
const GROUP_GAP = 24;
const BAR_GAP = 4;
const GROUP_W = 168;
const SOLO_W = 120;
const TICKS = 4;
const LABEL_LIMIT = 18;
const MIN_PLOT_W = 240;
const TICK_DX = 8;
const TICK_DY = 4;
const VALUE_DY = 6;
const NAME_DY = 18;
const DELTA_DY = 34;
const RADIUS = 2;

const usd = (micro: number) => (micro / 1_000_000).toFixed(4);

const truncate = (label: string) =>
  label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label;

export function ModelColumns({
  data,
  compare,
}: {
  data: AdminCostsResponse;
  compare: boolean;
}) {
  const t = useTranslations('admin');
  const { models } = data;

  const groupWidth = compare ? GROUP_W : SOLO_W;
  const plotWidth = Math.max(
    MIN_PLOT_W,
    models.length * groupWidth + Math.max(0, models.length - 1) * GROUP_GAP,
  );
  const baseline = TOP + PLOT_H;

  const values = models.flatMap((row) =>
    compare ? [microUsd(row.costUsd), microUsd(row.previousCostUsd)] : [microUsd(row.costUsd)],
  );
  const max = niceMax(Math.max(0, ...values));
  const heightOf = (micro: number) => (micro / max) * PLOT_H;

  const groups = bands(models.length, plotWidth, GROUP_GAP);

  return (
    <>
      <div className={styles.scroller}>
        <svg
          className={styles.plot}
          width={GUTTER + plotWidth + TICK_DX}
          height={TOP + PLOT_H + FOOT}
          aria-hidden="true"
          focusable="false"
        >
          {tickValues(max, TICKS).map((tick) => {
            const y = baseline - heightOf(tick);
            return (
              <g key={tick}>
                <line className={styles.grid} x1={GUTTER} x2={GUTTER + plotWidth} y1={y} y2={y} />
                <text className={styles.tick} x={GUTTER - TICK_DX} y={y + TICK_DY} textAnchor="end">
                  {usd(tick)}
                </text>
              </g>
            );
          })}

          {models.map((row, index) => {
            const group = groups[index];
            const columns = bands(compare ? 2 : 1, group.width, BAR_GAP);
            const current = microUsd(row.costUsd);
            const previous = microUsd(row.previousCostUsd);
            const delta = seriesDelta(row);
            const centre = GUTTER + group.x + group.width / 2;
            const currentX = GUTTER + group.x + columns[0].x;

            return (
              <g key={seriesKey(row)}>
                <rect
                  className={styles[seriesToken(row, index)]}
                  x={currentX}
                  y={baseline - heightOf(current)}
                  width={columns[0].width}
                  height={heightOf(current)}
                  rx={RADIUS}
                />
                {compare ? (
                  <rect
                    className={styles.priorBar}
                    x={GUTTER + group.x + columns[1].x}
                    y={baseline - heightOf(previous)}
                    width={columns[1].width}
                    height={heightOf(previous)}
                    rx={RADIUS}
                  />
                ) : null}
                <text
                  className={styles.value}
                  x={currentX + columns[0].width / 2}
                  y={baseline - heightOf(current) - VALUE_DY}
                  textAnchor="middle"
                >
                  {usd(current)}
                </text>
                <text className={styles.axisLabel} x={centre} y={baseline + NAME_DY} textAnchor="middle">
                  {truncate(seriesLabel(row, t('costs.otherModels')))}
                </text>
                {compare ? (
                  <text
                    className={styles.axisLabel}
                    x={centre}
                    y={baseline + DELTA_DY}
                    textAnchor="middle"
                  >
                    {delta === null
                      ? t('costs.deltaNew')
                      : delta >= 0
                        ? t('costs.deltaUp', { percent: Math.round(delta * 100) })
                        : t('costs.deltaDown', { percent: Math.round(Math.abs(delta) * 100) })}
                  </text>
                ) : null}
              </g>
            );
          })}

          <line className={styles.axis} x1={GUTTER} x2={GUTTER + plotWidth} y1={baseline} y2={baseline} />
          <line className={styles.axis} x1={GUTTER} x2={GUTTER} y1={TOP} y2={baseline} />
        </svg>
      </div>

      {compare ? (
        <ul className={styles.legend}>
          <li className={styles.legendRow}>
            <span />
            <span className={styles.legendLabel}>{t('costs.currentRange')}</span>
            <span />
          </li>
          <li className={styles.legendRow}>
            <span className={styles.swatch} data-series="sOther" />
            <span className={styles.legendLabel}>
              {t('costs.previousRange', { days: data.days })}
            </span>
            <span />
          </li>
        </ul>
      ) : null}
    </>
  );
}
