import { describe, expect, it } from 'vitest';

import type { AdminCostModel } from '../../../lib/query';
import { microUsd } from '../interview-table';

import { byProvider, foldTop } from './fold';

function model(
  provider: string,
  name: string,
  costs: string[],
  extra: Partial<AdminCostModel> = {},
): AdminCostModel {
  const total = costs.reduce((sum, value) => sum + microUsd(value), 0);
  return {
    provider,
    model: name,
    costUsd: (total / 1_000_000).toFixed(6),
    previousCostUsd: '0.000000',
    calls: costs.length,
    tokens: 0,
    averageLatencyMs: 0,
    daily: {
      costUsd: costs,
      calls: costs.map(() => 1),
      tokens: costs.map(() => 0),
      latencyMs: costs.map(() => 0),
    },
    ...extra,
  };
}

const A = model('openai', 'gpt-4.1-mini', ['0.400000', '0.100000']);
const B = model('elevenlabs', 'tts', ['0.200000', '0.050000']);
const C = model('google', 'gemini-2.5-flash', ['0.010000', '0.005000']);
const D = model('openai', 'gpt-4.1-nano', ['0.002000', '0.001000']);

const totalMicro = (rows: AdminCostModel[]) =>
  rows.reduce((sum, row) => sum + microUsd(row.costUsd), 0);

describe('foldTop', () => {
  it('leaves the list alone when it already fits', () => {
    expect(foldTop([A, B], 3)).toEqual([A, B]);
    expect(foldTop([A, B, C], 3)).toEqual([A, B, C]);
  });

  it('keeps the top N and folds the tail into one residual row', () => {
    const folded = foldTop([A, B, C, D], 3);
    expect(folded).toHaveLength(4);
    expect(folded.slice(0, 3)).toEqual([A, B, C]);
    expect(folded[3].provider).toBeNull();
    expect(folded[3].model).toBeNull();
  });

  it('does not lose a cent to the fold', () => {
    const input = [A, B, C, D];
    expect(totalMicro(foldTop(input, 3))).toBe(totalMicro(input));
    expect(totalMicro(foldTop(input, 1))).toBe(totalMicro(input));
  });

  it('sums the residual daily series per bucket, not across them', () => {
    const folded = foldTop([A, B, C, D], 2);
    expect(folded[2].daily.costUsd).toEqual(['0.012000', '0.006000']);
  });

  it('carries the residual previous-window spend', () => {
    const stopped = model('anthropic', 'sonnet', ['0.000000'], {
      previousCostUsd: '5.000000',
      costUsd: '0.000000',
    });
    const folded = foldTop([A, B, C, stopped], 3);
    expect(folded[3].previousCostUsd).toBe('5.000000');
  });

  it('adds up calls and tokens rather than averaging them', () => {
    const folded = foldTop(
      [A, B, C, model('x', 'y', ['0.001000'], { calls: 10, tokens: 400 })],
      3,
    );
    expect(folded[3].calls).toBe(10);
    expect(folded[3].tokens).toBe(400);
  });
});

describe('byProvider', () => {
  it('collapses a provider to one row keyed by provider, with no model', () => {
    const rolled = byProvider([A, B, C, D]);
    expect(rolled.map((row) => row.provider)).toEqual(['openai', 'elevenlabs', 'google']);
    expect(rolled.every((row) => row.model === null)).toBe(true);
  });

  it('sums a provider exactly, never through a float', () => {
    const [openai] = byProvider([A, D]);
    expect(openai.costUsd).toBe('0.503000');
    expect(microUsd(openai.costUsd)).toBe(microUsd(A.costUsd) + microUsd(D.costUsd));
  });

  it('preserves the platform total across the rollup', () => {
    const input = [A, B, C, D];
    expect(totalMicro(byProvider(input))).toBe(totalMicro(input));
  });

  it('sums the daily series index by index', () => {
    const [openai] = byProvider([A, D]);
    expect(openai.daily.costUsd).toEqual(['0.402000', '0.101000']);
    expect(openai.daily.calls).toEqual([2, 2]);
  });

  it('ranks by spend and breaks ties on the provider name', () => {
    const one = model('zeta', 'a', ['1.000000']);
    const two = model('alpha', 'b', ['1.000000']);
    expect(byProvider([one, two]).map((row) => row.provider)).toEqual(['alpha', 'zeta']);
  });

  it('weights latency by calls instead of averaging the averages', () => {
    const busy = model('p', 'busy', ['0.000000'], { calls: 90, averageLatencyMs: 100 });
    const rare = model('p', 'rare', ['0.000000'], { calls: 10, averageLatencyMs: 1000 });
    const [rolled] = byProvider([busy, rare]);
    expect(rolled.averageLatencyMs).toBe(190);
  });

  it('reports zero latency for a provider with no calls rather than dividing by zero', () => {
    const idle = model('p', 'idle', ['0.000000'], { calls: 0, averageLatencyMs: 0 });
    const [rolled] = byProvider([idle]);
    expect(rolled.averageLatencyMs).toBe(0);
    expect(Number.isNaN(rolled.averageLatencyMs)).toBe(false);
  });

  it('weights the daily latency series by that day’s calls', () => {
    const busy = model('p', 'busy', ['0.000000'], {
      daily: {
        costUsd: ['0.000000'],
        calls: [90],
        tokens: [0],
        latencyMs: [100],
      },
    });
    const rare = model('p', 'rare', ['0.000000'], {
      daily: {
        costUsd: ['0.000000'],
        calls: [10],
        tokens: [0],
        latencyMs: [1000],
      },
    });
    const [rolled] = byProvider([busy, rare]);
    expect(rolled.daily.latencyMs).toEqual([190]);
  });
});
