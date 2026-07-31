import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setWorldConstructor, World } from '@cucumber/cucumber';
import { parse } from 'yaml';
import {
  PromptBuilder,
  StubAiClient,
  createPromptBuilder,
  type BuiltPrompt,
  type Question,
} from '@interviewly/ai';

export const PROMPTS_DIR = join(__dirname, '../../../packages/ai/prompts');

/** One captured `logger.<level>({ fields }, "EVENT_NAME")` call. */
export interface CapturedEvent {
  level: 'info' | 'warn';
  event: string;
  fields: Record<string, unknown>;
}

/**
 * The §5.5 seam under test is `PromptBuilder` itself — no fake in front of it. A stub in
 * this position would return valid questions whatever the listing said and would prove
 * nothing about neutralisation (ai spec, Testing note §7.1).
 */
export class SecurityWorld extends World {
  events: CapturedEvent[] = [];

  /** Variables handed to the builder. Steps overwrite individual entries. */
  vars: Record<string, unknown> = {
    roundType: 'hr',
    count: 3,
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
    if (!this.batch) throw new Error('no question batch has been generated in this scenario');
    return this.batch;
  }
}

setWorldConstructor(SecurityWorld);
