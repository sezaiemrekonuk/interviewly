import { Router } from 'express';

import { requireAuth } from './middleware';
import { loginLimiter, registerLimiter } from './rate-limit';
import login from './login';
import logout from './logout';
import me from './me';
import register from './register';
// A02 will mount Google routes below this line — do not remove this comment.
import { googleCallback, startGoogle } from './google';
import { confirmVerification, requestVerification } from './verify-email';

const router = Router();
router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/logout', requireAuth, logout);
router.get('/google', startGoogle);
router.get('/google/callback', googleCallback);
// Request is authenticated (it resends to *your* address); confirm is not — the link is
// opened wherever the mail was read. Both limits on the resend are keyed by user, inside
// the handler, so there is no IP-keyed middleware in this pair.
router.post('/verify-email/request', requireAuth, requestVerification);
router.post('/verify-email/confirm', confirmVerification);

export default router;

export const meRouter = Router();
meRouter.get('/me', requireAuth, me);
