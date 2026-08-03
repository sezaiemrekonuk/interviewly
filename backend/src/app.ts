import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';

import { ApiError, httpStatusFor } from './lib/api-error';
import { config } from './lib/env';
import { logger } from './lib/logger';

import adminRouter from '../modules/admin/router';
import { requireAuth } from '../modules/auth/middleware';
import authRouter, { meRouter } from '../modules/auth/router';
import { mountTestSeam } from '../modules/auth/test-seam';
import { listMyInterviews } from '../modules/interview/my-interviews';
import interviewRouter from '../modules/interview/router';
import { createUpload, uploadMiddleware } from '../modules/interview/uploads';
import voiceRouter from '../modules/voice/session';
import voiceWebhookRouter from '../modules/voice/webhook-router';

export const app = express();

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

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/', meRouter);
app.get('/me/interviews', requireAuth, listMyInterviews);
app.post('/uploads', requireAuth, uploadMiddleware, createUpload);
app.use('/interviews', voiceRouter);
app.use('/interviews', interviewRouter);
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
