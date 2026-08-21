-- `/admin/stats`'s `perModel` (avg latency, cost, tokens per provider/model) was a
-- `groupBy(['provider','model'])` over every `llm_calls` row ever written, unbounded, on every
-- dashboard load. `llm_calls` is written on every provider call and never pruned, so the scan
-- got slower every day the product ran. This table is the running total instead: updated once
-- per call (`recordLlmCall`, db.ts) in the same transaction as the `llm_calls` insert, same
-- pattern as `interviews.spent_usd`. The backfill is the one full scan this ever costs.
CREATE TABLE "llm_model_stats" (
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "latency_sum_ms" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "llm_model_stats_pkey" PRIMARY KEY ("provider","model")
);

INSERT INTO "llm_model_stats" ("provider", "model", "calls", "cost_usd", "input_tokens", "output_tokens", "latency_sum_ms")
SELECT
    "provider",
    "model",
    COUNT(*)::int,
    SUM("cost_usd"),
    COALESCE(SUM("input_tokens"), 0)::bigint,
    COALESCE(SUM("output_tokens"), 0)::bigint,
    SUM("latency_ms")::bigint
FROM "llm_calls"
GROUP BY "provider", "model";
