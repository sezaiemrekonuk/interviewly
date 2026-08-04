import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';

import { ApiError, httpStatusFor } from './lib/api-error';
import { config } from './lib/env';
import { logger } from './lib/logger';
import { liveness, readiness } from './lib/probes';

import adminRouter from '../modules/admin/router';
import { requireAuth } from '../modules/auth/middleware';
import authRouter, { meRouter } from '../modules/auth/router';
import { mountTestSeam } from '../modules/auth/test-seam';
import { listMyInterviews } from '../modules/interview/my-interviews';
import interviewRouter from '../modules/interview/router';
import { createUpload, uploadMiddleware } from '../modules/interview/uploads';
import reconcileWebhookRouter from '../modules/voice/reconcile-webhook';
import voiceRouter from '../modules/voice/session';
import voiceWebhookRouter from '../modules/voice/webhook-router';

export const app = express();

// V02: the ElevenLabs HMAC is computed over the bytes ElevenLabs sent, and `JSON.stringify`
// of the parsed body does not reproduce them. Mounted BEFORE the global parser — body-parser
// marks the request `_body` and the global instance then skips it, so /webhooks/* is parsed
// exactly once, here, with the raw buffer kept alongside.
app.use(
  '/webhooks',
  express.json({
    verify(req, _res, buf) {
      req.rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use((req, _res, next) => {
  req.traceId = randomUUID();
  next();
});

// Liveness: no dependency checks (a Postgres/Redis blip must not restart-loop a live
// process). Readiness pings both; NOT_READY leaks no connection detail (I14).
app.get('/healthz', (_req, res) => {
  res.status(200).json(liveness());
});
app.get('/readyz', async (_req, res) => {
  const { ready } = await readiness();
  if (ready) res.status(200).json({ ready: true });
  else res.status(503).json({ error: { code: 'NOT_READY' } });
});

app.use('/auth', authRouter);
app.use('/', meRouter);
app.get('/me/interviews', requireAuth, listMyInterviews);
app.post('/uploads', requireAuth, uploadMiddleware, createUpload);
app.use('/interviews', voiceRouter);
app.use('/interviews', interviewRouter);
// V04 before V02: `webhook-router`'s `/:action` matches `post_call` too, and would answer
// VALIDATION_ERROR before the reconciliation handler was ever reached.
app.use('/webhooks/elevenlabs', reconcileWebhookRouter);
app.use('/webhooks/elevenlabs', voiceWebhookRouter);
app.use('/admin', adminRouter);

// TEST SEAM — acceptance-only Google callback simulator. mountTestSeam() throws if it is
// ever reached outside NODE_ENV=test, so a bad deploy fails at startup, not silently.
if (config.NODE_ENV === 'test') mountTestSeam(app);

// The API never returns display strings — a known error code maps to its registry
// status; anything else is an unexpected 500 with no body detail.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(httpStatusFor(err.code)).json({ error: { code: err.code } });
    return;
  }
  logger.error(
    { traceId: req.traceId, name: err instanceof Error ? err.name : 'Unknown' },
    'UNHANDLED_ERROR',
  );
  res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
};
app.use(errorHandler);
