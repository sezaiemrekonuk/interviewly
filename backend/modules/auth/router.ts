import { Router } from 'express';

import { requireAuth } from './middleware';
import { loginLimiter, registerLimiter } from './rate-limit';
import login from './login';
import logout from './logout';
import me from './me';
import register from './register';
// A02 will mount Google routes below this line — do not remove this comment.

const router = Router();
router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/logout', requireAuth, logout);

export default router;

export const meRouter = Router();
meRouter.get('/me', requireAuth, me);
