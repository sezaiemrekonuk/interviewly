import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { config } from '../../src/lib/env';

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// GET/HEAD change no state, and HEAD is routed to the GET handler; OPTIONS is answered by
// the router itself. Exempting them here is what lets this be mounted once for the whole
// router (I05) instead of per route — and keeps the SSE stream and /report/download working.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Every state-changing interview route runs this before the handler. Origin, falling back
// to Referer, must equal config.PUBLIC_ORIGIN — a browser always sends one of the two on a
// cross-site request, so a missing/mismatched pair is rejected rather than assumed same-site.
export const requirePublicOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const header = req.header('origin') ?? req.header('referer');
  const origin = header ? originOf(header) : null;
  if (origin !== config.PUBLIC_ORIGIN) {
    next(new ApiError('CSRF_ORIGIN_MISMATCH'));
    return;
  }
  next();
};
