// K6 logger contract: logger.<level>({ traceId, interviewId, ...fields }, "EVENT_NAME")
// Both traceId and interviewId are mandatory on interview-scoped lines.
// No secrets, PII, tokens, or PDF content in any log call.
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.LOG_TRANSPORT === 'elastic'
    ? { transport: { target: 'pino-elasticsearch', options: { node: process.env.ELASTICSEARCH_URL } } }
    : {}),
});
