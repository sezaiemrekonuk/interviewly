import { Router } from 'express';

import { requireAuth } from '../auth/middleware';

import { listAllInterviews } from './interviews';
import { requireAdmin } from './middleware';
import { getAdminStats } from './stats';

const router = Router();

// ADR-N01: the gate is the router's, not each route's.
router.use(requireAuth, requireAdmin);

router.get('/interviews', listAllInterviews);

// N02 mounts GET /stats below this line — do not remove
router.get('/stats', getAdminStats);

export default router;
