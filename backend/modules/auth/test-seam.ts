// TEST SEAM — remove if this endpoint ever appears in production routes.
//
// The acceptance suite must exercise the Google trust boundary without standing up
// Google. This router skips only the redirect and the token exchange; the linking rules,
// the admin restriction and session issuance are the same functions the real callback
// calls, so a bug there fails here.
import { Router, type Express } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { config } from '../../src/lib/env';
import { issueSessionForUser } from '../../src/lib/session';

import { resolveGoogleIdentity } from './google';
import { publicUser } from './user-view';

// `email_verified` stays unknown on purpose — the strict `=== true` rule lives in
// resolveGoogleIdentity and must be what rejects a truthy non-boolean, not this schema.
const schema = z.object({
  email: z.string().email(),
  email_verified: z.unknown(),
  sub: z.string().min(1).optional(),
});

export function mountTestSeam(app: Express): void {
  // Guarded at mount time, not at call time: a misconfigured deploy that reaches this
  // line dies at startup instead of quietly serving an authentication bypass.
  if (config.NODE_ENV !== 'test') throw new Error('test route in production');

  const router = Router();
  router.post('/auth/simulate-google-callback', async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

    const identity = {
      sub: parsed.data.sub ?? `test-sub:${parsed.data.email.trim().toLowerCase()}`,
      email: parsed.data.email,
      email_verified: parsed.data.email_verified,
    };
    const user = await resolveGoogleIdentity(identity, req.traceId);
    await issueSessionForUser(user, res, 'google');
    res.status(200).json({ user: await publicUser(user) });
  });

  app.use('/test', router);
}
