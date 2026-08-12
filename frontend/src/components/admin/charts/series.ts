import type { AdminCostModel } from '../../../lib/query';
import { microUsd } from '../interview-table';

export type SeriesToken = 's1' | 's2' | 's3' | 'sOther';

const TOKENS: SeriesToken[] = ['s1', 's2', 's3'];

export const STROKE_CLASS: Record<SeriesToken, string> = {
  s1: 'stroke1',
  s2: 'stroke2',
  s3: 'stroke3',
  sOther: 'strokeOther',
};

export const FILL_CLASS: Record<SeriesToken, string> = {
  s1: 'fill1',
  s2: 'fill2',
  s3: 'fill3',
  sOther: 'fillOther',
};

export const ARC_CLASS: Record<SeriesToken, string> = {
  s1: 'arcS1',
  s2: 'arcS2',
  s3: 'arcS3',
  sOther: 'arcSOther',
};

export function isOther(row: Pick<AdminCostModel, 'provider'>): boolean {
  return row.provider === null;
}

export function seriesToken(row: Pick<AdminCostModel, 'provider'>, index: number): SeriesToken {
  return isOther(row) ? 'sOther' : (TOKENS[index] ?? 'sOther');
}

export function seriesKey(row: Pick<AdminCostModel, 'provider' | 'model'>): string {
  if (row.provider === null) return 'other';
  return row.model === null ? row.provider : `${row.provider}:${row.model}`;
}

export function seriesLabel(row: Pick<AdminCostModel, 'provider' | 'model'>, otherLabel: string): string {
  if (row.provider === null) return otherLabel;
  return row.model === null ? row.provider : `${row.provider} · ${row.model}`;
}

export const COMPARE_LIMIT = 6;

export interface SeriesStyle {
  token: SeriesToken;
  dashed: boolean;
}

export function seriesStyle(index: number): SeriesStyle {
  return { token: TOKENS[index % TOKENS.length] ?? 'sOther', dashed: index >= TOKENS.length };
}

export const solid = (token: SeriesToken): SeriesStyle => ({ token, dashed: false });

export function seriesShare(row: AdminCostModel, totalUsd: string): number {
  const total = microUsd(totalUsd);
  return total === 0 ? 0 : microUsd(row.costUsd) / total;
}

export function seriesDelta(row: AdminCostModel): number | null {
  const previous = microUsd(row.previousCostUsd);
  if (previous === 0) return null;
  return (microUsd(row.costUsd) - previous) / previous;
}
