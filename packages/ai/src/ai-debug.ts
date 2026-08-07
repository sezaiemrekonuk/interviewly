import { noopLogger, type AiLogger } from './errors';

export const AI_CHAT_DEBUG_EVENT = 'AI_PROMPT_BUILDER_DEBUG';
export const AI_VOICE_DEBUG_EVENT = 'AI_VOICE_GENERATION_DEBUG';

export interface AiDebugMessage {
  role: string;
  content: string;
}

export interface AiDebugCall {
  event: string;
  promptName: string;
  interviewId: string;
  traceId: string;
  provider: string;
  model: string;
  promptUuid?: string;
  promptVersion?: number;
  promptYaml?: string;
  messages: AiDebugMessage[];
}

export function logAiCall(logger: AiLogger | undefined, call: AiDebugCall): void {
  const { event, messages, ...fields } = call;
  const sink = logger ?? noopLogger;
  messages.forEach((message, index) => {
    sink.info(
      {
        ...fields,
        messageIndex: index,
        messageCount: messages.length,
        role: message.role,
        content: message.content,
        promptMessages: messages,
      },
      event,
    );
  });
}
