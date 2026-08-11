/**
 * What each console list may be searched and sorted by.
 *
 * A whitelist rather than a reflection over the Prisma model, deliberately. Reflection would
 * expose `password_hash` to `password_hash:*` the moment someone tried it, and would let a
 * search sort by a column with no index behind it. Every name here is a decision.
 *
 * The left-hand name is what an operator types, and it is short on purpose: `cost`, not
 * `spent_usd`. The column it maps to is the schema's business, not theirs.
 */
import type { TableSpec } from './query-language';

const INTERVIEW_STATES = [
  'created',
  'profiling',
  'hr_round',
  'tech_round',
  'paused',
  'evaluating',
  'completed',
  'abandoned',
  'failed',
] as const;

const ENDED_REASONS = [
  'completed',
  'cut_short',
  'budget_exhausted',
  'time_exhausted',
  'abandoned',
  'error',
] as const;

export const INTERVIEW_SPEC: TableSpec = {
  fields: {
    id: { path: 'id', kind: 'exact' },
    account: { path: 'user.email_lower', kind: 'text' },
    user: { path: 'user_id', kind: 'exact' },
    occupation: { path: 'occupation', kind: 'text' },
    cluster: { path: 'occupation_cluster.key', kind: 'exact' },
    state: { path: 'state', kind: 'enum', values: INTERVIEW_STATES },
    reason: { path: 'ended_reason', kind: 'enum', values: ENDED_REASONS },
    mode: { path: 'mode', kind: 'enum', values: ['voice', 'text'] },
    language: { path: 'language', kind: 'exact' },
    cost: { path: 'spent_usd', kind: 'decimal' },
    budget: { path: 'budget_usd', kind: 'decimal' },
    // `deleted:true` is the audit surface's whole reason for existing, so it is a first-class
    // term rather than something to be inferred from a missing row.
    deleted: { path: 'deleted_at', kind: 'presence' },
    created: { path: 'created_at', kind: 'date' },
    started: { path: 'started_at', kind: 'date' },
    ended: { path: 'ended_at', kind: 'date' },
  },
  freeText: ['id', 'account', 'occupation'],
  sortable: ['created', 'started', 'ended', 'cost', 'budget', 'state', 'occupation', 'account'],
  defaultSort: 'created',
};

export const CALL_SPEC: TableSpec = {
  fields: {
    id: { path: 'id', kind: 'exact' },
    interview: { path: 'interview_id', kind: 'exact' },
    provider: { path: 'provider', kind: 'text' },
    model: { path: 'model', kind: 'text' },
    prompt: { path: 'prompt_uuid', kind: 'text' },
    version: { path: 'prompt_version', kind: 'number' },
    attempt: { path: 'attempt_no', kind: 'number' },
    // `fellback:true` is "this call is a retry that a higher tier refused" — the only failure
    // signal `llm_calls` carries, since the table has no success column.
    fellback: { path: 'fell_back_from', kind: 'presence' },
    unit: { path: 'unit_kind', kind: 'enum', values: ['token', 'second', 'character'] },
    input: { path: 'input_tokens', kind: 'number' },
    output: { path: 'output_tokens', kind: 'number' },
    cost: { path: 'cost_usd', kind: 'decimal' },
    latency: { path: 'latency_ms', kind: 'number' },
    trace: { path: 'trace_id', kind: 'exact' },
    created: { path: 'created_at', kind: 'date' },
  },
  freeText: ['id', 'interview', 'provider', 'model', 'prompt', 'trace'],
  sortable: ['created', 'cost', 'latency', 'provider', 'model', 'version', 'attempt'],
  defaultSort: 'created',
};

export const USER_SPEC: TableSpec = {
  fields: {
    id: { path: 'id', kind: 'exact' },
    email: { path: 'email_lower', kind: 'text' },
    role: { path: 'role', kind: 'enum', values: ['admin', 'user'] },
    locale: { path: 'locale', kind: 'exact' },
    verified: { path: 'email_verified_at', kind: 'presence' },
    onboarded: { path: 'onboarding_completed_at', kind: 'presence' },
    // KVKK erasure. `erased:true` finds the anonymised shells a retention job will remove.
    erased: { path: 'deleted_at', kind: 'presence' },
    consent: { path: 'consent_version', kind: 'exact' },
    created: { path: 'created_at', kind: 'date' },
  },
  freeText: ['id', 'email'],
  // `interviews` sorts on the relation count, which Prisma expresses natively as
  // `orderBy: { interviews: { _count } }`. It is NOT filterable: Prisma has no count predicate
  // in `where`, and the two-query workaround (ids from a HAVING, then `id: { in: … }`) is an
  // unbounded id list on a table that only grows. `interviews>5` therefore comes back ignored
  // rather than silently approximated.
  sortable: ['created', 'email', 'role', 'interviews'],
  defaultSort: 'created',
  sortOverrides: { interviews: (dir) => ({ interviews: { _count: dir } }) },
};

export const SESSION_SPEC: TableSpec = {
  fields: {
    id: { path: 'id', kind: 'exact' },
    user: { path: 'user_id', kind: 'exact' },
    email: { path: 'user.email_lower', kind: 'text' },
    role: { path: 'user.role', kind: 'enum', values: ['admin', 'user'] },
    revoked: { path: 'revoked_at', kind: 'presence' },
    // Two columns and the server's clock, so it cannot be a leaf on one path. It earns a
    // `computed` field rather than staying the `?active=` parameter it was: a filter control
    // that covers every field except one is a control an operator stops trusting.
    active: {
      path: '',
      kind: 'computed',
      values: ['true', 'false'],
      build: (value, now) =>
        value === 'true'
          ? { revoked_at: null, expires_at: { gt: now } }
          : value === 'false'
            ? { OR: [{ revoked_at: { not: null } }, { expires_at: { lte: now } }] }
            : null,
    },
    expires: { path: 'expires_at', kind: 'date' },
    created: { path: 'created_at', kind: 'date' },
  },
  freeText: ['id', 'user', 'email'],
  sortable: ['created', 'expires', 'email'],
  defaultSort: 'created',
};

export const AUDIT_SPEC: TableSpec = {
  fields: {
    id: { path: 'id', kind: 'exact' },
    // `text` and not `exact`, so `action:security.*` prefix-matches a whole family and
    // `action:soft_deleted` finds `interview.soft_deleted` without the operator knowing the
    // dotted namespace by heart.
    action: { path: 'action', kind: 'text' },
    actor: { path: 'actor.email_lower', kind: 'text' },
    actorId: { path: 'actor_user_id', kind: 'exact' },
    type: { path: 'subject_type', kind: 'exact' },
    subject: { path: 'subject_id', kind: 'exact' },
    trace: { path: 'trace_id', kind: 'exact' },
    created: { path: 'created_at', kind: 'date' },
  },
  freeText: ['action', 'subject', 'trace', 'actor'],
  sortable: ['created', 'action', 'actor'],
  defaultSort: 'created',
};
