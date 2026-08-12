import type { RequestHandler } from 'express';

import { resetProfiler, snapshot } from '../../src/lib/profiler';

export const getPerfSnapshot: RequestHandler = (_req, res) => {
  res.json(snapshot());
};

export const resetPerfWindow: RequestHandler = (_req, res) => {
  const previous = snapshot();
  resetProfiler();
  res.json({ reset: true, previous });
};
