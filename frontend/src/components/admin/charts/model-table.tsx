'use client';

import { useFormatter, useTranslations } from 'next-intl';

import type { AdminCostsResponse } from '../../../lib/query';
import { sparkPoints } from '../../dashboard/summary';
import { microUsd } from '../interview-table';
import tableStyles from '../table.module.css';

import styles from './charts.module.css';
import { seriesKey, seriesLabel, seriesShare, seriesToken } from './series';

export function ModelTable({ data }: { data: AdminCostsResponse }) {
  const t = useTranslations('admin');
  const format = useFormatter();

  const percent = (value: number) =>
    format.number(value, { style: 'percent', maximumFractionDigits: 0 });

  const SPARK = {
    width: 96,
    height: 24,
    max: Math.max(1, ...data.models.flatMap((row) => row.daily.costUsd.map(microUsd))),
  };

  return (
    <section className={tableStyles.card} aria-labelledby="admin-cost-models-heading">
      <div className={tableStyles.head}>
        <h3 className={tableStyles.heading} id="admin-cost-models-heading">
          {t('costs.modelsTitle')}
        </h3>
        <p className={tableStyles.note}>{t('costs.modelsNote')}</p>
      </div>

      {data.models.length === 0 ? (
        <p className={tableStyles.empty}>{t('costs.noSpendRange')}</p>
      ) : (
        <div className={tableStyles.scroller}>
          <table className={tableStyles.table}>
            <caption className={tableStyles.caption}>{t('costs.modelsTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('costs.colModel')}</th>
                <th scope="col" className={tableStyles.num}>
                  {t('costs.colCost')}
                </th>
                <th scope="col" className={tableStyles.num}>
                  {t('costs.colShare')}
                </th>
                <th scope="col" className={tableStyles.num}>
                  {t('costs.colCalls')}
                </th>
                <th scope="col" className={tableStyles.num}>
                  {t('costs.colTokens')}
                </th>
                <th scope="col" className={tableStyles.num}>
                  {t('costs.colLatency')}
                </th>
                <th scope="col">{t('costs.colTrend')}</th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((row, index) => {
                const model = seriesLabel(row, t('costs.otherModels'));
                return (
                  <tr key={seriesKey(row)}>
                    <td>
                      <span className={styles.swatchCell}>
                        <span className={styles.swatch} data-series={seriesToken(row, index)} />
                        {model}
                      </span>
                    </td>
                    <td className={`${tableStyles.num} tabular`}>{row.costUsd}</td>
                    <td className={`${tableStyles.num} tabular`}>
                      {percent(seriesShare(row, data.totals.costUsd))}
                    </td>
                    <td className={`${tableStyles.num} tabular`}>{format.number(row.calls)}</td>
                    <td className={`${tableStyles.num} tabular`}>{format.number(row.tokens)}</td>
                    <td className={`${tableStyles.num} tabular`}>
                      {format.number(row.averageLatencyMs)}
                    </td>
                    <td>
                      <svg
                        className={styles.spark}
                        width={SPARK.width}
                        height={SPARK.height}
                        aria-hidden="true"
                        focusable="false"
                      >
                        <polyline points={sparkPoints(row.daily.costUsd.map(microUsd), SPARK)} />
                      </svg>
                      <span className={tableStyles.caption}>
                        {t('costs.sparkNote', { model })}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>{t('costs.currentRange')}</td>
                <td className={`${tableStyles.num} tabular`}>{data.totals.costUsd}</td>
                <td className={`${tableStyles.num} tabular`}>{percent(1)}</td>
                <td className={`${tableStyles.num} tabular`}>{format.number(data.totals.calls)}</td>
                <td className={`${tableStyles.num} tabular`}>
                  {format.number(data.totals.tokens)}
                </td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
