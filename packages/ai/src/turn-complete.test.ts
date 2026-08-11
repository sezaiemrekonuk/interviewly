/**
 * T01 — the completeness gate. Three properties nothing else in this package has: it never
 * throws, it never falls back, and a failure of any kind reads as `finished: true` (ADR-T03).
 */
import { describe, expect, it, vi } from 'vitest';

import { TIMEOUT_MS } from './AiClient';
import { AiError } from './errors';
import { LiveAiClient } from './live-client';
import { StubAiClient } from './stub';
import type { PromptBuilder } from './prompt-builder';
import type { ChainDeps, LlmCallRecord, ProviderTransport } from './providers';

const ctx = { interviewId: 'itv_gate', traceId: 'trace_gate' };

const args = (utterance: string) => ({
  utterance,
  currentQuestion: 'Tell me about a project you owned end to end.',
  language: 'en',
  ctx,
});

function deps(transports: Record<string, ProviderTransport>): ChainDeps & {
  rows: LlmCallRecord[];
} {
  const rows: LlmCallRecord[] = [];
  return {
    rows,
    recordLlmCall: async (row) => {
      rows.push(row);
    },
    // Both keys configured on purpose: a chain that still carried tier-2 would use it here.
    keys: { openai: 'k1', google: 'k2' },
    transports,
    sleep: async () => undefined,
  };
}

const answering: ProviderTransport = async () => ({ text: '{"finished":true}' });

describe('StubAiClient.turnComplete', () => {
  it('holds a fragment that ends mid-sentence', async () => {
    expect(await new StubAiClient().turnComplete(args('So at my last company we'))).toEqual({
      finished: false,
    });
  });

  it('forwards a fragment that ends on a full stop', async () => {
    expect(await new StubAiClient().turnComplete(args("I don't know that one."))).toEqual({
      finished: true,
    });
  });
});

describe('LiveAiClient.turnComplete', () => {
  it('returns the provider verdict', async () => {
    const d = deps({ openai: async () => ({ text: '{"finished":false}' }) });
    expect(await new LiveAiClient(d).turnComplete(args('and then we'))).toEqual({
      finished: false,
    });
  });

  it('fails open when the transport throws, and never falls back to tier-2', async () => {
    const google = vi.fn(answering);
    const d = deps({
      openai: async () => {
        throw new Error('openai is down');
      },
      google,
    });

    expect(await new LiveAiClient(d).turnComplete(args('So at my last company we'))).toEqual({
      finished: true,
    });
    // ADR-T03: one step in the chain, so one attempt and one `llm_calls` row.
    expect(google).not.toHaveBeenCalled();
    expect(d.rows).toHaveLength(1);
  });

  it('fails open when the provider does not answer within the timeout', async () => {
    vi.useFakeTimers();
    try {
      const d = deps({ openai: () => new Promise<never>(() => undefined) });
      const verdict = new LiveAiClient(d).turnComplete(args('şey, yani, aslında'));
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS.turnComplete);
      expect(await verdict).toEqual({ finished: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails open on output that is schema-invalid', async () => {
    const d = deps({ openai: async () => ({ text: '{"finished":"maybe"}' }) });
    expect(await new LiveAiClient(d).turnComplete(args('Can you repeat the question?'))).toEqual({
      finished: true,
    });
  });

  it('fails open when the prompt does not compile', async () => {
    // The one failure that is thrown rather than rejected — `builder.build` is synchronous.
    const builder = {
      build: () => {
        throw new AiError('AI_PROMPT_BUILD_FAILED', 'prompt has no value for {{utterance}}');
      },
    } as unknown as PromptBuilder;

    expect(
      await new LiveAiClient(deps({ openai: answering }), { builder }).turnComplete(args('we')),
    ).toEqual({ finished: true });
  });

  it('fails open when no provider key is configured', async () => {
    const d = { ...deps({}), keys: {} };
    expect(await new LiveAiClient(d).turnComplete(args('Can you repeat the question?'))).toEqual({
      finished: true,
    });
  });
});
