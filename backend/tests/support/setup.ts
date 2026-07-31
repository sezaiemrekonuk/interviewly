// Loaded before anything imports env.ts / db.ts. Fills only keys the env schema
// requires so `config` validates during acceptance runs; real env (CI, shell) wins
// via `??=`. These are test defaults, never production values.
process.env.NODE_ENV ??= 'test';
process.env.PUBLIC_ORIGIN ??= 'http://localhost';
process.env.INTERNAL_API_URL ??= 'http://localhost:4000';
process.env.DATABASE_URL ??= 'postgresql://interviewly:interviewly@localhost:5432/interviewly';
process.env.SHADOW_DATABASE_URL ??= 'postgresql://interviewly:interviewly@localhost:5432/interviewly_shadow';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters';
process.env.SMTP_HOST ??= 'localhost';
process.env.MAIL_FROM ??= 'Interviewly <no-reply@interviewly.local>';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_BUCKET ??= 'interviewly';
process.env.S3_ACCESS_KEY ??= 'minioadmin';
process.env.S3_SECRET_KEY ??= 'minioadmin';
