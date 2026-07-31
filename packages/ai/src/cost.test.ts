import { describe, expect, it } from 'vitest';

import { ModelPrices } from './config';
import { DEFAULT_UNIT_KIND, costFor } from './cost';

const prices = new ModelPrices({
  'openai/gpt-4.1-mini': {
    unit_kind: 'token',
    input_per_1m_usd: 0.4,
    output_per_1m_usd: 1.6,
  },
});

describe('costFor', () => {
  it('prices a call from the input and output rates separately', () => {
    const cost = costFor(prices, 'openai', 'gpt-4.1-mini', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toEqual({ units: 2_000_000, unitKind: 'token', costUsd: 2 });
  });

  it('rounds to the six decimals llm_calls.cost_usd stores', () => {
    // 1 in + 1 out at these rates is 0.0000004 + 0.0000016 = 0.000002 exactly at 6dp; a
    // half-token more would be truncated by Postgres rather than by us.
    const cost = costFor(prices, 'openai', 'gpt-4.1-mini', { inputTokens: 1, outputTokens: 1 });
    expect(cost.costUsd).toBe(0.000002);
  });

  it('returns null — not zero — when the model has no price row', () => {
    const cost = costFor(prices, 'google', 'gemini-2.5-flash', {
      inputTokens: 900,
      outputTokens: 120,
    });
    expect(cost.costUsd).toBeNull();
    // The units are still known, so the row is still useful for a token audit.
    expect(cost).toMatchObject({ units: 1020, unitKind: DEFAULT_UNIT_KIND });
  });

  it('treats missing usage as zero rather than throwing', () => {
    // A transport that failed before returning a body has no token counts at all.
    expect(costFor(prices, 'openai', 'gpt-4.1-mini', {})).toEqual({
      units: 0,
      unitKind: 'token',
      costUsd: 0,
    });
  });
});
