/**
 * The §7.1 prompt-injection trust boundary. Every `AiClient` call compiles its messages
 * here, and `security.feature` asserts against this class DIRECTLY — a stub in front of it
 * would return valid questions whatever the listing said and would prove nothing.
 *
 * The pipeline is B1, in this fixed order:
 *   1. role separation  — user values reach user messages only; the system message is the
 *                         template verbatim
 *   2. neutralisation   — `<` → `&lt;`, `>` → `&gt;` inside every bound value
 *   3. truncation       — hard cut at 12 000 characters, logging LISTING_TRUNCATED
 *   4. null markers     — `no profile provided` / `no cv provided`, never an empty block
 *   4a. dob strip       — defence in depth; the alarm is the useful half
 *   5. binding          — `{{var}}` from the template's own placeholder set
 *   6. injection scan   — logs SECURITY_PROMPT_INJECTION_SUSPECTED, never blocks
 * Step 7 (output validation) belongs to the caller, against the method's Zod schema.
 */
import { AI_CHAT_DEBUG_EVENT, logAiCall } from './ai-debug';
import { AiError, noopLogger, type AiLogger } from './errors';
import { loadInjectionPatterns, type InjectionPattern } from './config';
import { loadPromptRegistry, type PromptFile, type PromptRegistry } from './registry';

export const MAX_BLOCK_CHARS = 12_000;

/** Content for a null value, per variable. Anything else null is a build failure. */
const NULL_MARKERS: Record<string, string> = {
  candidateProfile: 'no profile provided',
  candidateCv: 'no cv provided',
};

const DOB_KEYS = new Set(['dateOfBirth', 'date_of_birth']);
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface AiCtx {
  interviewId: string;
  traceId: string;
}

export interface BuiltPromptMessage {
  role: 'system' | 'user';
  content: string;
}

export interface BuiltPrompt {
  /**
   * The system message on its own. Duplicated inside `messages` on purpose: OpenAI wants it
   * as the first message, Gemini wants it as a separate `systemInstruction`, and I02 should
   * not have to dig it back out of the array.
   */
  system: string;
  messages: BuiltPromptMessage[];
  promptName: string;
  promptUuid: string;
  promptVersion: number;
  provider: string;
  model: string;
  params: Record<string, unknown>;
}

export interface BuildArgs {
  promptName: string;
  version?: number;
  vars: Record<string, unknown>;
  ctx: AiCtx;
}

export class PromptBuilder {
  constructor(
    private readonly registry: PromptRegistry,
    private readonly patterns: InjectionPattern[],
    private readonly logger: AiLogger = noopLogger,
  ) {}

  build({ promptName, version, vars, ctx }: BuildArgs): BuiltPrompt {
    const template = this.registry.resolve(promptName, version);
    const system = systemMessage(template, promptName);

    const messages: BuiltPromptMessage[] = [{ role: 'system', content: system }];
    const boundValues: { field: string; value: string }[] = [];

    for (const message of template.messages) {
      if (message.role === 'system') continue;
      messages.push({
        role: 'user',
        content: this.bind(message.content, vars, ctx, promptName, boundValues),
      });
    }

    this.scanForInjection(boundValues, ctx);

    logAiCall(this.logger, {
      event: AI_CHAT_DEBUG_EVENT,
      promptName: template.name,
      interviewId: ctx.interviewId,
      traceId: ctx.traceId,
      provider: template.provider,
      model: template.model,
      promptUuid: template.uuid,
      promptVersion: template.version,
      promptYaml: template.source,
      messages,
    });

    return {
      system,
      messages,
      promptName: template.name,
      promptUuid: template.uuid,
      promptVersion: template.version,
      provider: template.provider,
      model: template.model,
      params: template.params,
    };
  }

  /** Steps 2–5, per placeholder. The template's own text is never touched. */
  private bind(
    templateContent: string,
    vars: Record<string, unknown>,
    ctx: AiCtx,
    promptName: string,
    boundValues: { field: string; value: string }[],
  ): string {
    return templateContent.replace(PLACEHOLDER, (_match, field: string) => {
      if (!(field in vars)) {
        // An unbound placeholder is a build failure, not a call with a gap in it.
        throw new AiError(
          'AI_PROMPT_BUILD_FAILED',
          `prompt ${promptName} has no value for {{${field}}}`,
        );
      }
      const value = this.compileValue(field, vars[field], ctx, promptName);
      boundValues.push({ field, value });
      return value;
    });
  }

  private compileValue(
    field: string,
    raw: unknown,
    ctx: AiCtx,
    promptName: string,
  ): string {
    if (raw === null || raw === undefined) {
      const marker = NULL_MARKERS[field];
      if (marker === undefined) {
        throw new AiError(
          'AI_PROMPT_BUILD_FAILED',
          `prompt ${promptName} got a null {{${field}}} and no marker is defined for it`,
        );
      }
      return marker;
    }

    const text =
      typeof raw === 'object' ? JSON.stringify(this.stripDob(raw, ctx)) : String(raw);

    const neutralised = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (neutralised.length <= MAX_BLOCK_CHARS) return neutralised;

    this.logger.warn(
      {
        traceId: ctx.traceId,
        interviewId: ctx.interviewId,
        field,
        originalLen: neutralised.length,
      },
      'LISTING_TRUNCATED',
    );
    // ponytail: a hard cut can split a trailing `&lt;` into `&l`. Harmless — no bracket is
    // reconstructed and the block stays exactly MAX_BLOCK_CHARS, which is what @AC-4 asserts.
    // Trim to the last whole entity only if a model ever visibly trips over it.
    return neutralised.slice(0, MAX_BLOCK_CHARS);
  }

  /**
   * 4a — backend strips the date of birth before it ever reaches this module (§3.3). This
   * is the second lock: if one is still here, drop it and raise the alarm.
   */
  private stripDob(value: unknown, ctx: AiCtx): unknown {
    if (Array.isArray(value)) return value.map((v) => this.stripDob(v, ctx));
    if (value === null || typeof value !== 'object') return value;

    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (DOB_KEYS.has(key)) {
        this.logger.warn(
          { traceId: ctx.traceId, interviewId: ctx.interviewId, key },
          'PROFILE_DOB_STRIPPED',
        );
        continue;
      }
      out[key] = this.stripDob(nested, ctx);
    }
    return out;
  }

  /**
   * 6 — matched against the BOUND VALUES only, never the compiled message. Scanning the
   * whole message would match this package's own templates (they say "system prompt" out
   * loud) and every call would log a false positive.
   */
  private scanForInjection(
    boundValues: { field: string; value: string }[],
    ctx: AiCtx,
  ): void {
    for (const { field, value } of boundValues) {
      for (const pattern of this.patterns) {
        if (!pattern.regex.test(value)) continue;
        // Logged, never blocked (§7.1.5): the Zod output schema is the real barrier, and a
        // regex veto would kill legitimate interviews.
        this.logger.warn(
          {
            traceId: ctx.traceId,
            interviewId: ctx.interviewId,
            field,
            patternId: pattern.id,
          },
          'SECURITY_PROMPT_INJECTION_SUSPECTED',
        );
      }
    }
  }
}

/** The system message must be usable verbatim, so it may carry no placeholder at all. */
function systemMessage(template: PromptFile, promptName: string): string {
  const system = template.messages.find((m) => m.role === 'system');
  if (!system) {
    throw new AiError('AI_PROMPT_BUILD_FAILED', `prompt ${promptName} has no system message`);
  }
  PLACEHOLDER.lastIndex = 0;
  if (PLACEHOLDER.test(system.content)) {
    throw new AiError(
      'AI_PROMPT_BUILD_FAILED',
      `prompt ${promptName} has a placeholder in its system message; user content must never reach it`,
    );
  }
  return system.content;
}

export function createPromptBuilder(opts: { logger?: AiLogger } = {}): PromptBuilder {
  return new PromptBuilder(loadPromptRegistry(), loadInjectionPatterns(), opts.logger);
}
