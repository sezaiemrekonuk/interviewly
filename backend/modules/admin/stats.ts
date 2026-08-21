import { Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';

import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { adminRead, applyReadHeaders } from '../../src/lib/read-replica';

/**
 * Issue 85: this handler used to pull every `completed` interview and every clustered
 * interview into Node and reduce them in JavaScript — two unbounded `findMany`s on a shared
 * API process, growing linearly with the table. Both are now aggregations, and the response
 * body is unchanged.
 *
 * The `take:` cap that would also have bounded the memory was deliberately not taken: it
 * bounds the wrong thing. A capped scan produces confidently wrong statistics, which is
 * worse than a slow correct answer.
 */

interface CompletedAggregate {
  /** Rows with BOTH timestamps — the same filter the JS mean applied. */
  duration_count: bigint;
  duration_sum_ms: bigint;
  cut_short: bigint;
}

/** One weakest-questions row: a wording, its mean score, and how many answers that mean is over. */
interface WeakestQuestion {
  text: string;
  score: number;
  sample_size: number;
}

interface OccupationGroup {
  occupation_cluster_id: string | null;
  occupation: string;
  _count: { _all: number };
}

/**
 * Folds the `(cluster, occupation)` groups into one row per cluster: total count, and the
 * modal occupation as the label. Input is O(distinct occupations), not O(interviews).
 *
 * The old code read the modal label off a `sort()` whose ties fell to whatever order the
 * unordered `findMany` happened to return, so two identical databases could label the same
 * cluster differently. Ties break on `occupation` ascending here instead — same label every
 * time, for the same rows.
 */
export function summariseOccupations(
  groups: OccupationGroup[],
  clusterKeys: Map<string, string>,
): { cluster: string; label: string; count: number }[] {
  const perCluster = new Map<string, { count: number; label: string; labelCount: number }>();

  for (const group of groups) {
    const key = group.occupation_cluster_id && clusterKeys.get(group.occupation_cluster_id);
    if (!key) continue;

    const n = group._count._all;
    const entry = perCluster.get(key) ?? { count: 0, label: group.occupation, labelCount: -1 };
    entry.count += n;
    if (n > entry.labelCount || (n === entry.labelCount && group.occupation < entry.label)) {
      entry.label = group.occupation;
      entry.labelCount = n;
    }
    perCluster.set(key, entry);
  }

  return [...perCluster.entries()]
    .map(([cluster, entry]) => ({ cluster, label: entry.label, count: entry.count }))
    .sort((a, b) => b.count - a.count || a.cluster.localeCompare(b.cluster));
}

/**
 * Issue 196. This ranked `report_questions` ROWS, not questions: `ORDER BY score ASC,
 * question_id ASC LIMIT 5` over one row per scored answer. Scores repeat heavily — 53 rows sit
 * at 0 on the dev database — so past the first few the selection was decided entirely by the
 * `question_id` tie-break, and a Prisma `cuid()` leads with a timestamp, so ascending meant
 * OLDEST FIRST. The panel named the five oldest zero-scored answers and went on naming them
 * however many worse ones arrived; a question answered badly today could never reach it.
 *
 * Aggregate first, then rank. Grouped by `text` rather than `question_id`, because a `questions`
 * row belongs to one interview: the same wording asked of forty candidates is forty ids, and
 * grouping by id would not combine any of them. That is also why no id comes back — after the
 * grouping there is no single one of the forty that is *the* question.
 *
 * Raw, because Prisma's `groupBy` cannot group on a relation's column.
 *
 * `limit` is a parameter only so the integration test can ask for a superset and assert the
 * ordering of its own fixtures without depending on what else is in the database. Production
 * takes the default.
 */
export function weakestQuestions(
  limit = 5,
  client: Pick<typeof prisma, '$queryRaw'> = prisma,
): Promise<WeakestQuestion[]> {
  return client.$queryRaw<WeakestQuestion[]>`
    SELECT
      q."text"                     AS text,
      ROUND(AVG(rq."score"))::int  AS score,
      COUNT(*)::int                AS sample_size
    FROM "report_questions" rq
    JOIN "questions" q ON q."id" = rq."question_id"
    GROUP BY q."text"
    -- Ties are the whole story here, so all three keys earn their place. Weakest first; then
    -- the most-asked, so a wording scored 0 forty times outranks one scored 0 once; then the
    -- text, because without a total order the panel reshuffles between two reads of an
    -- unchanged database. That last one is the same non-determinism summariseOccupations
    -- breaks on its occupation key above.
    ORDER BY AVG(rq."score") ASC, COUNT(*) DESC, q."text" ASC
    LIMIT ${limit}
  `;
}

/**
 * Money on the wire, at the column's own precision. `Decimal(12,6)` through a JS number stops
 * being the figure the ledger holds, and a null sum is a table with no rows, which is 0 spent.
 */
const usd = (value: Prisma.Decimal | null): string => (value ?? new Prisma.Decimal(0)).toFixed(6);

export const getAdminStats: RequestHandler = async (req, res, next) => {
  try {
    const { data, source, lagSeconds } = await adminRead(async (client) => {
      const [completedAgg, stateCounts, tokenSum, occupationGroups, clusters, weakest, modelStats] =
        await Promise.all([
          // averageDurationMs + cutShort source: completed state only.
          // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
          //
          // Raw, because Prisma's `aggregate` cannot express `ended_at - started_at`. SUM and
          // COUNT rather than AVG so the mean is still computed the way it was: an exact
          // integer sum divided in JS, byte-identical to the old `reduce`. `::bigint` is exact
          // here — Prisma stores `TIMESTAMP(3)`, so a duration has no sub-millisecond part to
          // lose.
          client.$queryRaw<CompletedAggregate[]>`
            SELECT
              COUNT(*) FILTER (
                WHERE "started_at" IS NOT NULL AND "ended_at" IS NOT NULL
              ) AS duration_count,
              COALESCE(SUM(
                ROUND(EXTRACT(EPOCH FROM ("ended_at" - "started_at")) * 1000)
              ) FILTER (
                WHERE "started_at" IS NOT NULL AND "ended_at" IS NOT NULL
              ), 0)::bigint AS duration_sum_ms,
              COUNT(*) FILTER (
                WHERE "ended_reason" = 'cut_short'::"EndedReason"
              ) AS cut_short
            FROM "interviews"
            WHERE "state" = 'completed'::"InterviewState"
          `,
          // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
          client.interview.groupBy({ by: ['state'], _count: { _all: true } }),
          // totalTokens across ALL llm_calls — deleted interviews included (K11)
          // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
          //
          // Deliberately NOT read from `llm_model_stats` (unlike perModel below): that table is
          // only as complete as `recordLlmCall`'s callers, and this figure's whole job is to
          // agree with whatever is actually in `llm_calls`, however it got there. Still an
          // unbounded scan — flagged, not fixed, because a total that can silently drift from
          // its own source table is worse than one that is slow.
          client.llmCall.aggregate({
            _sum: { input_tokens: true, output_tokens: true, cost_usd: true },
          }),
          // perOccupation: grouped in Postgres (deleted included). The result set is
          // clusters × distinct occupations, not one row per interview.
          // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
          client.interview.groupBy({
            by: ['occupation_cluster_id', 'occupation'],
            where: { occupation_cluster_id: { not: null } },
            _count: { _all: true },
          }),
          // The cluster keys, once, instead of a join on every interview row. This is a small
          // seeded reference table (`prisma/seed.ts` owns the canonical list).
          client.occupationCluster.findMany({ select: { id: true, key: true } }),
          weakestQuestions(5, client),
          // US-26's "spend by model". Was a `groupBy(['provider','model'])` over every
          // `llm_calls` row ever written — a handful of *output* rows does not mean a handful
          // scanned, and that scan grew on every provider call with no upper bound. Reads the
          // running total `recordLlmCall` (db.ts) now keeps instead (`LlmModelStat`), which is
          // sized to providers × models, not calls.
          //
          // Voice rolls into the same total by design: a per-second row and a per-token row are
          // both money spent, and separating them into two currencies would leave no figure that
          // answers "what did this cost". `unitKind` on the drill-down is where the two split.
          client.llmModelStat.findMany({ orderBy: { cost_usd: 'desc' } }),
        ]);

      return { completedAgg, stateCounts, tokenSum, occupationGroups, clusters, weakest, modelStats };
    });

    const { completedAgg, stateCounts, tokenSum, occupationGroups, clusters, weakest, modelStats } =
      data;

    // averageDurationMs: mean of ended_at - started_at over completed; 0 if none qualify
    const { duration_count, duration_sum_ms } = completedAgg[0];
    const durationCount = Number(duration_count);
    const averageDurationMs =
      durationCount > 0 ? Math.round(Number(duration_sum_ms) / durationCount) : 0;

    const byState = new Map(stateCounts.map((g) => [g.state, g._count._all]));
    const completed = byState.get('completed') ?? 0;
    const cutShort = Number(completedAgg[0].cut_short);
    const unfinished = (byState.get('abandoned') ?? 0) + (byState.get('failed') ?? 0);

    const totalTokens =
      (tokenSum._sum.input_tokens ?? 0) + (tokenSum._sum.output_tokens ?? 0);

    const perOccupation = summariseOccupations(
      occupationGroups,
      new Map(clusters.map((c) => [c.id, c.key])),
    );

    // Issue 86: an aggregate over every user's interviews is still a read of their data.
    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.stats_read',
      subjectType: 'interview_stats',
      traceId: req.traceId,
    });

    logger.info({ traceId: req.traceId }, 'ADMIN_STATS_READ');

    applyReadHeaders(res, { data, source, lagSeconds });

    res.json({
      averageDurationMs,
      completed,
      cutShort,
      unfinished,
      totalTokens,
      // The platform total the cost panel could not print, because nothing returned one: it
      // was summing the interviews it happened to have loaded and saying so. Summed from
      // `llm_calls` rather than `interviews.spent_usd` so it agrees with `perModel` below —
      // the two must add up to the same figure or the panel contradicts itself.
      totalCostUsd: usd(tokenSum._sum.cost_usd),
      perModel: modelStats.map((stat) => ({
        provider: stat.provider,
        model: stat.model,
        calls: stat.calls,
        tokens: Number(stat.input_tokens) + Number(stat.output_tokens),
        costUsd: usd(stat.cost_usd),
        // Rounded to a millisecond: an average latency carrying six decimals of precision it
        // does not have reads as a measurement rather than a mean.
        averageLatencyMs: stat.calls > 0 ? Math.round(Number(stat.latency_sum_ms) / stat.calls) : 0,
      })),
      perOccupation,
      // `sampleSize` ships rather than being filtered on. A `HAVING COUNT(*) >= n` floor was
      // the obvious guard against one bad answer outranking a well-sampled question, and it is
      // wrong here: 39 of the 50 distinct wordings on the dev database occur exactly once,
      // because the conductor writes each question for the candidate in front of it. A floor of
      // 2 would discard 78% of the corpus and, once every wording is unique, empty the panel
      // permanently — an invisible failure in place of a visible one. Showing the count instead
      // lets the reader discount a 0 that came from a single answer, which is the judgement the
      // floor was trying to make for them.
      weakestQuestions: weakest.map((q) => ({
        text: q.text,
        score: q.score,
        sampleSize: q.sample_size,
      })),
    });
  } catch (err) {
    next(err);
  }
};
