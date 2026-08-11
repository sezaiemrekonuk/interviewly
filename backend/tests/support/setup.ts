// Loaded before anything imports env.ts / db.ts. Fills only keys the env schema
// requires so `config` validates during acceptance runs; real env (CI, shell) wins
// via `??=`. These are test defaults, never production values.
process.env.NODE_ENV ??= 'test';
process.env.PUBLIC_ORIGIN ??= 'http://localhost';
process.env.INTERNAL_API_URL ??= 'http://localhost:4000';
// `interviewly_test`, NOT `interviewly`: this suite truncates the tables it touches, and the
// old default pointed it straight at the database `docker compose up` seeds. See
// assertDisposableDatabase() in harness.ts, which now refuses anything not named for a test.
process.env.DATABASE_URL ??=
  'postgresql://interviewly:interviewly@localhost:5432/interviewly_test';
process.env.SHADOW_DATABASE_URL ??= 'postgresql://interviewly:interviewly@localhost:5432/interviewly_shadow';
// Db 1 and port 6380, matching cucumber.js: db 0 is the application's and this ring flushes
// what it connects to (#119). In practice cucumber.js has already set this — these defaults
// only cover a direct import, and a default that would be rejected is worse than none.
process.env.REDIS_URL ??= 'redis://localhost:6380/1';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters';
process.env.SMTP_HOST ??= 'localhost';
process.env.MAIL_FROM ??= 'Interviewly <no-reply@interviewly.local>';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_BUCKET ??= 'interviewly';
process.env.S3_ACCESS_KEY ??= 'minioadmin';
process.env.S3_SECRET_KEY ??= 'minioadmin';
