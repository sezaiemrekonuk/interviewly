/**
 * Loaders for the two config files this package owns. Format and load contract are ai spec
 * §"Config files this area owns"; where the files live at runtime is `infra`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

export const CONFIG_DIR = join(__dirname, '..', 'config');

const ModelPricesSchema = z.object({
  models: z.record(
    z.object({
      unit_kind: z.string().min(1),
      input_per_1m_usd: z.number().nonnegative(),
      output_per_1m_usd: z.number().nonnegative(),
      per_minute_usd: z.number().nonnegative().optional(),
    }),
  ),
});

export type ModelPrice = z.infer<typeof ModelPricesSchema>['models'][string];

export class ModelPrices {
  constructor(private readonly models: Record<string, ModelPrice>) {}

  /** `undefined` is a normal answer: I02 records `cost_usd = null` and logs PRICE_MISSING. */
  lookup(provider: string, model: string): ModelPrice | undefined {
    return this.models[`${provider}/${model}`];
  }
}

export function loadModelPrices(dir: string = CONFIG_DIR): ModelPrices {
  const parsed = ModelPricesSchema.parse(
    parse(readFileSync(join(dir, 'model-prices.yaml'), 'utf8')),
  );
  return new ModelPrices(parsed.models);
}

const InjectionPatternsSchema = z.object({
  patterns: z
    .array(z.object({ id: z.string().min(1), pattern: z.string().min(1) }))
    .default([]),
});

export interface InjectionPattern {
  id: string;
  regex: RegExp;
}

/**
 * An empty list is allowed — detection then simply matches nothing. `m` is set so an
 * anchored pattern like `^\s*system\s*:` can catch a role marker on any line of a pasted
 * CV, not only the first.
 */
export function loadInjectionPatterns(dir: string = CONFIG_DIR): InjectionPattern[] {
  const parsed = InjectionPatternsSchema.parse(
    parse(readFileSync(join(dir, 'injection-patterns.yaml'), 'utf8')),
  );
  return parsed.patterns.map((p) => ({ id: p.id, regex: new RegExp(p.pattern, 'im') }));
}
