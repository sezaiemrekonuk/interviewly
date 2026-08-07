import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';

import { applyTransition } from './machine';

// Twice the largest shape the UI offers (`new/page.tsx` ROUND_SHAPES = [6, 8, 10]) and still a
// count one generation call can satisfy. Unbounded, a request body sized the provider call
// directly — `generateRound` asks for the whole round at once (issue #98). Mirrored as a CHECK
// constraint on `interviews.target_question_count` so a direct insert cannot bypass it.
const MAX_TARGET_QUESTION_COUNT = 20;

const schema = z.object({
  mode: z.enum(['voice', 'text']),
  jobText: z.string().trim().min(1).optional(),
  uploadId: z.string().min(1).optional(),
  targetQuestionCount: z.coerce.number().int().min(1).max(MAX_TARGET_QUESTION_COUNT),
});

// Keyword → seeded occupation_clusters.key (prisma/seed.ts OCCUPATION_CLUSTERS). First
// matching keyword wins; unmatched listing leaves occupation_cluster_id null (valid).
// English and Turkish keywords per cluster — Turkish is the product's primary market, so a
// Turkish listing must resolve to a cluster too, not fall through to null (issue #149).
// Keywords are stored with their natural diacritics; `fold` normalises both sides before the
// compare, so a caps-lock listing ("YAZILIM") still matches "yazılım".
// A trailing `*` marks a Turkish stem (root + up to five suffix letters), so "mühendis*"
// catches the inflected "mühendisi"/"mühendisler". No `*` = whole-word match. Short/ambiguous
// roots stay `*`-free or go multi-word so a stem can't over-match: bare "sales" (not
// "salesforce"), "data scien*" (not "database").
// ponytail: flat keyword list, no scoring/ranking — promote if misclassification shows up.
const OCCUPATION_KEYWORDS: Array<[key: string, words: string[]]> = [
  // data_science and design precede software_engineering on purpose: "mühendis*"/"engineer*"
  // are broad enough to swallow "Veri Mühendisi", so the narrower clusters must win first-match.
  ['data_science', ['data scien*', 'data analyst*', 'machine learning', 'analytics', 'veri bilim*', 'veri analist*', 'veri mühendis*']],
  ['design', ['designer*', 'ux', 'ui/ux', 'tasarımcı*', 'arayüz tasarım*']],
  ['software_engineering', ['engineer*', 'developer*', 'programmer', 'devops', 'sre', 'geliştirici*', 'yazılım*', 'mühendis*']],
  ['product_management', ['product manager', 'product owner', 'ürün müdürü', 'ürün yöneticisi']],
  ['marketing', ['marketing', 'growth', 'seo', 'pazarlama*']],
  ['sales', ['sales', 'account executive', 'business development', 'satış*']],
  ['finance', ['finance', 'accountant', 'financial analyst', 'controller', 'finans']],
  ['operations', ['operations', 'logistics', 'supply chain', 'operasyon', 'lojistik']],
  ['hr', ['human resources', 'recruiter', 'talent acquisition', 'insan kaynakları']],
];

const OCCUPATION_TITLE_MAX = 80;

// Up to five suffix letters after a Turkish stem — enough for "-lar"/"-leri"/"-sında" etc.
const SUFFIX = '[a-z]{0,5}';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case- and diacritic-insensitive fold for keyword matching. `toLowerCase()` alone breaks
// Turkish: "YAZILIM" → "yazilim" (dotted i), "İ" → "i̇" (i + combining dot) — neither equals
// the dotless-ı keyword. NFD + strip handles ş/ğ/ü/ö/ç; ı needs an explicit map (no decomp).
// Whitespace is collapsed so a multi-word keyword survives a newline/double space in the body.
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ');
}

// A `*`-terminated keyword compiles to stem + bounded suffix; every other keyword is a whole
// word. \b works because `fold` reduces both sides to ASCII, so [a-z] covers every suffix.
function toPattern(kw: string): RegExp {
  const stem = kw.endsWith('*');
  const body = esc(fold(stem ? kw.slice(0, -1) : kw));
  return new RegExp(`\\b${body}${stem ? SUFFIX : ''}\\b`);
}

// Compiled once at load, not rebuilt per classify() call.
const OCCUPATION_PATTERNS = OCCUPATION_KEYWORDS.map(
  ([key, kws]) => [key, kws.map(toPattern)] as const,
);

// Human-readable title: the listing's first non-empty line, trimmed and capped at a word
// boundary with an ellipsis. Never the matched keyword, never a blind mid-word slice — the
// title is the interview's label everywhere (history list, delete aria-label, report header).
function titleFromListing(jobText: string): string {
  const firstLine = jobText.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  if (firstLine.length <= OCCUPATION_TITLE_MAX) return firstLine;
  const capped = firstLine.slice(0, OCCUPATION_TITLE_MAX);
  const lastSpace = capped.lastIndexOf(' ');
  const truncated = lastSpace > 0 ? capped.slice(0, lastSpace).trimEnd() : capped;
  return `${truncated}…`;
}

export function classify(jobText: string): { occupation: string; clusterKey: string | null } {
  const t = fold(jobText);
  // TODO(#149): "Makine/İnşaat Mühendisi" still resolves to software_engineering — the broad
  // "mühendis*"/"engineer*" stem can't tell disciplines apart. Pre-existing; not fixed here.
  const clusterKey = OCCUPATION_PATTERNS.find(([, ps]) => ps.some((p) => p.test(t)))?.[0] ?? null;
  return { occupation: titleFromListing(jobText), clusterKey };
}

// hrCount = max(2, round(target * 0.4)), techCount = target - hrCount (non-negotiable split).
function split(target: number): { hrCount: number; techCount: number } {
  const hrCount = Math.max(2, Math.round(target * 0.4));
  return { hrCount, techCount: target - hrCount };
}

export const setupInterview: RequestHandler = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
  const { mode, jobText, uploadId, targetQuestionCount } = parsed.data;

  if (!jobText && !uploadId) throw new ApiError('LISTING_REQUIRED');
  // ponytail: upload-derived text handoff (extracted text passed back from POST /uploads)
  // is I11's contract, not yet built. Until then an uploadId with no jobText has nothing to
  // store in the NOT NULL job_text column, so it is a malformed request today.
  if (!jobText) throw new ApiError('VALIDATION_ERROR');

  const { occupation, clusterKey } = classify(jobText);
  const cluster = clusterKey
    ? await prisma.occupationCluster.findUnique({ where: { key: clusterKey } })
    : null;
  const { hrCount, techCount } = split(targetQuestionCount);

  const interview = await prisma.interview.create({
    data: {
      user_id: req.user!.id,
      mode,
      job_text: jobText,
      job_source: uploadId ? 'upload' : 'paste',
      upload_id: uploadId ?? null,
      occupation,
      occupation_cluster_id: cluster?.id ?? null,
      language: req.user!.locale,
      target_question_count: targetQuestionCount,
      hr_question_count: hrCount,
      // Born `created`, moved by the guard in the same request. Inserting straight into
      // `profiling` would be one write fewer and the only state change in the system that
      // emits no `INTERVIEW_STATE_CHANGED` (@AC-16 lists this edge).
      state: 'created',
      current_index: 0,
    },
  });

  await applyTransition(interview, 'profiling', { traceId: req.traceId! });

  res.status(201).json({ interviewId: interview.id, hrCount, techCount });
};

export default setupInterview;
