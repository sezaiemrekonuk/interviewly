import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';

import { ApiError, httpStatusFor } from './lib/api-error';
import { config } from './lib/env';
import { logger } from './lib/logger';
import { liveness, readiness } from './lib/probes';
import { runWithRequestContext } from './lib/request-context';

import adminRouter from '../modules/admin/router';
import { requireAuth } from '../modules/auth/middleware';
import authRouter, { meRouter } from '../modules/auth/router';
import { mountTestSeam } from '../modules/auth/test-seam';
import { requirePublicOrigin } from '../modules/interview/csrf';
import { listMyInterviews } from '../modules/interview/my-interviews';
import { listMyQuestions } from '../modules/interview/my-questions';
import interviewRouter from '../modules/interview/router';
import { createUpload, uploadMiddleware } from '../modules/interview/uploads';
import speechRouter from '../modules/speech/router';
import voiceDowngradeRouter from '../modules/voice/downgrade';

export const app = express();

// Issue 68: without this, `req.ip` is Caddy's container address and every IP-keyed limiter
// in A01 shares one bucket — three registrations anywhere lock out the whole internet.
// The hop count, never `true`: `1` reads the entry one hop from our socket, so a client that
// prepends its own X-Forwarded-For cannot rotate its rate-limit key. Bump the number if a
// second proxy layer is ever added in front of Caddy (Caddyfile is the only hop today).
// TRUST_PROXY is configurable so operators can set it to `false` (or `0`) when port 4000
// is reachable without the edge proxy (compose.dev.yaml exposes it directly), preventing
// clients from spoofing X-Forwarded-For and rotating their rate-limit bucket.
const rawTrustProxy = config.TRUST_PROXY;
const trustProxyNum = Number(rawTrustProxy);
app.set('trust proxy', isNaN(trustProxyNum) ? rawTrustProxy : trustProxyNum);

app.use(express.json());
app.use(cookieParser());
app.use((req, _res, next) => {
  req.traceId = randomUUID();
  // `req.path`, never `originalUrl`: a query string carries verification and reset tokens,
  // and this object is folded into every log line the request goes on to write.
  runWithRequestContext(
    {
      traceId: req.traceId,
      userAgent: req.get('user-agent'),
      ip: req.ip,
      method: req.method,
      path: req.path,
    },
    next,
  );
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
app.get('/me/questions', requireAuth, listMyQuestions);
// The one state-changing route with no router of its own, so its guard is per-route by
// necessity — first in the chain, so a cross-site request never reaches multer's parser.
app.post('/uploads', requirePublicOrigin, requireAuth, uploadMiddleware, createUpload);
app.use('/interviews', voiceDowngradeRouter);
app.use('/interviews', speechRouter);
app.use('/interviews', interviewRouter);
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
