import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

export const getAdminStats: RequestHandler = async (req, res, next) => {
  try {
    const [completedRows, stateCounts, tokenSum, interviewsForOccupation, weakest] =
      await Promise.all([
        // averageDurationMs + cutShort source: completed state only
        // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
        prisma.interview.findMany({
          where: { state: 'completed' },
          select: { started_at: true, ended_at: true, ended_reason: true },
        }),
        // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
        prisma.interview.groupBy({ by: ['state'], _count: { _all: true } }),
        // totalTokens across ALL llm_calls — deleted interviews included (K11)
        // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
        prisma.llmCall.aggregate({ _sum: { input_tokens: true, output_tokens: true } }),
        // perOccupation: all interviews with a cluster (deleted included)
        // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)
        prisma.interview.findMany({
          where: { occupation_cluster_id: { not: null } },
          select: { occupation: true, occupation_cluster: { select: { key: true } } },
        }),
        // weakestQuestions: plain relational, no jsonb (db AC-12)
        prisma.reportQuestion.findMany({
          orderBy: [{ score: 'asc' }, { question_id: 'asc' }],
          take: 5,
          select: { question_id: true, score: true },
        }),
      ]);

    // averageDurationMs: mean of ended_at - started_at over completed; 0 if none qualify
    const durations = completedRows
      .filter((r) => r.started_at && r.ended_at)
      .map((r) => r.ended_at!.getTime() - r.started_at!.getTime());
    const averageDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    const byState = new Map(stateCounts.map((g) => [g.state, g._count._all]));
    const completed = byState.get('completed') ?? 0;
    const cutShort = completedRows.filter((r) => r.ended_reason === 'cut_short').length;
    const unfinished = (byState.get('abandoned') ?? 0) + (byState.get('failed') ?? 0);

    const totalTokens =
      (tokenSum._sum.input_tokens ?? 0) + (tokenSum._sum.output_tokens ?? 0);

    // perOccupation: group by cluster key, label = modal occupation, count = total in cluster
    const clusterMap = new Map<string, Map<string, number>>();
    for (const row of interviewsForOccupation) {
      if (!row.occupation_cluster) continue;
      const key = row.occupation_cluster.key;
      const occMap = clusterMap.get(key) ?? new Map<string, number>();
      occMap.set(row.occupation, (occMap.get(row.occupation) ?? 0) + 1);
      clusterMap.set(key, occMap);
    }
    const perOccupation = [...clusterMap.entries()]
      .map(([cluster, occMap]) => {
        const label = [...occMap.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const count = [...occMap.values()].reduce((a, b) => a + b, 0);
        return { cluster, label, count };
      })
      .sort((a, b) => b.count - a.count || a.cluster.localeCompare(b.cluster));

    logger.info({ traceId: req.traceId }, 'ADMIN_STATS_READ');

    res.json({
      averageDurationMs,
      completed,
      cutShort,
      unfinished,
      totalTokens,
      perOccupation,
      weakestQuestions: weakest.map((q) => ({ questionId: q.question_id, score: q.score })),
    });
  } catch (err) {
    next(err);
  }
};
