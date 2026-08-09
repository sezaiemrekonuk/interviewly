-- Issue 86: N01 shipped the role gate and the soft delete and never the audit. The only
-- record that an interview had been deleted was a pino line on stdout, which `docker compose
-- down` discards — so nothing could say who deleted it, or when, or under what request.
--
-- ON DELETE RESTRICT like every other FK in this schema: an audit row must outlive any
-- attempt to remove the actor. Account erasure anonymises the `users` row in place, so the
-- join target survives without carrying the person's identity.
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "trace_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- "everything that happened to this interview"
CREATE INDEX "audit_logs_subject_type_subject_id_idx" ON "audit_logs" ("subject_type", "subject_id");
-- "everything this account did, newest first"
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs" ("actor_user_id", "created_at");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
