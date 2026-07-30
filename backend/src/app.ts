import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';

import { ApiError, httpStatusFor } from './lib/api-error';
import { logger } from './lib/logger';

import authRouter, { meRouter } from '../modules/auth/router';

export const app = express();

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
