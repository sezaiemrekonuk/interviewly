/**
 * Issues #170 and #119. The cases below are the URLs that actually caused the bug, not
 * invented ones: `.env`'s `db:5432/interviewly` is what stranded 26 fixture interviews in the
 * application's `evaluating`, and `cache:6379` is the db-0 keyspace the suite's dead-lettered
 * report jobs landed in. A guard is only worth its cost if it refuses those two exactly.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import {
  assertDisposableDatabase,
  assertDisposableRedis,
  databaseName,
  redisDbIndex,
} from './disposable-stores';

const ENV_URL = 'postgresql://interviewly:interviewly@db:5432/interviewly';
const ENV_REDIS = 'redis://cache:6379';

afterEach(() => {
  delete process.env.ACCEPTANCE_ALLOW_DESTRUCTIVE_DB;
});

describe('assertDisposableDatabase', () => {
  it('refuses the application database named by the repo-root .env', () => {
    expect(() => assertDisposableDatabase(ENV_URL)).toThrow(/Refusing to run acceptance/);
  });

  it('accepts the local acceptance database and CI’s', () => {
    expect(() =>
      assertDisposableDatabase('postgresql://interviewly:interviewly@localhost:5432/interviewly_test'),
    ).not.toThrow();
    expect(() => assertDisposableDatabase('postgresql://ci:ci@localhost:5432/ci')).not.toThrow();
  });

  it('reads the name past a query string, so ?schema=public cannot smuggle one through', () => {
    expect(databaseName('postgresql://h/interviewly?schema=public')).toBe('interviewly');
    expect(() => assertDisposableDatabase('postgresql://h/interviewly?schema=public')).toThrow();
  });

  it('lets an explicit opt-in through', () => {
    process.env.ACCEPTANCE_ALLOW_DESTRUCTIVE_DB = '1';
    expect(() => assertDisposableDatabase(ENV_URL)).not.toThrow();
  });
});

describe('assertDisposableRedis', () => {
  it('refuses db 0 — including the pathless URL that selects it implicitly', () => {
    expect(() => assertDisposableRedis(ENV_REDIS)).toThrow(/Redis database 0/);
    expect(() => assertDisposableRedis('redis://cache:6379/0')).toThrow(/Redis database 0/);
  });

  it('accepts a non-zero index over either scheme', () => {
    expect(() => assertDisposableRedis('redis://localhost:6380/1')).not.toThrow();
    expect(() => assertDisposableRedis('rediss://localhost:6379/2')).not.toThrow();
  });

  it('treats an unparseable URL as db 0 rather than waving it through', () => {
    expect(redisDbIndex('not a url')).toBe(0);
    expect(() => assertDisposableRedis('not a url')).toThrow(/Redis database 0/);
  });

  it('lets an explicit opt-in through', () => {
    process.env.ACCEPTANCE_ALLOW_DESTRUCTIVE_DB = '1';
    expect(() => assertDisposableRedis(ENV_REDIS)).not.toThrow();
  });
});

/**
 * The other half, and it only works as a pair: the checks above refuse db 0, and `cucumber.js`
 * is what makes sure no run ever presents it. It resolves the URLs before `loadEnvFile`, which
 * is why this is a subprocess rather than an import — the ordering IS the behaviour, and a test
 * that required the file into this process would have already lost it.
 *
 * The CI case is the one that has to keep working: `.github/workflows/ci.yml` exports a pathless
 * `redis://localhost:6379`, and the acceptance job goes red if that is not moved off db 0 here.
 */
describe('cucumber.js store resolution', () => {
  const ROOT = join(__dirname, '../../..');

  function resolved(env: Record<string, string>): { database: string; redis: string } {
    // The four keys are cleared first, then set from `env` alone. `npm test` runs vitest with
    // `--env-file-if-exists=.env`, so this process already holds .env's values — inheriting them
    // would hand the child an "exported" DATABASE_URL and silently test a different branch than
    // the one each case names.
    const base = { ...process.env };
    delete base.DATABASE_URL;
    delete base.REDIS_URL;
    delete base.TEST_DATABASE_URL;
    delete base.TEST_REDIS_URL;

    const out = execFileSync(
      process.execPath,
      ['-e', "require('./cucumber.js');console.log(process.env.DATABASE_URL,process.env.REDIS_URL)"],
      { cwd: ROOT, env: { ...base, ...env }, encoding: 'utf8' },
    ).trim();
    const [database, redis] = out.split(' ');
    return { database: database!, redis: redis! };
  }

  it("moves CI's pathless URL off db 0 without ci.yml having to say so", () => {
    expect(
      resolved({ DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci', REDIS_URL: 'redis://localhost:6379' }),
    ).toEqual({ database: 'postgresql://ci:ci@localhost:5432/ci', redis: 'redis://localhost:6379/1' });
  });

  it('moves an explicit db 0 too, and leaves a non-zero index alone', () => {
    expect(resolved({ REDIS_URL: 'redis://cache:6379/0' }).redis).toBe('redis://cache:6379/1');
    expect(resolved({ REDIS_URL: 'redis://user:pw@h:6379/3?x=1' }).redis).toBe(
      'redis://user:pw@h:6379/3?x=1',
    );
  });

  it('ignores the repo-root .env, which is where the fixtures leaked from', () => {
    // No DATABASE_URL/REDIS_URL exported, so .env is the only other source — and `db:5432`
    // must not be what comes back out.
    const { database, redis } = resolved({});
    expect(database).toBe('postgresql://interviewly:interviewly@localhost:5432/interviewly_test');
    expect(redis).toBe('redis://localhost:6380/1');
  });

  it('lets TEST_* win over an exported value', () => {
    expect(
      resolved({
        DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci',
        TEST_DATABASE_URL: 'postgresql://x@localhost:5432/other_test',
      }).database,
    ).toBe('postgresql://x@localhost:5432/other_test');
  });
});
