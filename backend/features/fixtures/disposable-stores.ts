/**
 * Issues #170 and #119 — the check that keeps an acceptance run off the application's stores.
 *
 * Both rings write for real: the auth ring TRUNCATEs `users`, `sessions` and `email_tokens`
 * between scenarios, and the default ring creates interviews, enqueues report jobs and writes
 * rate-limit keys. Neither can clean up after itself in a store it shares with the running
 * product, because it cannot tell its own rows from anyone else's.
 *
 * `cucumber.js` resolves both URLs to disposable targets before `loadEnvFile`, so the repo-root
 * `.env` can no longer supply the compose stack. This module is the second half: a URL can
 * still arrive from a shell export or a CI job, and the run should refuse to start rather than
 * discover the mistake in the data afterwards.
 *
 * Shared by both profiles on purpose. A guard that differs per ring is a guard with a hole:
 * this rule lived only in `backend/tests/support/harness.ts`, which the `default` profile never
 * loads, and the 26 fixture interviews stranded in `evaluating` (#170) were all written by that
 * ring while the auth ring was correctly refusing the same database.
 *
 * Deliberately imports nothing. It runs before `env.ts` has validated a key, from call sites
 * that must not drag the app's module graph in behind it.
 */

/** Postgres database name: the last path segment, without a query string. */
export function databaseName(url: string): string {
  return url.split('?')[0]!.split('/').pop() ?? '';
}

/**
 * Redis logical database index. `redis://host:port` selects db 0 — the one the application
 * uses — and only an explicit `/n` path moves off it.
 */
export function redisDbIndex(url: string): number {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    // An unparseable URL is a configuration error, but not this module's to report: ioredis
    // gives a better message. Treat it as db 0 so the caller still refuses to run.
    return 0;
  }
  const index = Number(path.replace(/^\//, ''));
  return Number.isInteger(index) ? index : 0;
}

/**
 * The rule is by database NAME, because that is the part a human reads before pasting a URL.
 * CI's database is literally `ci`; local acceptance uses `interviewly_test` (db/init.sql
 * creates it). Anything else must opt in out loud.
 */
export function assertDisposableDatabase(url: string): void {
  if (process.env.ACCEPTANCE_ALLOW_DESTRUCTIVE_DB === '1') return;
  const name = databaseName(url);
  if (/(^|[_-])(test|ci)$/.test(name)) return;
  throw new Error(
    `Refusing to run a destructive suite against database "${name}": acceptance TRUNCATEs ` +
      `users, sessions and email_tokens between scenarios, and the vitest integration ring ` +
      `creates users, interviews and personas it does not remove. Point DATABASE_URL (or ` +
      `TEST_DATABASE_URL) at a database whose name ends in _test or ci — db/init.sql creates ` +
      `interviewly_test — or set ACCEPTANCE_ALLOW_DESTRUCTIVE_DB=1 if you meant it.`,
  );
}

/**
 * Redis has no names, only numbered databases, so the rule is the index. Db 0 is the
 * application's: `backend/src/lib/env.ts` validates a URL without a path and every service in
 * `compose.yaml` lands there. The suite gets any other index, and `BeforeAll` FLUSHDBs it —
 * which is why this must be proven before the flush runs, not after.
 *
 * In practice `cucumber.js` has already moved a db-0 URL to db 1, so this should never fire on
 * a normal run. It is here for the paths that do not go through that file, and because a flush
 * guarded by nothing but an earlier line in a different file is not guarded.
 */
export function assertDisposableRedis(url: string): void {
  if (process.env.ACCEPTANCE_ALLOW_DESTRUCTIVE_DB === '1') return;
  if (redisDbIndex(url) !== 0) return;
  throw new Error(
    `Refusing to run acceptance against Redis database 0: that is the application's, and the ` +
      `suite flushes the database it runs against. Point REDIS_URL (or TEST_REDIS_URL) at a ` +
      `non-zero index, e.g. redis://localhost:6380/1.`,
  );
}

/** Both checks over the resolved environment. Call once, before the first scenario writes. */
export function assertDisposableStores(): void {
  assertDisposableDatabase(process.env.DATABASE_URL ?? '');
  assertDisposableRedis(process.env.REDIS_URL ?? '');
}
