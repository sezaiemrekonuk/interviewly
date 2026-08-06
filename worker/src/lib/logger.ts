// K6 logger contract: logger.<level>({ traceId, interviewId, ...fields }, "EVENT_NAME")
// Both traceId and interviewId are mandatory on interview-scoped lines.
// No secrets, PII, tokens, or PDF content in any log call.
import pino from 'pino';

function serialisable(value: unknown): unknown {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  return value;
}

export function foldFields(args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (typeof first === 'string') return [{ title: first }, '{}'];
  if (typeof first !== 'object' || first === null || first instanceof Error) return args;

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(first as Record<string, unknown>)) {
    fields[key] = serialisable(value);
  }
  const title = typeof rest[0] === 'string' ? rest[0] : '';
  return [{ title }, JSON.stringify(fields)];
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  hooks: {
    logMethod(args, method) {
      return method.apply(this, foldFields(args) as Parameters<typeof method>);
    },
  },
  ...(process.env.LOG_TRANSPORT === 'elastic'
    ? {
        transport: {
          targets: [
            { target: 'pino/file', options: { destination: 1 } },
            {
              target: 'pino-elasticsearch',
              options: { node: process.env.ELASTICSEARCH_URL, index: 'interviewly-%{DATE}' },
            },
          ],
        },
      }
    : {}),
});
