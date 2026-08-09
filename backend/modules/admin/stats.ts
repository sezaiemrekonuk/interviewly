import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

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

export const getAdminStats: RequestHandler = async (req, res, next) => {
  try {
    const [completedAgg, stateCounts, tokenSum, occupationGroups, clusters, weakest] =
      await Promise.all([
        // averageDurationMs + cutShort source: completed state only.
        // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
        //
        // Raw, because Prisma's `aggregate` cannot express `ended_at - started_at`. SUM and
        // COUNT rather than AVG so the mean is still computed the way it was: an exact
        // integer sum divided in JS, byte-identical to the old `reduce`. `::bigint` is exact
        // here — Prisma stores `TIMESTAMP(3)`, so a duration has no sub-millisecond part to
        // lose.
        prisma.$queryRaw<CompletedAggregate[]>`
          SELECT
            COUNT(*) FILTER (
              WHERE "started_at" IS NOT NULL AND "ended_at" IS NOT NULL
            ) AS duration_count,
            COALESCE(SUM(
              EXTRACT(EPOCH FROM ("ended_at" - "started_at")) * 1000
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
        prisma.interview.groupBy({ by: ['state'], _count: { _all: true } }),
        // totalTokens across ALL llm_calls — deleted interviews included (K11)
        // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
        prisma.llmCall.aggregate({ _sum: { input_tokens: true, output_tokens: true } }),
        // perOccupation: grouped in Postgres (deleted included). The result set is
        // clusters × distinct occupations, not one row per interview.
        // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
        prisma.interview.groupBy({
          by: ['occupation_cluster_id', 'occupation'],
          where: { occupation_cluster_id: { not: null } },
          _count: { _all: true },
        }),
        // The cluster keys, once, instead of a join on every interview row. This is a small
        // seeded reference table (`prisma/seed.ts` owns the canonical list).
        prisma.occupationCluster.findMany({ select: { id: true, key: true } }),
        // weakestQuestions: plain relational, no jsonb (db AC-12). The question text comes
        // from the relation — an id is not a label anyone can read (issue 143). Bounded, and
        // the `(score, question_id)` index serves the ORDER BY.
        prisma.reportQuestion.findMany({
          orderBy: [{ score: 'asc' }, { question_id: 'asc' }],
          take: 5,
          select: { question_id: true, score: true, question: { select: { text: true } } },
        }),
      ]);

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

    logger.info({ traceId: req.traceId }, 'ADMIN_STATS_READ');

    res.json({
      averageDurationMs,
      completed,
      cutShort,
      unfinished,
      totalTokens,
      perOccupation,
      weakestQuestions: weakest.map((q) => ({
        questionId: q.question_id,
        text: q.question.text,
        score: q.score,
      })),
    });
  } catch (err) {
    next(err);
  }
};
