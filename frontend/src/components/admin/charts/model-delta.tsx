'use client';

import { useTranslations } from 'next-intl';

import type { AdminCostsResponse } from '../../../lib/query';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';
import { bands, niceMax, tickValues } from './geometry';
import { seriesDelta, seriesLabel, seriesToken } from './series';

const GUTTER = 64;
const TOP = 20;
const PLOT_H = 168;
const FOOT = 44;
const GROUP_GAP = 24;
const BAR_GAP = 4;
const GROUP_W = 132;
const TICKS = 4;
const LABEL_LIMIT = 18;
const MIN_PLOT_W = 240;

const usd = (micro: number) => (micro / 1_000_000).toFixed(4);

function truncateLabel(label: string): string {
  return label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label;
}

export function ModelDelta({ data }: { data: AdminCostsResponse }) {
  const t = useTranslations('admin');
  const { models } = data;

  const plotWidth = Math.max(
    MIN_PLOT_W,
    models.length * GROUP_W + Math.max(0, models.length - 1) * GROUP_GAP,
  );
  const width = GUTTER + plotWidth + 8;
  const height = TOP + PLOT_H + FOOT;
  const baseline = TOP + PLOT_H;

  const values = models.flatMap((row) => [microUsd(row.costUsd), microUsd(row.previousCostUsd)]);
  const isEmpty = models.length === 0 || values.every((value) => value === 0);
  const max = niceMax(Math.max(0, ...values));
  const heightOf = (micro: number) => (max <= 0 ? 0 : (micro / max) * PLOT_H);

  const groups = bands(models.length, plotWidth, GROUP_GAP);

  return (
    <figure className={styles.card}>
      <h3 className={styles.title}>{t('costs.deltaTitle')}</h3>

      <div className={styles.scroller}>
        <svg className={styles.plot} width={width} height={height} aria-hidden="true" focusable="false">
          {tickValues(max, TICKS).map((tick) => {
            const y = baseline - heightOf(tick);
            return (
              <g key={tick}>
                <line className={styles.grid} x1={GUTTER} x2={GUTTER + plotWidth} y1={y} y2={y} />
                <text className={styles.tick} x={GUTTER - 8} y={y + 4} textAnchor="end">
                  {usd(tick)}
                </text>
              </g>
            );
          })}

          {models.map((row, index) => {
            const group = groups[index];
            const columns = bands(2, group.width, BAR_GAP);
            const currentMicro = microUsd(row.costUsd);
            const previousMicro = microUsd(row.previousCostUsd);
            const currentHeight = heightOf(currentMicro);
            const previousHeight = heightOf(previousMicro);
            const token = seriesToken(row, index);
            const delta = seriesDelta(row);
            const deltaText =
              delta === null
                ? t('costs.deltaNew')
                : delta >= 0
                  ? t('costs.deltaUp', { percent: Math.round(Math.abs(delta) * 100) })
                  : t('costs.deltaDown', { percent: Math.round(Math.abs(delta) * 100) });
            const label = truncateLabel(seriesLabel(row, t('costs.otherModels')));
            const groupX = GUTTER + group.x;
            const groupCenter = groupX + group.width / 2;

            return (
              <g key={`${row.provider ?? 'other'}:${row.model ?? index}`}>
                <rect
                  className={styles[token]}
                  x={groupX + columns[0].x}
                  y={baseline - currentHeight}
                  width={columns[0].width}
                  height={currentHeight}
                  rx={2}
                />
                <text
                  className={styles.value}
                  x={groupX + columns[0].x + columns[0].width / 2}
                  y={baseline - currentHeight - 6}
                  textAnchor="middle"
                >
                  {usd(currentMicro)}
                </text>
                <rect
                  className={styles.priorBar}
                  x={groupX + columns[1].x}
                  y={baseline - previousHeight}
                  width={columns[1].width}
                  height={previousHeight}
                  rx={2}
                />
                <text className={styles.axisLabel} x={groupCenter} y={baseline + 18} textAnchor="middle">
                  {label}
                </text>
                <text className={styles.axisLabel} x={groupCenter} y={baseline + 34} textAnchor="middle">
                  {deltaText}
                </text>
              </g>
            );
          })}

          <line className={styles.axis} x1={GUTTER} x2={GUTTER + plotWidth} y1={baseline} y2={baseline} />
          <line className={styles.axis} x1={GUTTER} x2={GUTTER} y1={TOP} y2={baseline} />
        </svg>
      </div>

      {isEmpty ? <p className={styles.empty}>{t('costs.noSpendRange')}</p> : null}

      <ul className={styles.legend}>
        <li className={styles.legendRow}>
          <span />
          <span className={styles.legendLabel}>{t('costs.currentRange')}</span>
          <span />
        </li>
        <li className={styles.legendRow}>
          <span className={styles.swatch} data-series="sOther" />
          <span className={styles.legendLabel}>{t('costs.previousRange', { days: data.days })}</span>
          <span />
        </li>
      </ul>

      <figcaption className={styles.caption}>{t('costs.deltaCaption', { days: data.days })}</figcaption>
    </figure>
  );
}
