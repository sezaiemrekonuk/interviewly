import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { MODEL_SERIES_LIMIT, dayKeys, foldModels, resolveDays } from './costs';

const row = (
  day: string,
  provider: string,
  model: string,
  cost: string,
  calls = 1,
  latencySum = 0,
  tokens = 0,
) => ({ day, provider, model, cost: new Prisma.Decimal(cost), tokens, calls, latencySum });

const prev = (provider: string, model: string, cost: string) => ({
  provider,
  model,
  cost: new Prisma.Decimal(cost),
});

const BUCKETS = ['2026-08-01', '2026-08-02', '2026-08-03'];

describe('resolveDays', () => {
  it('accepts the whitelist as numbers and as the query string form', () => {
    expect([resolveDays(7), resolveDays(30), resolveDays(90)]).toEqual([7, 30, 90]);
    expect([resolveDays('7'), resolveDays('30'), resolveDays('90')]).toEqual([7, 30, 90]);
  });

  it('falls back to 30 for anything off the whitelist', () => {
    for (const raw of [undefined, null, NaN, 'abc', '', 15, -1, 0, 1000, '7.5', true, {}]) {
      expect(resolveDays(raw)).toBe(30);
    }
  });

  it('falls back to 30 for a repeated query parameter rather than coercing the array', () => {
    expect(resolveDays(['7'])).toBe(30);
    expect(resolveDays(['7', '30'])).toBe(30);
    expect(resolveDays([])).toBe(30);
  });
});

describe('dayKeys', () => {
  it('returns exactly `days` ascending UTC keys ending at `to`', () => {
    const keys = dayKeys(new Date('2026-08-12T09:30:00.000Z'), 7);

    expect(keys).toHaveLength(7);
    expect(keys[keys.length - 1]).toBe('2026-08-12');
    expect(keys[0]).toBe('2026-08-06');
    expect([...keys].sort()).toEqual(keys);
  });

  it('reads the UTC date, not the local one, at either edge of the day', () => {
    expect(dayKeys(new Date('2026-08-12T00:00:00.000Z'), 1)).toEqual(['2026-08-12']);
    expect(dayKeys(new Date('2026-08-12T23:59:59.999Z'), 1)).toEqual(['2026-08-12']);
  });

  it('does not drift across a month boundary', () => {
    expect(dayKeys(new Date('2026-03-02T12:00:00.000Z'), 3)).toEqual([
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('does not drift across a leap day', () => {
    expect(dayKeys(new Date('2028-03-01T12:00:00.000Z'), 3)).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(dayKeys(new Date('2028-03-01T12:00:00.000Z'), 90)).toHaveLength(90);
  });
});

describe('foldModels', () => {
  it('zero-fills a series dense against the buckets it was given', () => {
    const [series] = foldModels(
      [row('2026-08-03', 'openai', 'gpt', '0.25'), row('2026-08-01', 'openai', 'gpt', '1.5')],
      [],
      BUCKETS,
      MODEL_SERIES_LIMIT,
    );

    expect(series.daily).toEqual(['1.500000', '0.000000', '0.250000']);
    expect(series.costUsd).toBe('1.750000');
  });

  it('keeps the top N by cost and folds the remainder into one untitled entry', () => {
    const series = foldModels(
      [
        row('2026-08-01', 'openai', 'a', '4'),
        row('2026-08-01', 'openai', 'b', '3'),
        row('2026-08-01', 'openai', 'c', '2'),
        row('2026-08-01', 'openai', 'd', '1'),
        row('2026-08-02', 'openai', 'e', '0.5'),
      ],
      [],
      BUCKETS,
      MODEL_SERIES_LIMIT,
    );

    expect(series.map((s) => s.model)).toEqual(['a', 'b', 'c', null]);
    expect(series[3]).toMatchObject({ provider: null, costUsd: '1.500000' });
    expect(series[3].daily).toEqual(['1.000000', '0.500000', '0.000000']);
  });

  it('returns no folded entry when nothing falls below the limit', () => {
    const series = foldModels(
      [row('2026-08-01', 'openai', 'a', '4'), row('2026-08-01', 'openai', 'b', '3')],
      [],
      BUCKETS,
      MODEL_SERIES_LIMIT,
    );

    expect(series).toHaveLength(2);
    expect(foldModels([], [], BUCKETS, MODEL_SERIES_LIMIT)).toEqual([]);
  });

  it('breaks a cost tie on provider then model, not on row order', () => {
    const rows = [
      row('2026-08-01', 'zeta', 'm', '1'),
      row('2026-08-01', 'acme', 'z', '1'),
      row('2026-08-01', 'acme', 'a', '1'),
    ];
    const ordered = foldModels(rows, [], BUCKETS, MODEL_SERIES_LIMIT);
    const reversed = foldModels([...rows].reverse(), [], BUCKETS, MODEL_SERIES_LIMIT);

    expect(ordered.map((s) => `${s.provider}/${s.model}`)).toEqual(['acme/a', 'acme/z', 'zeta/m']);
    expect(reversed.map((s) => s.model)).toEqual(ordered.map((s) => s.model));
  });

  it('carries each kept model its own previous-window total', () => {
    const [series] = foldModels(
      [row('2026-08-01', 'openai', 'gpt', '1')],
      [prev('openai', 'gpt', '2.5')],
      BUCKETS,
      MODEL_SERIES_LIMIT,
    );

    expect(series).toMatchObject({ costUsd: '1.000000', previousCostUsd: '2.500000' });
  });

  it('folds a previous-window-only model into Other instead of dropping it', () => {
    const series = foldModels(
      [row('2026-08-01', 'openai', 'gpt', '1')],
      [prev('openai', 'gpt', '2'), prev('gone', 'retired', '5')],
      BUCKETS,
      MODEL_SERIES_LIMIT,
    );

    expect(series).toHaveLength(2);
    expect(series[1]).toMatchObject({
      provider: null,
      model: null,
      costUsd: '0.000000',
      previousCostUsd: '5.000000',
      calls: 0,
      averageLatencyMs: 0,
    });
    expect(series[1].daily).toEqual(['0.000000', '0.000000', '0.000000']);
  });

  it('rounds the mean latency to a millisecond and guards the empty divisor', () => {
    const [thirds, half] = foldModels(
      [
        row('2026-08-01', 'openai', 'a', '2', 3, 1000),
        row('2026-08-01', 'openai', 'b', '1', 2, 3),
      ],
      [],
      BUCKETS,
      MODEL_SERIES_LIMIT,
    );

    expect(thirds.averageLatencyMs).toBe(333);
    expect(half.averageLatencyMs).toBe(2);
    expect(foldModels([], [prev('gone', 'retired', '1')], BUCKETS, 3)[0].averageLatencyMs).toBe(0);
  });

  it('sums to the same total as the rows it was given, folded entry included', () => {
    const rows = [
      row('2026-08-01', 'openai', 'a', '4.000001', 2, 10, 100),
      row('2026-08-02', 'openai', 'a', '0.999999', 1, 5, 50),
      row('2026-08-01', 'openai', 'b', '3.5', 1, 7, 30),
      row('2026-08-03', 'anthropic', 'c', '2.25', 4, 8, 20),
      row('2026-08-02', 'anthropic', 'd', '1.125', 3, 9, 10),
      row('2026-08-03', 'google', 'e', '0.875', 1, 1, 5),
    ];
    const series = foldModels(rows, [], BUCKETS, MODEL_SERIES_LIMIT);

    const rowTotal = rows.reduce((sum, r) => sum.plus(r.cost), new Prisma.Decimal(0));
    const seriesTotal = series.reduce((sum, s) => sum.plus(s.costUsd), new Prisma.Decimal(0));

    expect(seriesTotal.toFixed(6)).toBe(rowTotal.toFixed(6));
    expect(seriesTotal.toFixed(6)).toBe('12.750000');
    expect(series.reduce((sum, s) => sum + s.calls, 0)).toBe(12);
    expect(series.reduce((sum, s) => sum + s.tokens, 0)).toBe(215);
  });
});
