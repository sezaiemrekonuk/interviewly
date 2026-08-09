-- ADR-I39: every score moves from the 0..5 integer scale to 0..100. No column type changes —
-- they are already INTEGER / JSONB — so this migration is a unit conversion of the rows that
-- exist, and every one of them was written on the old scale. Multiplying by twenty preserves
-- the band each row fell in (2 -> 40, 3 -> 60, 4 -> 80), so a stored report reads the same
-- after the migration as it did before it.
--
-- `reports.prompt_version` is deliberately left alone: it names the prompt lineage that wrote
-- the prose, which is still true. The numbers beside that prose changed unit here, not author.

UPDATE "interview_rounds" SET "score" = "score" * 20 WHERE "score" IS NOT NULL;

UPDATE "report_questions" SET "score" = "score" * 20;

-- K4 per-answer scores. `star_adherence` is a 0..1 ratio and is untouched; `reasons` likewise.
UPDATE "answers"
SET "scores" = "scores" || jsonb_build_object(
      'overall',   ("scores"->>'overall')::int * 20,
      'relevance', ("scores"->>'relevance')::int * 20,
      'depth',     ("scores"->>'depth')::int * 20,
      'structure', ("scores"->>'structure')::int * 20)
WHERE "scores" ?& array['overall', 'relevance', 'depth', 'structure'];

-- K15 payload: the overall, one per round, one per question.
UPDATE "reports"
SET "payload" = "payload"
    || jsonb_build_object('overall_score', ("payload"->>'overall_score')::int * 20)
    || jsonb_build_object('rounds', COALESCE((
         SELECT jsonb_agg(r || jsonb_build_object('score', (r->>'score')::int * 20) ORDER BY ord)
         FROM jsonb_array_elements("payload"->'rounds') WITH ORDINALITY AS t(r, ord)
       ), '[]'::jsonb))
    || jsonb_build_object('questions', COALESCE((
         SELECT jsonb_agg(q || jsonb_build_object('score', (q->>'score')::int * 20) ORDER BY ord)
         FROM jsonb_array_elements("payload"->'questions') WITH ORDINALITY AS t(q, ord)
       ), '[]'::jsonb))
WHERE "payload" IS NOT NULL AND "payload" ? 'overall_score';
