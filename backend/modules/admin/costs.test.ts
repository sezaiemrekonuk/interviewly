import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { MODEL_CAP, dayKeys, rankModels, resolveDays } from './costs';

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

describe('rankModels', () => {
  it('zero-fills all four daily arrays dense against the buckets it was given', () => {
    const { models } = rankModels(
      [
        row('2026-08-03', 'openai', 'gpt', '0.25', 2, 500, 40),
        row('2026-08-01', 'openai', 'gpt', '1.5', 3, 300, 60),
      ],
      [],
      BUCKETS,
      MODEL_CAP,
    );

    expect(models[0].daily).toEqual({
      costUsd: ['1.500000', '0.000000', '0.250000'],
      calls: [3, 0, 2],
      tokens: [60, 0, 40],
      latencyMs: [100, 0, 250],
    });
    expect(models[0].costUsd).toBe('1.750000');
    for (const array of Object.values(models[0].daily)) {
      expect(array).toHaveLength(BUCKETS.length);
    }
  });

  it('returns every model, never an Other row and never a null name', () => {
    const { models, truncated } = rankModels(
      [
        row('2026-08-01', 'openai', 'a', '4'),
        row('2026-08-01', 'openai', 'b', '3'),
        row('2026-08-01', 'openai', 'c', '2'),
        row('2026-08-01', 'openai', 'd', '1'),
        row('2026-08-02', 'openai', 'e', '0.5'),
      ],
      [],
      BUCKETS,
      MODEL_CAP,
    );

    expect(models.map((s) => s.model)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(models.map((s) => s.provider)).toEqual(Array(5).fill('openai'));
    expect(truncated).toBe(0);
    expect(rankModels([], [], BUCKETS, MODEL_CAP)).toEqual({ models: [], truncated: 0 });
  });

  it('breaks a cost tie on provider then model, not on row order', () => {
    const rows = [
      row('2026-08-01', 'zeta', 'm', '1'),
      row('2026-08-01', 'acme', 'z', '1'),
      row('2026-08-01', 'acme', 'a', '1'),
    ];
    const ordered = rankModels(rows, [], BUCKETS, MODEL_CAP).models;
    const reversed = rankModels([...rows].reverse(), [], BUCKETS, MODEL_CAP).models;

    expect(ordered.map((s) => `${s.provider}/${s.model}`)).toEqual(['acme/a', 'acme/z', 'zeta/m']);
    expect(reversed.map((s) => s.model)).toEqual(ordered.map((s) => s.model));
  });

  it('carries each model its own previous-window total', () => {
    const { models } = rankModels(
      [row('2026-08-01', 'openai', 'gpt', '1')],
      [prev('openai', 'gpt', '2.5')],
      BUCKETS,
      MODEL_CAP,
    );

    expect(models[0]).toMatchObject({ costUsd: '1.000000', previousCostUsd: '2.500000' });
  });

  it('keeps a previous-window-only model as its own zeroed row', () => {
    const { models } = rankModels(
      [row('2026-08-01', 'openai', 'gpt', '1')],
      [prev('openai', 'gpt', '2'), prev('gone', 'retired', '5')],
      BUCKETS,
      MODEL_CAP,
    );

    expect(models).toHaveLength(2);
    expect(models[1]).toMatchObject({
      provider: 'gone',
      model: 'retired',
      costUsd: '0.000000',
      previousCostUsd: '5.000000',
      calls: 0,
      tokens: 0,
      averageLatencyMs: 0,
    });
    expect(models[1].daily).toEqual({
      costUsd: ['0.000000', '0.000000', '0.000000'],
      calls: [0, 0, 0],
      tokens: [0, 0, 0],
      latencyMs: [0, 0, 0],
    });
  });

  it('rounds the mean latency to a millisecond and guards the empty divisor', () => {
    const { models } = rankModels(
      [
        row('2026-08-01', 'openai', 'a', '2', 3, 1000),
        row('2026-08-01', 'openai', 'b', '1', 2, 3),
      ],
      [],
      BUCKETS,
      MODEL_CAP,
    );

    expect(models.map((s) => s.averageLatencyMs)).toEqual([333, 2]);
    expect(
      rankModels([], [prev('gone', 'retired', '1')], BUCKETS, MODEL_CAP).models[0]
        .averageLatencyMs,
    ).toBe(0);
  });

  it('means the daily latency over that day alone and reads 0 on a day without calls', () => {
    const { models } = rankModels(
      [
        row('2026-08-01', 'openai', 'a', '1', 3, 1000),
        row('2026-08-03', 'openai', 'a', '1', 2, 3),
      ],
      [],
      BUCKETS,
      MODEL_CAP,
    );

    expect(models[0].daily.latencyMs).toEqual([333, 0, 2]);
    expect(models[0].averageLatencyMs).toBe(201);
  });

  it('drops the overflow past the cap and reports how many it dropped', () => {
    const rows = Array.from({ length: MODEL_CAP + 3 }, (_, index) =>
      row('2026-08-01', 'openai', `m${String(index).padStart(2, '0')}`, String(100 - index)),
    );
    const { models, truncated } = rankModels(rows, [], BUCKETS, MODEL_CAP);

    expect(models).toHaveLength(MODEL_CAP);
    expect(truncated).toBe(3);
    expect(models[0].model).toBe('m00');
    expect(models[MODEL_CAP - 1].model).toBe(`m${String(MODEL_CAP - 1).padStart(2, '0')}`);
    expect(rankModels(rows, [], BUCKETS, MODEL_CAP + 3).truncated).toBe(0);
  });

  it('sums to the row total across models and across every daily bucket', () => {
    const rows = [
      row('2026-08-01', 'openai', 'a', '4.000001', 2, 10, 100),
      row('2026-08-02', 'openai', 'a', '0.999999', 1, 5, 50),
      row('2026-08-01', 'openai', 'b', '3.5', 1, 7, 30),
      row('2026-08-03', 'anthropic', 'c', '2.25', 4, 8, 20),
      row('2026-08-02', 'anthropic', 'd', '1.125', 3, 9, 10),
      row('2026-08-03', 'google', 'e', '0.875', 1, 1, 5),
    ];
    const { models, truncated } = rankModels(rows, [], BUCKETS, MODEL_CAP);

    const rowTotal = rows.reduce((sum, r) => sum.plus(r.cost), new Prisma.Decimal(0));
    const modelTotal = models.reduce((sum, s) => sum.plus(s.costUsd), new Prisma.Decimal(0));
    const dailyTotal = models.reduce(
      (sum, s) => s.daily.costUsd.reduce((inner, value) => inner.plus(value), sum),
      new Prisma.Decimal(0),
    );

    expect(truncated).toBe(0);
    expect(modelTotal.toFixed(6)).toBe(rowTotal.toFixed(6));
    expect(dailyTotal.toFixed(6)).toBe(rowTotal.toFixed(6));
    expect(modelTotal.toFixed(6)).toBe('12.750000');
    expect(models.reduce((sum, s) => sum + s.calls, 0)).toBe(12);
    expect(models.reduce((sum, s) => sum + s.tokens, 0)).toBe(215);
    expect(models.flatMap((s) => s.daily.calls).reduce((sum, n) => sum + n, 0)).toBe(12);
    expect(models.flatMap((s) => s.daily.tokens).reduce((sum, n) => sum + n, 0)).toBe(215);
  });
});
