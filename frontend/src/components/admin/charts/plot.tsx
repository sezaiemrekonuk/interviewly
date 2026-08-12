'use client';

import type { ReactNode } from 'react';

import { sparkPoints } from '../../dashboard/summary';

import styles from './charts.module.css';
import { bands, labelledIndexes, stackBands, tickValues } from './geometry';
import { FILL_CLASS, STROKE_CLASS, type SeriesStyle, type SeriesToken } from './series';

const GUTTER = 64;
const TOP = 12;
const WIDTH = 880;
const HEIGHT = 220;
const FOOT = 28;
const TICKS = 4;
const DATE_LABELS = 4;
const COLUMN_GAP = 2;
const DOT = 4;
const LABEL_DY = 20;
const TICK_DY = 4;
const TICK_DX = 8;
const RADIUS = 2;

export const AREA = { width: WIDTH, height: HEIGHT };

export const asUsd = (micro: number) => (micro / 1_000_000).toFixed(4);

export const asCount = (value: number) => String(Math.round(value));

const topOf = (value: number, max: number) =>
  HEIGHT - (Math.min(Math.max(value, 0), max) / max) * HEIGHT;

const pointX = (index: number, count: number) =>
  count <= 1 ? WIDTH / 2 : (index * WIDTH) / (count - 1);

export function Plot({
  max,
  labels,
  format = asUsd,
  children,
}: {
  max: number;
  labels: string[];
  format?: (value: number) => string;
  children: ReactNode;
}) {
  const baseline = TOP + HEIGHT;

  return (
    <div className={styles.scroller}>
      <svg
        className={styles.plot}
        width={GUTTER + WIDTH + TICK_DX}
        height={TOP + HEIGHT + FOOT}
        aria-hidden="true"
        focusable="false"
      >
        {tickValues(max, TICKS).map((tick) => {
          const y = baseline - (tick / max) * HEIGHT;
          return (
            <g key={tick}>
              <line className={styles.grid} x1={GUTTER} x2={GUTTER + WIDTH} y1={y} y2={y} />
              <text className={styles.tick} x={GUTTER - TICK_DX} y={y + TICK_DY} textAnchor="end">
                {format(tick)}
              </text>
            </g>
          );
        })}

        <g transform={`translate(${GUTTER},${TOP})`}>{children}</g>

        <line
          className={styles.axis}
          x1={GUTTER}
          x2={GUTTER + WIDTH}
          y1={baseline}
          y2={baseline}
        />
        <line className={styles.axis} x1={GUTTER} x2={GUTTER} y1={TOP} y2={baseline} />

        {labelledIndexes(labels.length, DATE_LABELS).map((index, position, shown) => (
          <text
            className={styles.tick}
            key={labels[index]}
            x={GUTTER + pointX(index, labels.length)}
            y={baseline + LABEL_DY}
            textAnchor={
              position === 0 ? 'start' : position === shown.length - 1 ? 'end' : 'middle'
            }
          >
            {labels[index]}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function LineMarks({ values, max, mean }: { values: number[]; max: number; mean: number }) {
  const points = sparkPoints(values, { width: WIDTH, height: HEIGHT, max });
  const last = points.split(' ').at(-1)?.split(',');
  const meanY = topOf(mean, max);

  return (
    <>
      <line
        className={styles.mean}
        x1={0}
        x2={WIDTH}
        y1={meanY}
        y2={meanY}
        strokeDasharray="4 4"
      />
      <polyline
        className={styles.line}
        points={points}
        vectorEffect="non-scaling-stroke"
      />
      {last ? <circle className={styles.point} cx={Number(last[0])} cy={Number(last[1])} r={DOT} /> : null}
    </>
  );
}

export function AreaMarks({ values, max, mean }: { values: number[]; max: number; mean: number }) {
  const [polygon] = stackBands([values], AREA, max);

  return (
    <>
      {polygon ? <polygon className={styles.areaFill} points={polygon} /> : null}
      <LineMarks values={values} max={max} mean={mean} />
    </>
  );
}

export function ColumnMarks({ values, max }: { values: number[]; max: number }) {
  return (
    <>
      {bands(values.length, WIDTH, COLUMN_GAP).map((band, index) => {
        const top = topOf(values[index] ?? 0, max);
        return (
          <rect
            className={styles.column}
            key={index}
            x={band.x}
            y={top}
            width={band.width}
            height={HEIGHT - top}
            rx={RADIUS}
          />
        );
      })}
    </>
  );
}

export function StackedAreaMarks({
  series,
  max,
  tokens,
}: {
  series: number[][];
  max: number;
  tokens: SeriesToken[];
}) {
  return (
    <>
      {stackBands(series, AREA, max).map((points, index) =>
        points ? (
          <polygon
            className={`${styles.band} ${styles[tokens[index]]}`}
            key={`${tokens[index]}-${index}`}
            points={points}
          />
        ) : null,
      )}
    </>
  );
}

export function StackedColumnMarks({
  series,
  max,
  tokens,
}: {
  series: number[][];
  max: number;
  tokens: SeriesToken[];
}) {
  const count = series[0]?.length ?? 0;
  const laid = bands(count, WIDTH, COLUMN_GAP);
  const running = new Array<number>(count).fill(0);
  const rects: ReactNode[] = [];

  series.forEach((values, depth) => {
    for (let index = 0; index < count; index += 1) {
      const from = running[index];
      const to = from + (values[index] ?? 0);
      running[index] = to;
      if (to <= from) continue;
      const top = topOf(to, max);
      rects.push(
        <rect
          className={`${styles.band} ${styles[tokens[depth]]}`}
          key={`${depth}-${index}`}
          x={laid[index].x}
          y={top}
          width={laid[index].width}
          height={topOf(from, max) - top}
        />,
      );
    }
  });

  return <>{rects}</>;
}

export function MultiLineMarks({
  series,
  max,
  styles: sequence,
  filled,
}: {
  series: number[][];
  max: number;
  styles: SeriesStyle[];
  filled?: boolean;
}) {
  return (
    <>
      {filled
        ? series.map((values, index) => {
            const [polygon] = stackBands([values], AREA, max);
            return polygon ? (
              <polygon
                className={styles[FILL_CLASS[sequence[index].token]]}
                key={`fill-${index}`}
                points={polygon}
              />
            ) : null;
          })
        : null}
      {series.map((values, index) => (
        <polyline
          className={[
            styles.seriesLine,
            styles[STROKE_CLASS[sequence[index].token]],
            sequence[index].dashed ? styles.dashed : '',
          ]
            .filter(Boolean)
            .join(' ')}
          key={`line-${index}`}
          points={sparkPoints(values, { width: WIDTH, height: HEIGHT, max })}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}
