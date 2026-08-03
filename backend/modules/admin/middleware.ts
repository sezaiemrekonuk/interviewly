import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';

// ADR-N01: mounted once on the admin router, never per handler, so a route added later
// cannot ship without the gate. Reads the role `requireAuth` resolved — it is always
// mounted after it. A non-admin is 403 FORBIDDEN, not 404: /admin/* is known to exist,
// only the role is wrong (the opposite call from the interview `:id` resolver).
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'admin') {
    next(new ApiError('FORBIDDEN'));
    return;
  }
  next();
};
