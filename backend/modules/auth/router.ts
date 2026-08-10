import { Router } from 'express';

import { requirePublicOrigin } from '../interview/csrf';

import { authCapabilities } from './capabilities';
import { requireAuth } from './middleware';
import { loginLimiter, passwordResetLimiter, profilePatchLimiter, registerLimiter } from './rate-limit';
import deleteMe from './delete-account';
import { patchMyLocale } from './locale';
import login from './login';
import logout from './logout';
import me from './me';
import { completeOnboarding, getMyProfile, patchMyProfile } from './profile';
import register from './register';
// A02 will mount Google routes below this line — do not remove this comment.
import { googleCallback, startGoogle } from './google';
import { confirmPasswordReset, requestPasswordReset } from './password-reset';
import { confirmVerification, requestVerification } from './verify-email';

const router = Router();
// I05: mounted once, above the routes, so a state-changing auth route added later cannot
// ship without it (issue 67 — this router was one of the four that had). GET/HEAD/OPTIONS
// are exempt, so /capabilities and the two Google redirects are untouched. The two confirm
// routes are POSTed by our own token pages, not by the mail client, so their Origin is
// PUBLIC_ORIGIN like any other.
router.use(requirePublicOrigin);
router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/logout', requireAuth, logout);
// Public: the sign-in screen asks this before it offers a provider button, so it has to be
// answerable by a visitor who has no session yet (issue 60).
router.get('/capabilities', authCapabilities);
router.get('/google', startGoogle);
router.get('/google/callback', googleCallback);
// Request is authenticated (it resends to *your* address); confirm is not — the link is
// opened wherever the mail was read. Both limits on the resend are keyed by user, inside
// the handler, so there is no IP-keyed middleware in this pair.
router.post('/verify-email/request', requireAuth, requestVerification);
router.post('/verify-email/confirm', confirmVerification);
// Both public: whoever lost the password cannot be signed in, and the confirm link is opened
// wherever the mail was read. The request limit is keyed by IP (K8.6) — a per-user limiter
// would leak which addresses have accounts through its own 429.
router.post('/password-reset/request', passwordResetLimiter, requestPasswordReset);
router.post('/password-reset/confirm', confirmPasswordReset);

export default router;

export const meRouter = Router();
// Same single mount, one difference: the `/me` prefix is load-bearing. This router is
// mounted at `/` (app.ts), so a pathless `use` would run on every request the app receives —
// including the routers mounted after it, which own their guard.
// `/me` is the prefix of every route below, so this still covers the whole router.
meRouter.use('/me', requirePublicOrigin);
// Hard auth, deliberately. A soft probe that answers 200 { user: null } for a session that no
// longer resolves is indistinguishable from "signed out cleanly": it hides a revoked session
// (AC-26) and an erased account (KVKK), and `useRequireAuth` routes on UNAUTHENTICATED, so a
// 200 leaves a protected page rendered for nobody. The console line the 401 costs anonymously
// is worth that.
meRouter.get('/me', requireAuth, me);
// A06: the account profile (K8.7, §3.3 layer 1). PATCH is rate-limited per user, not per
// IP — the endpoint is authenticated, so the account is the thing worth protecting.
meRouter.get('/me/profile', requireAuth, getMyProfile);
meRouter.patch('/me/profile', requireAuth, profilePatchLimiter, patchMyProfile);
meRouter.post('/me/profile/complete', requireAuth, completeOnboarding);
// Issue 76 — the account's language, for the surfaces the browser does not render (mail and
// the interview). Shares `profilePatchLimiter`'s per-user budget: both are small authenticated
// writes to the same row, and a switcher click is orders of magnitude rarer than a card save.
meRouter.patch('/me/locale', requireAuth, profilePatchLimiter, patchMyLocale);
// Issue 009 — KVKK/GDPR erasure. Unlimited on purpose: an erasure request is a right, and a
// rate limit on it is a limit on exercising the right. It is idempotent in effect anyway —
// the session it needs is revoked by the first call.
meRouter.delete('/me', requireAuth, deleteMe);
