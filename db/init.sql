-- Creates application DB and shadow DB for Prisma Migrate.
SELECT 'CREATE DATABASE interviewly'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'interviewly')\gexec
SELECT 'CREATE DATABASE interviewly_shadow'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'interviewly_shadow')\gexec
