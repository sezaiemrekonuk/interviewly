import type { AdminCostDaily, AdminCostModel } from '../../../lib/query';
import { microUsd } from '../interview-table';

export const CHART_SERIES_LIMIT = 3;

const usd = (micro: number) => (micro / 1_000_000).toFixed(6);

function emptyDaily(length: number): AdminCostDaily {
  return {
    costUsd: Array.from({ length }, () => '0.000000'),
    calls: new Array<number>(length).fill(0),
    tokens: new Array<number>(length).fill(0),
    latencyMs: new Array<number>(length).fill(0),
  };
}

function combine(rows: AdminCostModel[], provider: string | null, model: string | null): AdminCostModel {
  const length = rows[0]?.daily.costUsd.length ?? 0;
  const cost = new Array<number>(length).fill(0);
  const calls = new Array<number>(length).fill(0);
  const tokens = new Array<number>(length).fill(0);
  const latencySum = new Array<number>(length).fill(0);

  for (const row of rows) {
    for (let index = 0; index < length; index += 1) {
      cost[index] += microUsd(row.daily.costUsd[index] ?? '0');
      const dayCalls = row.daily.calls[index] ?? 0;
      calls[index] += dayCalls;
      tokens[index] += row.daily.tokens[index] ?? 0;
      latencySum[index] += (row.daily.latencyMs[index] ?? 0) * dayCalls;
    }
  }

  const totalCalls = rows.reduce((sum, row) => sum + row.calls, 0);
  const weightedLatency = rows.reduce((sum, row) => sum + row.averageLatencyMs * row.calls, 0);

  return {
    provider,
    model,
    costUsd: usd(rows.reduce((sum, row) => sum + microUsd(row.costUsd), 0)),
    previousCostUsd: usd(rows.reduce((sum, row) => sum + microUsd(row.previousCostUsd), 0)),
    calls: totalCalls,
    tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
    averageLatencyMs: totalCalls === 0 ? 0 : Math.round(weightedLatency / totalCalls),
    daily: {
      costUsd: cost.map(usd),
      calls,
      tokens,
      latencyMs: latencySum.map((sum, index) =>
        calls[index] === 0 ? 0 : Math.round(sum / calls[index]),
      ),
    },
  };
}

export function foldTop(models: AdminCostModel[], limit = CHART_SERIES_LIMIT): AdminCostModel[] {
  if (models.length <= limit) return models;
  const kept = models.slice(0, limit);
  return [...kept, combine(models.slice(limit), null, null)];
}

export function byProvider(models: AdminCostModel[]): AdminCostModel[] {
  const grouped = new Map<string, AdminCostModel[]>();
  for (const row of models) {
    const key = row.provider ?? '';
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.entries()]
    .map(([provider, rows]) => combine(rows, provider, null))
    .sort(
      (a, b) =>
        microUsd(b.costUsd) - microUsd(a.costUsd) ||
        (a.provider ?? '').localeCompare(b.provider ?? ''),
    );
}

export function zeroModel(length: number, provider: string, model: string | null): AdminCostModel {
  return {
    provider,
    model,
    costUsd: '0.000000',
    previousCostUsd: '0.000000',
    calls: 0,
    tokens: 0,
    averageLatencyMs: 0,
    daily: emptyDaily(length),
  };
}
