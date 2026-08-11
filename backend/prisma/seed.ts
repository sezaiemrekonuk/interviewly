/**
 * Seed — `npm run seed` in backend/, or `docker compose run --rm api npm run seed`.
 *
 * Contract (db spec Behaviour §11, AC-10/AC-17): a bare `docker compose up` followed by
 * this script yields a working room with NO manual step — occupation clusters, both
 * personas with uploaded avatar objects, the shared five-pose mascot set, the sample job
 * listing, a pre-verified demo admin, and one finished sample interview with a ready report.
 *
 * Idempotent: every row is upserted on a deterministic id or natural key, and every object
 * PUT is content-addressed, so re-running changes nothing.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import type { AvatarState, MascotPose, Prisma } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import {
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { isDeployed } from '../src/lib/deployment';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Object storage
//
// This script reads `process.env` directly rather than importing `src/lib/env.ts`. That
// convention (§Rules) governs the running services; the seed is an ops tool, and coupling
// it to the full service schema would make `npm run seed` fail without SESSION_SECRET,
// SMTP_HOST and MAIL_FROM — none of which seeding touches. The defaults below match
// `.env.example`.
// ---------------------------------------------------------------------------

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const S3_BUCKET = process.env.S3_BUCKET ?? 'interviewly';

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true, // MinIO serves path-style only
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
});

/**
 * A valid 34-byte 1x1 WebP. Every avatar and mascot object is seeded with these bytes:
 * the seed's job is to make the keys resolvable so no entry screen is the first request
 * for an image (infra §10.3). Real artwork replaces the objects at the same keys.
 * Identical bytes mean an identical sha256 across poses — the pose/state segment of the
 * key is what keeps them distinct.
 */
const PLACEHOLDER_WEBP = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  'base64'
);
const PLACEHOLDER_SHA256 = createHash('sha256').update(PLACEHOLDER_WEBP).digest('hex');

async function ensureBucket() {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
  }
}

/**
 * Anonymous `GetObject` on the two content-addressed asset prefixes, and nothing else. The
 * cache header on each object was never enough on its own: MinIO denies an unsigned GET
 * until a bucket policy allows it, so every avatar and mascot 403'd behind the edge.
 *
 * Prefix-scoped, never bucket-wide: `uploads/*` in this same bucket holds candidate CVs and
 * job listings, which are served by signed URL only (I12) and must stay unreadable anonymously.
 */
async function publishAssetPrefixes() {
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: S3_BUCKET,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [
              `arn:aws:s3:::${S3_BUCKET}/mascot/*`,
              `arn:aws:s3:::${S3_BUCKET}/personas/*`,
            ],
          },
        ],
      }),
    })
  );
}

/** PUTs the placeholder image at `key` with the public-read cache header (infra §K12). */
async function putImage(key: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: PLACEHOLDER_WEBP,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
  return key;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/**
 * The canonical occupation clusters. `interviews.occupation_cluster_id` FKs here and K11's
 * admin "interviews per occupation" chart groups by it, so this list must exist before any
 * interview row: a wrong list groups every downstream statistic wrong.
 */
const OCCUPATION_CLUSTERS: Array<{ key: string; label: string }> = [
  { key: 'software_engineering', label: 'Software Engineering' },
  { key: 'product_management', label: 'Product Management' },
  { key: 'data_science', label: 'Data & Analytics' },
  { key: 'design', label: 'Design' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'sales', label: 'Sales' },
  { key: 'finance', label: 'Finance' },
  { key: 'operations', label: 'Operations' },
  { key: 'hr', label: 'People & HR' },
  { key: 'other', label: 'Other' },
];

const AVATAR_STATES: AvatarState[] = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'acknowledging',
];

const MASCOT_POSES: MascotPose[] = ['wave', 'point', 'think', 'cheer', 'shrug'];

// Deterministic primary keys so every write is an idempotent upsert. The schema defaults
// ids to cuid; supplying them here is what makes re-running the seed a no-op.
const HR_PERSONA_ID = 'seed-persona-hr';
const TECH_PERSONA_ID = 'seed-persona-tech';
const INTERVIEW_ID = 'seed-interview-demo';
const HR_ROUND_ID = 'seed-round-hr';
const TECH_ROUND_ID = 'seed-round-tech';
const REPORT_ID = 'seed-report-demo';

const DEMO_ADMIN_EMAIL = 'admin@demo.com';
// A throwaway local credential for the demo stack. Stored only as an argon2id hash; the
// plaintext is echoed to the operator's terminal, never to the database (K8, K8.5).
//
// Issue #118: "overridable so a real deployment never carries it" was the whole guard, and an
// override nobody sets is not one — the published default reached the running stack. The
// fallback is now dev-only and `seedDemoAdmin` refuses to run in production at all, so the
// account this password opens cannot exist there to be opened.
const DEMO_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'AdminDemo1!';

// The two ElevenLabs voices the personas speak with. Real ids, not placeholders: a voice id
// the API does not know is a 400 on every question, retried three times and then a
// `VOICE_UNAVAILABLE` downgrade — voice looks broken rather than unconfigured, on every fresh
// clone. These are premade library voices, identical for every account and not credentials, so
// they belong in the seed rather than in `.env`. Overridable the way the demo password is, for
// a deployment that wants its own.
const HR_VOICE_ID = process.env.SEED_VOICE_ID_HR ?? 'EXAVITQu4vr4xnSDxMaL'; // Sarah
const TECH_VOICE_ID = process.env.SEED_VOICE_ID_TECH ?? 'JBFqnCBsd6RMkjVDRZzb'; // George

const SAMPLE_LISTING = readFileSync(
  join(__dirname, 'fixtures', 'sample-listing.txt'),
  'utf8'
);

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------

async function seedClusters() {
  for (const cluster of OCCUPATION_CLUSTERS) {
    await prisma.occupationCluster.upsert({
      where: { key: cluster.key },
      update: { label: cluster.label },
      create: cluster,
    });
  }
  console.log(`  occupation_clusters: ${OCCUPATION_CLUSTERS.length}`);
}

async function seedMascotSet() {
  for (const pose of MASCOT_POSES) {
    await putImage(`mascot/${pose}-${PLACEHOLDER_SHA256}.webp`);
  }
  console.log(`  mascot/: ${MASCOT_POSES.length} objects`);
}

async function seedPersonas() {
  const personas = [
    {
      id: HR_PERSONA_ID,
      role: 'hr',
      name: 'Ada',
      voice_id: HR_VOICE_ID,
      system_prompt:
        'You are Ada, an experienced HR interviewer. Ask one question at a time, ' +
        'stay warm but neutral, and never reveal your evaluation to the candidate.',
    },
    {
      id: TECH_PERSONA_ID,
      role: 'tech',
      name: 'Turing',
      voice_id: TECH_VOICE_ID,
      system_prompt:
        'You are Turing, a senior technical interviewer. Probe depth over breadth, ' +
        'ask one question at a time, and never supply the answer you are testing for.',
    },
  ];

  for (const persona of personas) {
    // avatar_set keys are content-addressed under personas/{id}/ (ui §3.6, infra K12).
    const avatar_set: Record<string, string> = {};
    for (const state of AVATAR_STATES) {
      avatar_set[state] = await putImage(
        `personas/${persona.id}/${state}-${PLACEHOLDER_SHA256}.webp`
      );
    }
    await prisma.persona.upsert({
      where: { id: persona.id },
      update: { ...persona, avatar_set, active: true },
      create: { ...persona, avatar_set, active: true },
    });
  }
  console.log(
    `  personas: ${personas.length} (each with ${AVATAR_STATES.length} avatar objects)`
  );
}

async function seedDemoAdmin() {
  const password_hash = await hash(DEMO_ADMIN_PASSWORD); // argon2id is @node-rs/argon2's default
  const admin = await prisma.user.upsert({
    where: { email_lower: DEMO_ADMIN_EMAIL },
    update: {
      password_hash,
      role: 'admin',
      // K8.6 — a seeded account that cannot start an interview under
      // EMAIL_VERIFICATION_REQUIRED=true would make the demo depend on a mailbox.
      email_verified_at: new Date(),
    },
    create: {
      email_lower: DEMO_ADMIN_EMAIL,
      password_hash,
      role: 'admin',
      locale: 'en',
      email_verified_at: new Date(),
      onboarding_completed_at: new Date(),
      profile: {
        fullName: 'Demo Admin',
        jobTitle: 'Platform Engineer',
        hobbies: ['climbing', 'chess'],
        interestsText: 'Distributed systems and developer tooling.',
      },
    },
  });
  console.log(`  users: demo admin ${DEMO_ADMIN_EMAIL} (password: ${DEMO_ADMIN_PASSWORD})`);
  return admin;
}

/** K15 per-question rows, shared by `reports.payload.questions[]` and `report_questions`. */
const QUESTION_SEEDS = [
  {
    id: 'seed-q-hr-1',
    round_id: HR_ROUND_ID,
    order_index: 1,
    text: 'Tell me about a project where you owned the outcome end to end.',
    kind: 'behavioral' as const,
    difficulty: 'easy' as const,
    topic: 'ownership',
    chosen_reason: 'score_mid' as const,
    transcript:
      'I led the migration of our scheduling service off a shared database. I scoped it, ' +
      'wrote the migration plan, ran it over three releases, and owned the rollback path. ' +
      'It shipped with no downtime and cut p95 latency by about 40 percent.',
    duration_ms: 74_000,
    score: 82,
    reason:
      'Clear situation and result with a concrete metric; the actions taken were specific ' +
      'and attributable to the candidate.',
    star_adherence: '0.85',
  },
  {
    id: 'seed-q-hr-2',
    round_id: HR_ROUND_ID,
    order_index: 2,
    text: 'Describe a disagreement with a colleague and how it was resolved.',
    kind: 'behavioral' as const,
    difficulty: 'medium' as const,
    topic: 'collaboration',
    chosen_reason: 'score_high' as const,
    transcript:
      'A teammate wanted to add a queue where I thought a database transaction was enough. ' +
      'We wrote both options down, measured the simpler one under load, and it held. We went ' +
      'with the transaction and revisited the decision a quarter later.',
    duration_ms: 61_000,
    score: 78,
    reason:
      'Handled the disagreement with evidence rather than seniority, and named the follow-up ' +
      'review. The result could have been stated more concretely.',
    star_adherence: '0.72',
  },
  {
    id: 'seed-q-tech-1',
    round_id: TECH_ROUND_ID,
    order_index: 1,
    text: 'How would you keep a job worker idempotent when the queue guarantees at-least-once delivery?',
    kind: 'technical' as const,
    difficulty: 'medium' as const,
    topic: 'async-processing',
    chosen_reason: 'score_mid' as const,
    transcript:
      'I would give each job a deterministic key derived from its payload, record that key ' +
      'in a uniqueness table inside the same transaction as the effect, and treat a unique ' +
      'violation as a successful no-op.',
    duration_ms: 98_000,
    score: 80,
    reason:
      'Correct approach: the dedup record and the effect share one transaction, which is the ' +
      'part most candidates miss. Did not mention retention of the dedup keys.',
    star_adherence: '0',
  },
  {
    id: 'seed-q-tech-2',
    round_id: TECH_ROUND_ID,
    order_index: 2,
    text: 'A Postgres query on a 50M-row table got slow after a deploy. Walk me through your diagnosis.',
    kind: 'technical' as const,
    difficulty: 'hard' as const,
    topic: 'databases',
    chosen_reason: 'score_low' as const,
    transcript:
      'I would check EXPLAIN ANALYZE first and then add an index if the plan shows a ' +
      'sequential scan.',
    duration_ms: 32_000,
    score: 38,
    reason:
      'Started in the right place but stopped there: no mention of what changed in the ' +
      'deploy, statistics staleness, parameter sniffing, or verifying the plan under real ' +
      'row counts before adding an index.',
    star_adherence: '0',
  },
];

async function seedSampleInterview(userId: string) {
  const cluster = await prisma.occupationCluster.findUniqueOrThrow({
    where: { key: 'software_engineering' },
  });

  const started_at = new Date('2026-07-29T09:00:00.000Z');
  const ended_at = new Date('2026-07-29T09:26:00.000Z');

  const interview: Prisma.InterviewUncheckedCreateInput = {
    id: INTERVIEW_ID,
    user_id: userId,
    mode: 'text',
    job_text: SAMPLE_LISTING,
    job_source: 'paste',
    occupation: 'Senior Backend Engineer',
    occupation_cluster_id: cluster.id,
    language: 'en',
    candidate_profile: {
      account: {
        fullName: 'Demo Admin',
        jobTitle: 'Platform Engineer',
        hobbies: ['climbing', 'chess'],
        interestsText: 'Distributed systems and developer tooling.',
      },
      perInterview: { yearsExperience: 6, targetSeniority: 'senior' },
    },
    target_question_count: QUESTION_SEEDS.length,
    hr_question_count: 2,
    state: 'completed',
    current_index: QUESTION_SEEDS.length,
    ended_reason: 'completed',
    started_at,
    ended_at,
  };

  await prisma.interview.upsert({
    where: { id: INTERVIEW_ID },
    update: interview,
    create: interview,
  });

  const rounds = [
    { id: HR_ROUND_ID, type: 'hr' as const, persona_id: HR_PERSONA_ID, score: 80 },
    { id: TECH_ROUND_ID, type: 'tech' as const, persona_id: TECH_PERSONA_ID, score: 62 },
  ];
  for (const round of rounds) {
    const data = { ...round, interview_id: INTERVIEW_ID, status: 'done' as const };
    await prisma.interviewRound.upsert({
      where: { id: round.id },
      update: data,
      create: data,
    });
  }

  for (const [i, q] of QUESTION_SEEDS.entries()) {
    const asked_at = new Date(started_at.getTime() + i * 6 * 60_000);
    const question = {
      id: q.id,
      round_id: q.round_id,
      order_index: q.order_index,
      text: q.text,
      kind: q.kind,
      difficulty: q.difficulty,
      topic: q.topic,
      chosen_reason: q.chosen_reason,
      asked_at,
    };
    await prisma.question.upsert({
      where: { id: q.id },
      update: question,
      create: question,
    });

    const answer = {
      id: q.id.replace('seed-q-', 'seed-a-'),
      question_id: q.id,
      transcript: q.transcript,
      input_mode: 'text' as const,
      started_at: asked_at,
      answered_at: new Date(asked_at.getTime() + q.duration_ms),
      duration_ms: q.duration_ms,
      // K4 shape — { overall, relevance, depth, structure, star_adherence, reasons[] }
      scores: {
        overall: q.score,
        relevance: q.score,
        depth: q.score,
        structure: q.score,
        star_adherence: Number(q.star_adherence),
        reasons: [q.reason],
      },
    };
    await prisma.answer.upsert({
      where: { id: answer.id },
      update: answer,
      create: answer,
    });
  }

  // K15 payload. `questions[]` is denormalised into report_questions below so K11's
  // "weakest questions" statistic is a plain relational query (db spec AC-12).
  const payload = {
    overall_impression:
      'A strong senior backend candidate. Ownership and collaboration answers were concrete ' +
      'and metric-backed, and the idempotency answer showed the transactional reasoning the ' +
      'role needs. Database diagnosis was the weak spot: the answer reached for an index ' +
      'before establishing what had actually changed. With a more systematic debugging ' +
      'narrative this would be a clear hire.',
    overall_score: 76,
    strengths: [
      'Owns outcomes end to end and can state the result in numbers.',
      'Resolves disagreement with measurement rather than seniority.',
      'Understands transactional idempotency, not just retry mechanics.',
    ],
    improvements: [
      'Diagnose before prescribing — establish what changed before proposing an index.',
      'Close behavioural answers with an explicit result.',
    ],
    rounds: [
      {
        type: 'hr',
        score: 80,
        summary:
          'Consistently concrete answers with clear ownership; STAR structure was mostly complete.',
      },
      {
        type: 'tech',
        score: 62,
        summary:
          'Solid on asynchronous correctness, thin on database performance diagnosis.',
        note: 'The performance question was answered at the level of a mid engineer.',
      },
    ],
    questions: QUESTION_SEEDS.map((q) => ({
      question_id: q.id,
      score: q.score,
      reason: q.reason,
      star_adherence: Number(q.star_adherence),
    })),
    language: 'en',
  };

  const report = {
    id: REPORT_ID,
    interview_id: INTERVIEW_ID,
    status: 'ready' as const,
    payload,
    prompt_uuid: 'interview.report.generate',
    prompt_version: 2,
  };
  await prisma.report.upsert({
    where: { id: REPORT_ID },
    update: report,
    create: report,
  });

  for (const q of QUESTION_SEEDS) {
    const rq = {
      id: q.id.replace('seed-q-', 'seed-rq-'),
      report_id: REPORT_ID,
      question_id: q.id,
      score: q.score,
      reason: q.reason,
      star_adherence: q.star_adherence,
    };
    await prisma.reportQuestion.upsert({ where: { id: rq.id }, update: rq, create: rq });
  }

  console.log(
    `  interviews: 1 sample (${rounds.length} rounds, ${QUESTION_SEEDS.length} questions, ` +
      '1 ready report)'
  );
}

async function main() {
  console.log(`Seeding ${S3_BUCKET} @ ${S3_ENDPOINT} and the database...`);
  await ensureBucket();
  await publishAssetPrefixes();
  await seedClusters();
  await seedMascotSet();
  await seedPersonas();
  // Issue #118: everything above is reference data every deployment needs. This pair is a dev
  // fixture — the admin's password is published in this repository, and `/admin` lists every
  // interview on the platform, so seeding it into production is a full-tenant exposure. A real
  // deployment needs an operator account it created itself, not one this file invented.
  //
  // Keyed on `isDeployed`, not on NODE_ENV alone (review on #268): the incident this guards
  // was `.env.example` shipped verbatim, and `NODE_ENV=development` is one of its lines.
  if (isDeployed(process.env.NODE_ENV, process.env.PUBLIC_ORIGIN)) {
    console.log(`  demo admin + sample interview: skipped (deployed — PUBLIC_ORIGIN=${process.env.PUBLIC_ORIGIN})`);
  } else {
    const admin = await seedDemoAdmin();
    console.log(`  sample listing: ${SAMPLE_LISTING.length} chars from prisma/fixtures/`);
    await seedSampleInterview(admin.id);
  }
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
