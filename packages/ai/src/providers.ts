/**
 * B6 — the provider chain, the per-attempt audit row, and the two provider transports.
 *
 * The chain IS the retry (ADR-I04): on a trigger the call falls through to tier-2 rather
 * than retrying tier-1. A same-tier retry loop doubles latency and cost against a provider
 * that is failing for a reason the second attempt will hit again.
 *
 * Every attempt — including a failed one — writes its own `llm_calls` row. That is the K9
 * cost-audit invariant: the price of falling back is never hidden inside the price of
 * succeeding.
 *
 * No provider SDK is imported here or anywhere else. Both providers are one JSON POST, and
 * `fetch` has been in Node since 18; two dependencies with their own transitive trees and
 * their own advisories would buy nothing this file does not already do in twenty lines.
 */
import { AiError, noopLogger, type AiLogger } from './errors';
import { costFor, DEFAULT_UNIT_KIND } from './cost';
import { loadModelPrices, type ModelPrices } from './config';
import type { AiCtx, BuiltPrompt, BuiltPromptMessage } from './prompt-builder';

/** Tier-2 (B6). Declared by the chain, not by a prompt file — no prompt names gemini. */
export const FALLBACK_STEP: ChainStep = { provider: 'google', model: 'gemini-2.5-flash' };

/** §8.3 — applied only before a rate-limit fall-through, never before the other triggers. */
export const BACKOFF_BASE_MS = 500;

export interface ChainStep {
  provider: string;
  model: string;
}

export type ProviderKeys = Record<string, string | undefined>;

export interface ProviderRequest {
  provider: string;
  model: string;
  /** Duplicated out of `messages` — OpenAI wants it at index 0, Gemini wants it apart. */
  system: string;
  messages: BuiltPromptMessage[];
  params: Record<string, unknown>;
  apiKey: string;
  signal: AbortSignal;
}

export interface ProviderResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type ProviderTransport = (req: ProviderRequest) => Promise<ProviderResponse>;

/** What made an attempt fail. Only `schema` changes the error the chain finally throws. */
export type FailureKind = 'http' | 'timeout' | 'rate_limit' | 'schema';

export class ProviderCallError extends Error {
  readonly kind: Exclude<FailureKind, 'schema'>;

  constructor(kind: Exclude<FailureKind, 'schema'>, message: string) {
    super(message);
    this.name = 'ProviderCallError';
    this.kind = kind;
  }
}

/** One `llm_calls` row, in package terms. `backend` maps it onto the F02 columns. */
export interface LlmCallRecord {
  interviewId: string;
  provider: string;
  model: string;
  promptUuid: string;
  promptVersion: number;
  attemptNo: number;
  fellBackFrom: string | null;
  units: number;
  unitKind: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  traceId: string;
}

/**
 * Injected by `backend`/`worker`. This package is shared by both and depends on neither, so
 * it never sees Prisma — it hands over a finished row and lets the caller write it.
 */
export type RecordLlmCall = (record: LlmCallRecord) => Promise<void>;

export interface ChainDeps {
  recordLlmCall: RecordLlmCall;
  keys: ProviderKeys;
  logger?: AiLogger;
  transports?: Record<string, ProviderTransport>;
  prices?: ModelPrices;
  /** Injected so the acceptance suite does not spend real seconds on a backoff. */
  sleep?: (ms: number) => Promise<void>;
}

// ------------------------------------------------------------------ transports

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

interface OpenAiBody {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export const openaiTransport: ProviderTransport = async (req) => {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      // The prompts already demand bare JSON; this makes the provider enforce it too, and
      // a response that still is not JSON is a schema failure, which is a fallback trigger.
      response_format: { type: 'json_object' },
      ...req.params,
    }),
  });
  if (!res.ok) throw httpFailure('openai', res.status);

  const body = (await res.json()) as OpenAiBody;
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
  };
};

interface GeminiBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export const geminiTransport: ProviderTransport = async (req) => {
  const res = await fetch(`${GEMINI_URL}/${req.model}:generateContent`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      // Header, not a query parameter: a key in the URL lands in every proxy access log.
      'x-goog-api-key': req.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: 'user',
          parts: [{ text: userText(req.messages) }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: req.params.temperature,
        maxOutputTokens: req.params.max_tokens,
      },
    }),
  });
  if (!res.ok) throw httpFailure('google', res.status);

  const body = (await res.json()) as GeminiBody;
  return {
    text: body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
    inputTokens: body.usageMetadata?.promptTokenCount,
    outputTokens: body.usageMetadata?.candidatesTokenCount,
  };
};

export const DEFAULT_TRANSPORTS: Record<string, ProviderTransport> = {
  openai: openaiTransport,
  google: geminiTransport,
};

/**
 * The message carries the provider and the status and nothing else. A provider error body
 * echoes the request back often enough that including it would put a job listing — or a
 * transcript — into a log line and an error report (K6, §7.2).
 */
function httpFailure(provider: string, status: number): ProviderCallError {
  return status === 429
    ? new ProviderCallError('rate_limit', `${provider} rate limited the request`)
    : new ProviderCallError('http', `${provider} responded ${status}`);
}

function userText(messages: BuiltPromptMessage[]): string {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
}

// ------------------------------------------------------------------ the chain

/**
 * Tier-1 comes from the prompt file (K9 — the model is a property of the prompt version);
 * tier-2 is fixed. A step whose provider has no key is dropped rather than attempted: an
 * unconfigured tier-2 degrades the chain, and boot validation (B7) already guarantees the
 * tier-1 key exists.
 */
export function buildChain(built: BuiltPrompt, keys: ProviderKeys): ChainStep[] {
  const steps: ChainStep[] = [{ provider: built.provider, model: built.model }];
  if (FALLBACK_STEP.provider !== built.provider || FALLBACK_STEP.model !== built.model) {
    steps.push(FALLBACK_STEP);
  }
  return steps.filter((step) => Boolean(keys[step.provider]));
}

/**
 * T01/ADR-T03 — the chain for a prompt that must not fall back: tier-1 alone, or nothing.
 * `buildChain(...).slice(0, 1)` is not the same thing, because that filter drops an
 * unconfigured tier-1 and would leave gemini in first place.
 *
 * The one caller is the completeness gate. A second prompt wanting this should make it a field
 * on the prompt YAML rather than a second special case in `live-client.ts` (STATE.md tech debt).
 */
export function buildSoloChain(built: BuiltPrompt, keys: ProviderKeys): ChainStep[] {
  const step: ChainStep = { provider: built.provider, model: built.model };
  return keys[step.provider] ? [step] : [];
}

export interface RunChainArgs<T> {
  built: BuiltPrompt;
  chain: ChainStep[];
  timeoutMs: number;
  /** Throws `AiError('AI_OUTPUT_INVALID')` — which is a fallback trigger, not a return. */
  validate: (text: string) => T;
  ctx: AiCtx;
  deps: ChainDeps;
}

export async function runChain<T>({
  built,
  chain,
  timeoutMs,
  validate,
  ctx,
  deps,
}: RunChainArgs<T>): Promise<T> {
  const logger = deps.logger ?? noopLogger;
  const transports = deps.transports ?? DEFAULT_TRANSPORTS;
  const prices = deps.prices ?? loadModelPrices();
  const sleep = deps.sleep ?? realSleep;

  if (chain.length === 0) {
    throw new AiError(
      'AI_PROVIDER_UNAVAILABLE',
      `no provider in the chain for ${built.promptName} has a configured key`,
    );
  }

  let lastFailure: FailureKind | undefined;

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const attemptNo = i + 1;
    const fellBackFrom = i === 0 ? null : chain[i - 1].model;
    const base = {
      traceId: ctx.traceId,
      interviewId: ctx.interviewId,
      provider: step.provider,
      model: step.model,
      promptUuid: built.promptUuid,
      promptVersion: built.promptVersion,
      attemptNo,
    };

    logger.info(base, 'LLM_CALL_STARTED');

    const startedAt = Date.now();
    let response: ProviderResponse | undefined;
    let value: T | undefined;
    let failure: FailureKind | undefined;

    try {
      response = await callWithTimeout(transports, step, built, deps.keys, timeoutMs);
      // Step 7 of B1. A schema failure is a fallback trigger exactly like a 500 — but the
      // attempt still burned tokens, so it is recorded below before we fall through.
      value = validate(response.text);
    } catch (err) {
      failure = classify(err);
    }

    const latencyMs = Date.now() - startedAt;
    const cost = costFor(prices, step.provider, step.model, response ?? {});

    if (cost.costUsd === null) {
      logger.warn({ ...base, unitKind: DEFAULT_UNIT_KIND }, 'PRICE_MISSING');
    }

    await deps.recordLlmCall({
      interviewId: ctx.interviewId,
      provider: step.provider,
      model: step.model,
      promptUuid: built.promptUuid,
      promptVersion: built.promptVersion,
      attemptNo,
      fellBackFrom,
      units: cost.units,
      unitKind: cost.unitKind,
      inputTokens: response?.inputTokens ?? null,
      outputTokens: response?.outputTokens ?? null,
      costUsd: cost.costUsd,
      latencyMs,
      traceId: ctx.traceId,
    });

    if (failure === undefined) {
      logger.info(
        { ...base, latencyMs, costUsd: cost.costUsd, units: cost.units },
        'LLM_CALL_COMPLETED',
      );
      return value as T;
    }

    if (failure === 'schema') logger.warn(base, 'AI_OUTPUT_SCHEMA_INVALID');
    lastFailure = failure;

    const hasNext = i + 1 < chain.length;
    if (hasNext) {
      // §8.3: backoff before a rate-limit fall-through only. Backing off after a 500 or a
      // schema failure just delays a different provider that was never the one throttling.
      if (failure === 'rate_limit') await sleep(BACKOFF_BASE_MS * 2 ** i);
      logger.warn({ ...base, reason: failure }, 'LLM_FALLBACK_TRIGGERED');
    }
  }

  logger.warn(
    {
      traceId: ctx.traceId,
      interviewId: ctx.interviewId,
      promptUuid: built.promptUuid,
      attempts: chain.length,
      reason: lastFailure,
    },
    'AI_ALL_PROVIDERS_FAILED',
  );

  throw lastFailure === 'schema'
    ? new AiError('AI_OUTPUT_INVALID', `every provider returned schema-invalid output`)
    : new AiError('AI_PROVIDER_UNAVAILABLE', `every provider in the chain failed`);
}

/**
 * Bounded by a race rather than by the abort alone: the abort is what a well-behaved
 * transport honours, and the race is what guarantees "no unbounded wait" (§8.3) even for
 * one that does not.
 */
async function callWithTimeout(
  transports: Record<string, ProviderTransport>,
  step: ChainStep,
  built: BuiltPrompt,
  keys: ProviderKeys,
  timeoutMs: number,
): Promise<ProviderResponse> {
  const transport = transports[step.provider];
  if (!transport) {
    throw new ProviderCallError('http', `no transport registered for ${step.provider}`);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new ProviderCallError('timeout', `${step.provider} did not answer within ${timeoutMs}ms`),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      transport({
        provider: step.provider,
        model: step.model,
        system: built.system,
        messages: built.messages,
        params: built.params,
        apiKey: keys[step.provider] as string,
        signal: controller.signal,
      }),
      expiry,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classify(err: unknown): FailureKind {
  if (err instanceof ProviderCallError) return err.kind;
  if (err instanceof AiError && err.code === 'AI_OUTPUT_INVALID') return 'schema';
  // An aborted fetch surfaces as a DOMException named AbortError, not as our own error.
  if (err instanceof Error && err.name === 'AbortError') return 'timeout';
  return 'http';
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
