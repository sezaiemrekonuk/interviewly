import type { RequestHandler } from 'express';

import { publicUser } from './user-view';

// optionalAuth runs before this handler: req.user is set when a valid session exists and
// unset otherwise. "Who am I" answered "nobody" is a 200 with a null user, not a 401 — the
// probe granted no access either way.
export const me: RequestHandler = async (req, res) => {
  res.status(200).json({ user: req.user ? await publicUser(req.user) : null });
};

export default me;
