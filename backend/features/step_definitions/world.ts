import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setWorldConstructor, World } from '@cucumber/cucumber';
import { parse } from 'yaml';
import {
  ModelPrices,
  PROMPT_NAMES,
  ProviderCallError,
  PromptBuilder,
  StubAiClient,
  createPromptBuilder,
  loadModelPrices,
  questionVars,
  resolveAiClient,
  type AiClient,
  type BuiltPrompt,
  type ChainDeps,
  type KeyValidation,
  type LlmCallRecord,
  type ProviderKeys,
  type ProviderResponse,
  type ProviderTransport,
  type Question,
} from '@interviewly/ai';

import { roundQuestionArgs } from '../../modules/interview/generation';
import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';

import { serverState } from './server';

export const PROMPTS_DIR = join(__dirname, '../../../packages/ai/prompts');

/** One captured `logger.<level>({ fields }, "EVENT_NAME")` call. */
export interface CapturedEvent {
  level: 'info' | 'warn';
  event: string;
  fields: Record<string, unknown>;
}

/** What the fake tier-1 provider does on its next call — the `ai_provider.feature` axis. */
export type Tier1Outcome =
  | 'succeed'
  | 'return an HTTP error'
  | 'time out'
  | 'be rate limited'
  | 'return invalid schema';

const HR_COUNT = 3;

/**
 * One World, because cucumber has one world constructor for the whole run.
 *
 * It carries two seams, at two different depths (§5.5):
 *
 *  - `security.feature` asserts against `PromptBuilder` DIRECTLY, with no fake in front of
 *    it. A stub in that position returns valid questions whatever the listing said and
 *    proves nothing about neutralisation (ai spec, Testing note §7.1).
 *  - `ai_provider.feature` fakes only the network — `ProviderTransport` — so the chain, the
 *    per-attempt `llm_calls` row and the cost computation under test are the real ones.
 *    Faking `AiClient` there would test the fake.
 *
 * `llm_calls` rows are collected in memory rather than written to Postgres: this ledger's
 * assertions are about which rows the chain produces, and the F02 insert that stores them is
 * one `writeLlmCall` mapping away in `backend/modules/ai`.
 */
export class AiWorld extends World {
  events: CapturedEvent[] = [];

  /** Variables handed to the builder. Steps overwrite individual entries. */
  vars: Record<string, unknown> = {
    roundType: 'hr',
    count: HR_COUNT,
    language: 'en',
    jobListing: 'We are hiring a backend engineer with Postgres experience.',
    candidateProfile: null,
    candidateCv: null,
    priorTopics: 'none',
    transcript: 'Q: Tell me about yourself. A: I build backend services.',
    perAnswerScores: 'none',
  };

  ctx = { interviewId: 'itv_security_test', traceId: 'trace_security_test' };

  built?: BuiltPrompt;
  batch?: Question[];

  // -------------------------------------------------------------- interview HTTP fixtures
  // I03: question_generation.feature drives the real Express app over HTTP (server.ts),
  // not a package-level seam. One cookie jar per scenario — good enough for the single
  // signed-in candidate every scenario in this file needs so far.

  cookie = '';
  candidateId = '';
  interviewId = '';
  lastStatus = 0;
  lastBody: Record<string, unknown> | undefined;

  // N01: admin_cost.feature is the first scenario with three actors (owner, another
  // candidate, admin), so the single jar above cannot carry it. Steps park each session
  // here and assign `cookie` to switch actor.
  actors: Record<string, string> = {};

  /** N01: the fixture cost the admin audit must read back unchanged after a soft delete. */
  recordedCost?: { costUsd: string; totalTokens: number };

  /** N02 AC-18: llm_calls token sum before the scenario fixture inserts new rows. */
  tokenBaseline = 0;

  // I04: the body `POST /interviews/:id/profile` will be sent with — `{ skip: true }` until a
  // scenario answers the pre-questions. The two profiling.feature paths differ only here.
  profileBody: Record<string, unknown> = { skip: true };
  /** Seeded `users.profile` values a scenario later asserts must not (or must) reach a prompt. */
  accountDob = '';
  accountFullName = '';
  accountCvText = '';

  /**
   * Injected into `generateRound` when a scenario needs a client that misbehaves in a way
   * `StubAiClient` cannot be asked for. `undefined` means the module's own client.
   */
  roundClient: AiClient | undefined;

  /**
   * The HTTP-ring twin of `generateHrRound()`. `POST /interviews/:id/profile` is what
   * generates the HR batch, and the prompt it compiled lives and dies inside the request —
   * so the same prompt is compiled alongside it, from the production var mapping and the
   * snapshot the handler stored. Any drift between the two is a drift in `roundQuestionArgs`,
   * which is the thing under test.
   */
  async generateHrRoundOverHttp(): Promise<void> {
    this.resetEvents();
    await this.httpPost(`/interviews/${this.interviewId}/profile`, this.profileBody);

    const interview = await prisma.interview.findUniqueOrThrow({
      where: { id: this.interviewId },
    });
    this.ctx = { interviewId: this.interviewId, traceId: `trace-${this.interviewId}` };
    this.built = this.builder().build({
      promptName: PROMPT_NAMES.generateRoundQuestions,
      vars: questionVars(roundQuestionArgs(interview, 'hr', this.ctx)),
      ctx: this.ctx,
    });
  }

  private captureCookie(res: Response): void {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie[0]) this.cookie = setCookie[0].split(';')[0];
  }

  // I05: `extra` overrides the default same-site origin — the CSRF scenarios are the only
  // callers that send anything else, so every other step keeps sending a valid request.
  async httpPost(path: string, body: unknown, extra: Record<string, string> = {}): Promise<void> {
    const res = await fetch(`${serverState.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: config.PUBLIC_ORIGIN,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...extra,
      },
      body: JSON.stringify(body),
    });
    this.captureCookie(res);
    this.lastStatus = res.status;
    this.lastBody = await res.json().catch(() => undefined);
  }

  async httpGet(path: string): Promise<void> {
    const res = await fetch(`${serverState.baseUrl}${path}`, {
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    this.captureCookie(res);
    this.lastStatus = res.status;
    this.lastBody = await res.json().catch(() => undefined);
  }

  // N01. State-changing, so it carries the same-site origin `requirePublicOrigin` demands.
  async httpDelete(path: string): Promise<void> {
    const res = await fetch(`${serverState.baseUrl}${path}`, {
      method: 'DELETE',
      headers: {
        origin: config.PUBLIC_ORIGIN,
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
    });
    this.captureCookie(res);
    this.lastStatus = res.status;
    this.lastBody = await res.json().catch(() => undefined);
  }

  // -------------------------------------------------------------- ai_provider fixtures

  aiEnabled = true;
  tier1Outcome: Tier1Outcome = 'succeed';
  keys: ProviderKeys = { openai: 'test-openai-key', google: 'test-google-key' };
  prices: ModelPrices = loadModelPrices();
  llmCalls: LlmCallRecord[] = [];
  boot?: KeyValidation;
  bootError?: unknown;
  generateError?: unknown;

  readonly logger = {
    info: (fields: Record<string, unknown>, event: string) =>
      this.events.push({ level: 'info', event, fields }),
    warn: (fields: Record<string, unknown>, event: string) =>
      this.events.push({ level: 'warn', event, fields }),
  };

  builder(): PromptBuilder {
    return createPromptBuilder({ logger: this.logger });
  }

  stub(): StubAiClient {
    return new StubAiClient({ builder: this.builder() });
  }

  /**
   * Every action step starts from a clean capture, so "no X event is emitted" means
   * "this action emitted none" rather than "none since the scenario began".
   */
  resetEvents(): void {
    this.events = [];
  }

  eventsNamed(name: string): CapturedEvent[] {
    return this.events.filter((e) => e.event === name);
  }

  // -------------------------------------------------------------- the provider seam

  /**
   * Tier-1 is `openai` because the prompt file says so (K9); tier-2 is `google` because the
   * chain says so (B6). Tier-2 always succeeds — the scenarios are about what tier-1 does.
   */
  transports(): Record<string, ProviderTransport> {
    return {
      openai: async () => {
        switch (this.tier1Outcome) {
          case 'return an HTTP error':
            throw new ProviderCallError('http', 'openai responded 500');
          case 'time out':
            throw new ProviderCallError('timeout', 'openai did not answer in time');
          case 'be rate limited':
            throw new ProviderCallError('rate_limit', 'openai rate limited the request');
          case 'return invalid schema':
            // Tokens on purpose: a schema-invalid answer still costs money, and the point of
            // the per-attempt row is that this cost is not swallowed by the retry.
            return { text: '{"questions":[{"nope":true}]}', inputTokens: 900, outputTokens: 120 };
          default:
            return questionBatchBody();
        }
      },
      google: async () => questionBatchBody(),
    };
  }

  chainDeps(): ChainDeps {
    return {
      recordLlmCall: async (record) => {
        this.llmCalls.push(record);
      },
      keys: this.keys,
      logger: this.logger,
      transports: this.transports(),
      prices: this.prices,
      // The backoff is asserted nowhere and costs half a second per rate-limit scenario.
      sleep: async () => undefined,
    };
  }

  client(): AiClient {
    return resolveAiClient({ AI_ENABLED: this.aiEnabled }, this.chainDeps(), {
      builder: this.builder(),
    });
  }

  /**
   * The one generation action both feature files drive. `security.feature` cares that it
   * crosses the trust boundary; `ai_provider.feature` cares what the chain recorded.
   */
  async generateHrRound(): Promise<void> {
    // Compiled separately so the security assertions can read the exact same prompt the call
    // compiled internally, without bolting a test-only accessor onto AiClient.
    this.built = this.builder().build({
      promptName: 'interview.question.generate',
      vars: this.vars,
      ctx: this.ctx,
    });

    this.resetEvents();
    this.llmCalls = [];
    this.generateError = undefined;

    try {
      const batch = await this.client().generateRoundQuestions({
        roundType: 'hr',
        count: HR_COUNT,
        jobListing: this.vars.jobListing as string,
        candidateProfile: null,
        candidateCv: null,
        language: 'en',
        ctx: this.ctx,
      });
      this.batch = batch.questions;
    } catch (err) {
      this.generateError = err;
      this.batch = undefined;
    }
  }

  // -------------------------------------------------------------- helpers

  /** The system message exactly as it sits on disk — the byte-identity reference. */
  templateSystemMessage(promptName: string): string {
    const file = parse(readFileSync(join(PROMPTS_DIR, `${promptName}.prompt.yaml`), 'utf8')) as {
      messages: { role: string; content: string }[];
    };
    const system = file.messages.find((m) => m.role === 'system');
    if (!system) throw new Error(`prompt ${promptName} has no system message`);
    return system.content;
  }

  /** The whole compiled user side, concatenated in order. */
  userText(): string {
    return this.requireBuilt()
      .messages.filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');
  }

  /** Content between `<name>` and `</name>` in the compiled user messages. */
  blockContent(name: string): string {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(this.userText());
    if (!match) throw new Error(`no <${name}> block in the compiled user message`);
    return match[1];
  }

  requireBuilt(): BuiltPrompt {
    if (!this.built) throw new Error('no prompt has been built in this scenario');
    return this.built;
  }

  requireBatch(): Question[] {
    if (!this.batch) {
      throw new Error(
        this.generateError
          ? `generation failed: ${String(this.generateError)}`
          : 'no question batch has been generated in this scenario',
      );
    }
    return this.batch;
  }
}

function questionBatchBody(): ProviderResponse {
  return {
    text: JSON.stringify({
      questions: Array.from({ length: HR_COUNT }, (_, i) => ({
        text: `Fake HR question ${i + 1}?`,
        kind: 'behavioral',
        difficulty: 'medium',
        topic: `topic-${i + 1}`,
        orderIndex: i + 1,
      })),
    }),
    inputTokens: 1200,
    outputTokens: 300,
  };
}

setWorldConstructor(AiWorld);
