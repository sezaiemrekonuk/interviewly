-- Issue 009 (KVKK / GDPR). Nullable columns only, per the F02 migration protocol:
-- `consent_version` + `consented_at` record what a new account accepted at registration,
-- `deleted_at` marks an account erased in place (every FK is ON DELETE RESTRICT, so the
-- row is anonymised, never removed).
ALTER TABLE "users" ADD COLUMN "consent_version" TEXT;
ALTER TABLE "users" ADD COLUMN "consented_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);
