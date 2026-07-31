import type { RequestHandler } from 'express';

import { publicUser } from './user-view';

// requireAuth runs before this handler and attaches req.user.
export const me: RequestHandler = (req, res) => {
  res.status(200).json({ user: publicUser(req.user!) });
};

export default me;
