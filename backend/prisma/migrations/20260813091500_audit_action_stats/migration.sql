-- `/admin/audit`'s action-filter vocabulary was `groupBy(['action'])` over `audit_logs` on
-- every page view — the fastest-growing table on the admin surface (see its own `created_at`
-- index note), made worse by the read itself writing a row. `action` is a closed compile-time
-- union, so a running count per action never grows past a handful of rows.
CREATE TABLE "audit_action_stats" (
    "action" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_action_stats_pkey" PRIMARY KEY ("action")
);

INSERT INTO "audit_action_stats" ("action", "count")
SELECT "action", COUNT(*)::int
FROM "audit_logs"
GROUP BY "action";
