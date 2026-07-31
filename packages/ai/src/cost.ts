/**
 * §9.2 cost accounting. `cost_usd` is frozen at return time from `model-prices.yaml` and
 * stored, so a later price edit never rewrites history.
 *
 * A model absent from the price file is NOT an error (ai AC-8): the call still returns, the
 * row records `cost_usd = null` and the caller logs `PRICE_MISSING`. Null rather than 0 is
 * the whole point — 0 claims the call was free, null says the price is unknown, and the
 * admin cost dashboard has to be able to tell those apart.
 */
import type { ModelPrices } from './config';

/**
 * db `UnitKind` (F02). Used when no price row names one — an LLM attempt is always metered
 * in tokens, and `llm_calls.unit_kind` is NOT NULL, so there is no "unknown" to record.
 */
export const DEFAULT_UNIT_KIND = 'token';

export interface TokenUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface CallCost {
  units: number;
  unitKind: string;
  costUsd: number | null;
}

export function costFor(
  prices: ModelPrices,
  provider: string,
  model: string,
  usage: TokenUsage,
): CallCost {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const units = input + output;

  const price = prices.lookup(provider, model);
  if (!price) return { units, unitKind: DEFAULT_UNIT_KIND, costUsd: null };

  const costUsd =
    (input / 1_000_000) * price.input_per_1m_usd +
    (output / 1_000_000) * price.output_per_1m_usd;

  return { units, unitKind: price.unit_kind, costUsd: round6(costUsd) };
}

/**
 * `llm_calls.cost_usd` is `Decimal(12,6)`. Rounding here keeps the number we log, the number
 * we return and the number the database stores identical, rather than letting Postgres
 * quietly truncate a longer float into a total that no longer adds up.
 */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
