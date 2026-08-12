import type { AdminCostModel } from '../../../lib/query';
import { microUsd } from '../interview-table';

export type SeriesToken = 's1' | 's2' | 's3' | 'sOther';

const TOKENS: SeriesToken[] = ['s1', 's2', 's3'];

export function isOther(row: Pick<AdminCostModel, 'provider'>): boolean {
  return row.provider === null;
}

export function seriesToken(row: Pick<AdminCostModel, 'provider'>, index: number): SeriesToken {
  return isOther(row) ? 'sOther' : (TOKENS[index] ?? 'sOther');
}

export function seriesKey(row: Pick<AdminCostModel, 'provider' | 'model'>): string {
  return row.provider === null ? 'other' : `${row.provider}:${row.model}`;
}

export function seriesLabel(row: Pick<AdminCostModel, 'provider' | 'model'>, otherLabel: string): string {
  return row.provider === null ? otherLabel : `${row.provider} · ${row.model}`;
}

export function seriesShare(row: AdminCostModel, totalUsd: string): number {
  const total = microUsd(totalUsd);
  return total === 0 ? 0 : microUsd(row.costUsd) / total;
}

export function seriesDelta(row: AdminCostModel): number | null {
  const previous = microUsd(row.previousCostUsd);
  if (previous === 0) return null;
  return (microUsd(row.costUsd) - previous) / previous;
}
