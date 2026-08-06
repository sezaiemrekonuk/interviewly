import type { RequestHandler } from 'express';

import { googleConfigured } from './google';

/**
 * `GET /auth/capabilities` — which sign-in paths this deployment can actually serve.
 *
 * Public and unauthenticated by design: it names no account and carries no secret, only
 * whether a credential exists at all, which the presence of a working Google button already
 * announces to anyone who looks. Nothing here is worth a rate limit — it reads config, not
 * a database.
 *
 * A build-time `NEXT_PUBLIC_*` flag was the cheaper-looking alternative and would not have
 * worked: `frontend/Dockerfile` builds without the env file, so the flag would inline as
 * `undefined` and hide the button on the deployments that *do* have Google configured. The
 * frontend has to ask at runtime, which is what this endpoint is for.
 */
export const authCapabilities: RequestHandler = (_req, res) => {
  res.json({ oauth: { google: googleConfigured() } });
};
