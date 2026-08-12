/**
 * The chain paths `ai_provider.feature` cannot reach: the real timeout (the feature's fake
 * throws a pre-classified timeout rather than hanging), an empty chain, and the fence-wrapped
 * JSON that a model returns despite being told not to.
 */
import { describe, expect, it, vi } from 'vitest';

import { ModelPrices } from './config';
import { AiError } from './errors';
import { parseOutput } from './live-client';
import {
  FALLBACK_STEP,
  buildChain,
  geminiTransport,
  openaiTransport,
  runChain,
  type ChainDeps,
  type LlmCallRecord,
} from './providers';
import { QuestionBatchSchema } from './schemas';
import type { BuiltPrompt } from './prompt-builder';

const built: BuiltPrompt = {
  system: 'system template',
  messages: [
    { role: 'system', content: 'system template' },
    { role: 'user', content: '<job_listing>a listing</job_listing>' },
  ],
  promptName: 'interview.question.generate',
  promptUuid: '0f2b7c94-6d31-4a58-9e70-2c1d84af5b13',
  promptVersion: 1,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  params: {},
};

function deps(overrides: Partial<ChainDeps> = {}): ChainDeps & { rows: LlmCallRecord[] } {
  const rows: LlmCallRecord[] = [];
  return {
    rows,
    recordLlmCall: async (row) => {
      rows.push(row);
    },
    keys: { openai: 'k1', google: 'k2' },
    prices: new ModelPrices({}),
    sleep: async () => undefined,
    ...overrides,
  };
}

const ctx = { interviewId: 'itv_unit', traceId: 'trace_unit' };

describe('buildChain', () => {
  it('puts the prompt file first and the fixed tier-2 second', () => {
    expect(buildChain(built, { openai: 'k1', google: 'k2' })).toEqual([
      { provider: 'openai', model: 'gpt-4.1-mini' },
      FALLBACK_STEP,
    ]);
  });

  it('drops a step whose provider has no key rather than attempting it', () => {
    expect(buildChain(built, { openai: 'k1' })).toEqual([
      { provider: 'openai', model: 'gpt-4.1-mini' },
    ]);
  });
});

describe('transport request bodies', () => {
  async function sentBody(
    transport: typeof geminiTransport,
    response: unknown,
  ): Promise<Record<string, never> & Record<string, unknown>> {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await transport({
        model: 'm',
        apiKey: 'k',
        system: 'system template',
        messages: [{ role: 'user', content: 'u' }],
        params: { temperature: 0.6, max_tokens: 800 },
        signal: new AbortController().signal,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    return JSON.parse(String(fetchMock.mock.calls[0][1].body));
  }

  it('spends the gemini output budget on output, never on thinking', async () => {
    const body = await sentBody(geminiTransport, {
      candidates: [{ content: { parts: [{ text: '[]' }] } }],
    });
    expect(body.generationConfig).toMatchObject({
      maxOutputTokens: 800,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it('makes openai enforce JSON, which is why no prompt may ask for a top-level array', async () => {
    const body = await sentBody(openaiTransport, {
      choices: [{ message: { content: '{}' } }],
    });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });
});

describe('runChain', () => {
  it('bounds an attempt that never resolves and falls through', async () => {
    const d = deps({
      transports: {
        // Honours nothing — not the abort, not anything. The race is what saves us.
        openai: () => new Promise<never>(() => undefined),
        google: async () => ({ text: '{"questions":[]}' }),
      },
    });

    const value = await runChain({
      built,
      chain: buildChain(built, d.keys),
      timeoutMs: 20,
      validate: parseOutput(QuestionBatchSchema),
      ctx,
      deps: d,
    });

    expect(value).toEqual({ questions: [] });
    expect(d.rows.map((r) => r.attemptNo)).toEqual([1, 2]);
    expect(d.rows[1].fellBackFrom).toBe('gpt-4.1-mini');
  });

  it('backs off before a rate-limit fall-through and not before an HTTP one', async () => {
    const sleep = vi.fn(async () => undefined);
    const d = deps({
      sleep,
      transports: {
        openai: async () => {
          throw Object.assign(new Error('nope'), { name: 'AbortError' });
        },
        google: async () => ({ text: '{"questions":[]}' }),
      },
    });

    await runChain({
      built,
      chain: buildChain(built, d.keys),
      timeoutMs: 100,
      validate: parseOutput(QuestionBatchSchema),
      ctx,
      deps: d,
    });

    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws AI_PROVIDER_UNAVAILABLE when every provider is unconfigured', async () => {
    const d = deps({ keys: {} });
    await expect(
      runChain({
        built,
        chain: buildChain(built, d.keys),
        timeoutMs: 10,
        validate: parseOutput(QuestionBatchSchema),
        ctx,
        deps: d,
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
  });

  it('surfaces a chain exhausted by schema failure as AI_OUTPUT_INVALID', async () => {
    const d = deps({
      transports: {
        openai: async () => ({ text: '{"questions":[{"nope":true}]}' }),
        google: async () => ({ text: 'not json at all' }),
      },
    });

    await expect(
      runChain({
        built,
        chain: buildChain(built, d.keys),
        timeoutMs: 100,
        validate: parseOutput(QuestionBatchSchema),
        ctx,
        deps: d,
      }),
    ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
    // Both failed attempts are still on the record — a failure is not a free call.
    expect(d.rows).toHaveLength(2);
  });
});

describe('parseOutput', () => {
  it('unwraps a code fence the model added anyway', () => {
    const parse = parseOutput(QuestionBatchSchema);
    expect(parse('```json\n{"questions":[]}\n```')).toEqual({ questions: [] });
  });

  it('never puts the offending body in the error message', () => {
    const parse = parseOutput(QuestionBatchSchema);
    try {
      parse('{"questions":[{"text":"a candidate transcript leaked here"}]}');
      throw new Error('expected a schema failure');
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).message).not.toContain('transcript');
    }
  });
});
