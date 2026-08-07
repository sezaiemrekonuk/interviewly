/**
 * Side-effect-free entry point for `@interviewly/backend` consumed from outside this
 * workspace (R01: `worker/`). `src/index.ts` is not it — that file calls `app.listen()` and
 * `process.exit()` on a missing AI key, both of which a bare `import` must never trigger.
 *
 * Mirrors `@interviewly/ai`'s `dist/index.js` `main` entry: a compiled barrel, not raw
 * source, so the production worker image never needs `backend/modules` on disk to resolve
 * subpaths it was never granted.
 */
export { runReport, type ReportOpts } from '../modules/interview/report-run';
export { REPORT_JOB_OPTIONS, REPORT_QUEUE, reportQueue } from './lib/queue';
// R03: the dead-letter transition. K2 — the worker never writes `interviews.state` any other way.
export { applyTransition } from '../modules/interview/machine';
// R02: the worker stores the rendered report PDF through I12's wrapper rather than building a
// second S3 client. `setStorage` travels with it so the worker's own rings can swap the store.
export { MAX_TTL_SECONDS, setStorage, storage, type Storage } from './lib/storage';
// Not used by `worker/src/consumer.ts` (which only calls `runReport`) — exported so the
// worker's own integration test can seed a fixture interview and assert the row `runReport`
// wrote, without a second `PrismaClient` and a second connection pool.
export { prisma } from './lib/db';

