import { Router } from 'express';

import { requireAuth } from '../auth/middleware';
import { adminStatsLimiter } from '../auth/rate-limit';
import { requirePublicOrigin } from '../interview/csrf';

import { getAdminInterview } from './interview-detail';
import { listAllInterviews } from './interviews';
import { requireAdmin } from './middleware';
import { requeueReport } from './report-requeue';
import { getAdminStats } from './stats';

const router = Router();

// ADR-N01: the gate is the router's, not each route's.
router.use(requireAuth, requireAdmin);

// Mounted the same way and for the same reason as on the interview router (I05): once, above
// the routes, so a state-changing admin route added later cannot ship without it. It exempts
// GET/HEAD/OPTIONS itself, so the two read endpoints below are unaffected — this covers the
// requeue, which is the first admin route that writes anything.
router.use(requirePublicOrigin);

router.get('/interviews', listAllInterviews);

// The per-call drill-down (US-26/28/29). Above the requeue only by convention — Express
// matches on method, and the two cannot collide.
router.get('/interviews/:id', getAdminInterview);

// Issue 081: the only operational action on this router. A lost report job has no other way
// back — see the module header.
router.post('/interviews/:id/report/requeue', requeueReport);

// N02 mounts GET /stats below this line — do not remove
// Issue 85: per-admin limiter, mounted on this route rather than the router — the two other
// admin endpoints are cheap, and a shared budget would let a dashboard refresh lock an
// operator out of the requeue that fixes a stuck report.
router.get('/stats', adminStatsLimiter, getAdminStats);

export default router;
