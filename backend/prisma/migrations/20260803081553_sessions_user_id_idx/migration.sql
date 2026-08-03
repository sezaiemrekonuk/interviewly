-- A05: bulk session revocation looks up by user_id (index only, per the migration protocol).
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
