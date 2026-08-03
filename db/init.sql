-- Creates application DB, the shadow DB for Prisma Migrate, and the acceptance DB.
SELECT 'CREATE DATABASE interviewly'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'interviewly')\gexec
SELECT 'CREATE DATABASE interviewly_shadow'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'interviewly_shadow')\gexec
-- Separate database, not a schema: the acceptance suite TRUNCATEs users/sessions/email_tokens
-- between scenarios, and it used to do that to `interviewly` above — deleting the seeded demo
-- admin on every run. backend/tests/support/harness.ts now refuses any database not named for
-- a test, so this one has to exist.
SELECT 'CREATE DATABASE interviewly_test'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'interviewly_test')\gexec
