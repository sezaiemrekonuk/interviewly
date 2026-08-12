'use client';

import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm, apiUpload } from './api';
import { SILENT_REFETCH_CODES } from './error-routing';
import type { SessionUser } from './use-require-auth';

/**
 * K11 — the seven server-state shapes, spelled once. A screen that writes a key by hand
 * eventually writes a *different* key, and the SSE nudge then invalidates a cache entry
 * nobody reads.
 */
export const queryKeys = {
  authCapabilities: () => ['auth', 'capabilities'] as const,
  me: () => ['me'] as const,
  meProfile: () => ['me', 'profile'] as const,
  meInterviews: (cursor: string | null = null) => ['me', 'interviews', { cursor }] as const,
  meQuestions: (cursor: string | null = null) => ['me', 'questions', { cursor }] as const,
  meActivity: (month: string) => ['me', 'interviews', 'activity', month] as const,
  interviewState: (id: string) => ['interview', id, 'state'] as const,
  interview: (id: string) => ['interview', id] as const,
  adminInterviews: (filters: Record<string, unknown> = {}) =>
    ['admin', 'interviews', filters] as const,
  adminInterview: (id: string) => ['admin', 'interviews', id] as const,
  adminStats: (filters: Record<string, unknown> = {}) => ['admin', 'stats', filters] as const,
  adminCosts: (days: number) => ['admin', 'costs', { days }] as const,
  adminLlmCalls: (filters: Record<string, unknown> = {}) =>
    ['admin', 'llm-calls', filters] as const,
  adminUsers: (filters: Record<string, unknown> = {}) => ['admin', 'users', filters] as const,
  adminSessions: (filters: Record<string, unknown> = {}) =>
    ['admin', 'sessions', filters] as const,
  adminAudit: (filters: Record<string, unknown> = {}) => ['admin', 'audit', filters] as const,
  adminQueue: () => ['admin', 'queue'] as const,
};

/**
 * `?a=1&b=2` from the filter state, with the empty values dropped so an untouched control
 * cannot narrow anything. Written once because every admin list takes the same shape, and a
 * hand-built query string per section is how one of them ends up sending `state=undefined`.
 */
export function adminQuery(
  path: string,
  filters: Record<string, string | undefined>,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** A refused API call, carrying the stable code for `useErrorMessage`/`routeForError`. */
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ApiError';
  }
}

export async function fetchJson<T>(path: string): Promise<T> {
  const result = await apiGet<T>(path);
  if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
  return result.data as T;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 2, refetchOnWindowFocus: false },
      // Never a submit or a delete: a retried mutation is a second write. A state error
      // invalidates the state key instead and lets the refetch resolve truth.
      mutations: { retry: false },
    },
  });
}

/**
 * What every admin list echoes back alongside its rows.
 *
 * `query.ignored` is the important half: a term the backend could not understand is NOT
 * applied, and a console that dropped it silently would show an unnarrowed list to an operator
 * who believes they narrowed it.
 */
export interface AdminListMeta {
  /**
   * `fields` is the backend's own whitelist, carrying each field's kind and — for an enum —
   * its exact values. The console builds its filter controls from this rather than from a
   * local copy, so a dropdown can never offer an option the server would refuse.
   */
  query: { applied: string[]; ignored: string[]; fields: AdminFilterField[] };
  sort: { field: string; dir: 'asc' | 'desc'; sortable: string[] };
}

export interface AdminFilterField {
  name: string;
  kind: 'text' | 'exact' | 'enum' | 'number' | 'decimal' | 'date' | 'presence' | 'computed';
  values?: string[];
}

/** `GET /admin/interviews` row (N01 audit projection — bypasses `userInterviews`, deleted included). */
export interface AdminInterviewRow {
  id: string;
  userId: string;
  userEmail: string;
  state: string;
  deleted: boolean;
  occupation: string | null;
  occupationCluster: string | null;
  totalTokens: number;
  costUsd: string;
  budgetUsd: string;
  startedAt: string | null;
  createdAt: string;
}

/**
 * The three facets the backend accepts on `GET /admin/interviews`. An index signature rather
 * than three optional keys, so one filter type flows into `adminQuery` and the query key
 * without a cast at each call — the fields are documentation, the signature is the contract.
 */
export type AdminInterviewFilters = AdminFilters<'occupationCluster' | 'state' | 'userId'>;

/** A filter bag: the named facets, plus the index signature the query helpers need. */
export type AdminFilters<K extends string> = { [key in K]?: string } & Record<
  string,
  string | undefined
>;
export interface AdminInterviewsPage extends AdminListMeta {
  items: AdminInterviewRow[];
  nextCursor: string | null;
}

/** `enabled=false` while `useRequireAuth` resolves — a 401/403 fired at an unknown viewer is noise. */
export function useAdminInterviews(
  enabled = true,
  filters: AdminInterviewFilters = {},
): UseInfiniteQueryResult<InfiniteData<AdminInterviewsPage>, ApiError> {
  return useInfiniteQuery({
    // The filters are IN the key: a narrowed list is a different resource, and reusing one
    // cache entry for both would show the previous filter's rows for a frame after each change.
    queryKey: queryKeys.adminInterviews(filters),
    queryFn: ({ pageParam }) =>
      fetchJson<AdminInterviewsPage>(adminQuery('/admin/interviews', filters, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** `GET /admin/stats` (N02, fixed shape — render as returned, never recomputed). */
export interface AdminStatsResponse {
  averageDurationMs: number;
  completed: number;
  cutShort: number;
  unfinished: number;
  totalTokens: number;
  /** The platform total. The cost panel used to sum the loaded rows and say so. */
  totalCostUsd: string;
  perModel: {
    provider: string;
    model: string;
    calls: number;
    tokens: number;
    costUsd: string;
    averageLatencyMs: number;
  }[];
  perOccupation: { cluster: string; label: string; count: number }[];
  /** Issue 196: one row per question *wording*, not per scored answer. `score` is the mean
   *  over `sampleSize` answers — there is no id, because a wording spans many question rows. */
  weakestQuestions: { text: string; score: number; sampleSize: number }[];
}

export function useAdminStats(enabled = true): UseQueryResult<AdminStatsResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.adminStats(),
    queryFn: () => fetchJson<AdminStatsResponse>('/admin/stats'),
    enabled,
  });
}

export interface AdminCostModel {
  provider: string | null;
  model: string | null;
  costUsd: string;
  previousCostUsd: string;
  calls: number;
  tokens: number;
  averageLatencyMs: number;
  daily: string[];
}

export interface AdminCostsResponse {
  days: number;
  from: string;
  to: string;
  buckets: string[];
  daily: { costUsd: string[]; interviews: number[] };
  totals: { costUsd: string; calls: number; tokens: number; interviews: number };
  previous: { costUsd: string };
  models: AdminCostModel[];
  hourly: { dow: number; hour: number; costUsd: string }[];
}

export const COST_RANGES = [7, 30, 90] as const;

export type CostRange = (typeof COST_RANGES)[number];

export function useAdminCosts(
  enabled: boolean,
  days: CostRange,
): UseQueryResult<AdminCostsResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.adminCosts(days),
    queryFn: () => fetchJson<AdminCostsResponse>(`/admin/costs?days=${days}`),
    enabled,
  });
}

/** One `llm_calls` row, as both the drill-down and the model-calls list project it. */
export interface AdminCallRow {
  id: string;
  interviewId?: string;
  provider: string;
  model: string;
  promptUuid: string;
  promptVersion: number;
  attemptNo: number;
  fellBackFrom: string | null;
  units: string;
  unitKind: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string;
  latencyMs: number;
  traceId: string;
  createdAt: string;
}

/** `GET /admin/interviews/:id` (US-26/28/29) — one interview, its calls, and its events. */
export interface AdminInterviewDetail {
  interview: {
    id: string;
    userId: string;
    userEmail: string;
    mode: string;
    language: string;
    state: string;
    endedReason: string | null;
    deleted: boolean;
    occupation: string | null;
    occupationCluster: string | null;
    occupationLabel: string | null;
    targetQuestionCount: number;
    hrQuestionCount: number;
    budgetUsd: string;
    spentUsd: string;
    elapsedSeconds: number;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
    deletedAt: string | null;
    report: { status: string; promptUuid: string; promptVersion: number } | null;
  };
  calls: AdminCallRow[];
  callsTruncated: boolean;
  events: AdminEventRow[];
}

export interface AdminEventRow {
  id: string;
  action: string;
  actorUserId: string;
  traceId: string | null;
  metadata: unknown;
  createdAt: string;
}

export function useAdminInterview(
  id: string,
  enabled = true,
): UseQueryResult<AdminInterviewDetail, ApiError> {
  return useQuery({
    queryKey: queryKeys.adminInterview(id),
    queryFn: () => fetchJson<AdminInterviewDetail>(`/admin/interviews/${encodeURIComponent(id)}`),
    enabled,
  });
}

/** `GET /admin/llm-calls`. `facets` is the vocabulary the provider/model filters offer. */
export interface AdminCallsPage extends AdminListMeta {
  items: AdminCallRow[];
  facets: { provider: string; model: string; count: number }[];
  nextCursor: string | null;
}

export type AdminCallFilters = AdminFilters<'provider' | 'model' | 'interviewId'>;

export function useAdminLlmCalls(
  enabled = true,
  filters: AdminCallFilters = {},
): UseInfiniteQueryResult<InfiniteData<AdminCallsPage>, ApiError> {
  return useInfiniteQuery({
    queryKey: queryKeys.adminLlmCalls(filters),
    queryFn: ({ pageParam }) =>
      fetchJson<AdminCallsPage>(adminQuery('/admin/llm-calls', filters, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** `GET /admin/users` — the account join the interview list never had. */
export interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  locale: string;
  emailVerified: boolean;
  onboarded: boolean;
  consentVersion: string | null;
  consentedAt: string | null;
  erased: boolean;
  interviewCount: number;
  createdAt: string;
}

export interface AdminUsersPage extends AdminListMeta {
  items: AdminUserRow[];
  nextCursor: string | null;
}

export function useAdminUsers(
  enabled = true,
  filters: AdminFilters<'role' | 'q'> = {},
): UseInfiniteQueryResult<InfiniteData<AdminUsersPage>, ApiError> {
  return useInfiniteQuery({
    queryKey: queryKeys.adminUsers(filters),
    queryFn: ({ pageParam }) => fetchJson<AdminUsersPage>(adminQuery('/admin/users', filters, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** `GET /admin/sessions` — auth sessions. `active` is the server's answer, not the browser's. */
export interface AdminSessionRow {
  id: string;
  userId: string;
  userEmail: string;
  role: string;
  active: boolean;
  revokedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface AdminSessionsPage extends AdminListMeta {
  items: AdminSessionRow[];
  nextCursor: string | null;
}

export function useAdminSessions(
  enabled = true,
  filters: AdminFilters<'userId' | 'active'> = {},
): UseInfiniteQueryResult<InfiniteData<AdminSessionsPage>, ApiError> {
  return useInfiniteQuery({
    queryKey: queryKeys.adminSessions(filters),
    queryFn: ({ pageParam }) =>
      fetchJson<AdminSessionsPage>(adminQuery('/admin/sessions', filters, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** `GET /admin/audit` — the durable record issue 86 wrote and nothing read until now. */
export interface AdminAuditRow extends AdminEventRow {
  actorEmail: string;
  actorRole: string;
  subjectType: string;
  subjectId: string | null;
}

export interface AdminAuditPage extends AdminListMeta {
  items: AdminAuditRow[];
  actions: { action: string; count: number }[];
  nextCursor: string | null;
}

export function useAdminAudit(
  enabled = true,
  filters: AdminFilters<'action' | 'actorUserId' | 'subjectId'> = {},
): UseInfiniteQueryResult<InfiniteData<AdminAuditPage>, ApiError> {
  return useInfiniteQuery({
    queryKey: queryKeys.adminAudit(filters),
    queryFn: ({ pageParam }) =>
      fetchJson<AdminAuditPage>(adminQuery('/admin/audit', filters, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** `GET /admin/queue` — BullMQ depth and the dead letter (issue 095). */
export interface AdminQueueResponse {
  queues: {
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
  }[];
  deadLetter: {
    id: string;
    interviewId: string;
    attemptsMade: number;
    failedReason: string | null;
    failedAt: string | null;
  }[];
}

export function useAdminQueue(enabled = true): UseQueryResult<AdminQueueResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.adminQueue(),
    queryFn: () => fetchJson<AdminQueueResponse>('/admin/queue'),
    // Depth is the one admin figure that is stale the moment it lands. Thirty seconds is a
    // compromise: often enough that a growing backlog is visible, rare enough that an open
    // tab is not a load generator against Redis.
    refetchInterval: 30_000,
    enabled,
  });
}

/** `GET /auth/capabilities` — which sign-in providers this deployment can actually serve. */
export interface AuthCapabilities {
  oauth: { google: boolean };
}

/**
 * Deployment config, not user state: it cannot change while the tab is open, so one fetch
 * per session is all the auth screens need and a refetch would only add a request to each
 * of them. Unauthenticated — the sign-in screen asks it before anyone has a session.
 */
export function useAuthCapabilities(): UseQueryResult<AuthCapabilities, ApiError> {
  return useQuery({
    queryKey: queryKeys.authCapabilities(),
    queryFn: () => fetchJson<AuthCapabilities>('/auth/capabilities'),
    staleTime: Infinity,
  });
}

export function useMe(): UseQueryResult<{ user: SessionUser }, ApiError> {
  return useQuery({ queryKey: queryKeys.me(), queryFn: () => fetchJson<{ user: SessionUser }>('/me') });
}

/**
 * One education entry. School is the only required field; everything else is what the entry
 * form offers and the entry card shows when it is there.
 *
 * `graduationYear` is the older shape, still sitting in profiles saved before the entry form
 * existed. It is read as `endYear` and never written again.
 */
export interface EducationRow {
  school: string;
  degree?: string;
  field?: string;
  startYear?: number;
  endYear?: number;
  grade?: string;
  description?: string;
  /** @deprecated read-only compatibility with profiles saved before `endYear`. */
  graduationYear?: number;
}

/** `users.profile` (A06 §3.3 layer 1). Every field optional — a fresh account has `{}`. */
export interface AccountProfile {
  fullName?: string;
  jobTitle?: string;
  /** Contact detail for the account. Stripped before the interview snapshot, like the DOB. */
  phone?: string;
  dateOfBirth?: string;
  education?: EducationRow[];
  hobbies?: string[];
  interestsText?: string;
}

/** The CV currently on the account (`users.cv_upload_id`), or null. */
export interface CvUpload {
  id: string;
  /** The uploader's own filename, sanitised. Null for CVs stored before it was recorded. */
  filename: string | null;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface ProfileResponse {
  profile: AccountProfile;
  onboardingCompletedAt: string | null;
  cvUploadId: string | null;
  cv: CvUpload | null;
}

/**
 * `POST /auth/logout` (`backend/modules/auth/logout.ts`) — revokes the session row and clears
 * the cookie, 204 either way.
 *
 * The cache is *cleared*, not invalidated: invalidation refetches, and refetching `/me`
 * immediately after ending a session asks the API to confirm the thing we just destroyed. It
 * also has to happen before the navigation, or the next account to sign in on this machine
 * paints the previous one's name for a frame.
 *
 * A refused logout still clears and still navigates. The session is dead server-side in every
 * case worth handling, and a user who pressed Sign out on a shared machine must never be left
 * looking at their own account because a request failed.
 */
export function useSignOut(): UseMutationResult<void, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiPost('/auth/logout', {});
    },
    onSettled: () => client.clear(),
  });
}

/**
 * `PATCH /me/locale` (issue 76) — persists the switcher's choice on the account, which is
 * where the mail worker and the interview generator read the language from. The cookie alone
 * only ever reached UI copy.
 *
 * A refusal is deliberately not surfaced: the switcher has to keep working for a visitor with
 * no session, and `UNAUTHENTICATED` there means "no row to write", not something they can act
 * on. The cookie has already switched the interface by the time this resolves either way.
 */
export function useSaveLocale(): UseMutationResult<boolean, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (locale: string) => {
      const result = await apiPatch('/me/locale', { locale });
      if (!result.ok) {
        if (result.code === 'UNAUTHENTICATED') return false;
        throw new ApiError(result.code ?? 'UNKNOWN');
      }
      return true;
    },
    onSuccess: (saved) => {
      if (saved) void client.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });
}

/** `enabled=false` while `useRequireAuth` is still resolving — an anonymous 401 here is noise. */
export function useProfile(enabled = true): UseQueryResult<ProfileResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.meProfile(),
    queryFn: () => fetchJson<ProfileResponse>('/me/profile'),
    enabled,
  });
}

export type ProfileCard =
  | { step: 1; fields: Pick<AccountProfile, 'fullName' | 'jobTitle' | 'phone' | 'dateOfBirth'> }
  | { step: 2; fields: { education: EducationRow[] } }
  | { step: 3; fields: Pick<AccountProfile, 'hobbies' | 'interestsText'> };

/**
 * A06 merge-not-replace: one card, one PATCH, carrying only that card's fields. Never
 * retried (a refused save is shown, not repeated) and it invalidates the profile so a
 * back-nav re-hydrates the draft from the server's copy.
 */
export function useSaveProfileCard(): UseMutationResult<
  { profile: AccountProfile },
  ApiError,
  ProfileCard
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (card: ProfileCard) => {
      const result = await apiPatch<{ profile: AccountProfile }>('/me/profile', card);
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data as { profile: AccountProfile };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.meProfile() }),
  });
}

/**
 * A06 `kind='cv'`. The upload *is* the write: `POST /uploads` repoints `users.cv_upload_id`
 * and caches the extracted text, so the answer only has to invalidate the profile. Holding
 * the returned id in page state instead is what made "CV received" a lie the moment the page
 * reloaded (issue 62) — the id is never read back from here for that reason.
 */
export function useUploadCv(): UseMutationResult<{ uploadId: string }, ApiError, File> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const result = await apiUpload<{ uploadId: string }>('cv', file);
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data as { uploadId: string };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.meProfile() }),
  });
}

/** One row of `GET /me/interviews` (N01 `my-interviews.ts`) — no cost or token figures. */
export interface MyInterview {
  id: string;
  state: string;
  mode: 'text' | 'voice';
  occupation: string | null;
  endedReason: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /**
   * `reports.payload.overall_score`, projected onto the list row so a trend across interviews
   * is one request instead of one per interview. Null until a report is `ready` — an interview
   * that is still running, or whose report failed, has no score rather than a zero.
   */
  overallScore: number | null;
  /** `payload.rounds[].score`, split by `type`. Either side is null if that round has none. */
  roundScores: { hr: number | null; tech: number | null };
}

/**
 * One answered question, from `GET /me/questions` — every question the account has answered,
 * across every interview, newest first.
 *
 * Two different scores live here and they are not the same measurement. `score`/`reason` come
 * from `report_questions`, written once when the report is generated. `answerScores` is
 * `answers.scores`, written per answer as the interview runs (`interview/adaptive.ts`) — four
 * axes and the model's own notes. Both are optional: an interview with no report has the
 * second and not the first.
 */
export interface MyQuestion {
  questionId: string;
  interviewId: string;
  occupation: string | null;
  roundType: 'hr' | 'tech';
  text: string;
  answeredAt: string | null;
  durationMs: number | null;
  score: number | null;
  reason: string | null;
  starAdherence: number | null;
  answerScores: {
    overall: number;
    relevance: number;
    depth: number;
    structure: number;
    starAdherence: number;
    reasons: string[];
  } | null;
}

export interface MyQuestionsPage {
  items: MyQuestion[];
  nextCursor: string | null;
}

/**
 * The question history, paged the same way the interview list is. Separate from
 * `useMyInterviews` on purpose: `/interviews` reads both, but the briefing home only needs the
 * weakest few and should not pull a whole interview list to find them.
 */
export function useMyQuestions(
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<MyQuestionsPage>, ApiError> {
  return useInfiniteQuery({
    enabled,
    queryKey: queryKeys.meQuestions(),
    queryFn: ({ pageParam }) =>
      fetchJson<MyQuestionsPage>(
        pageParam ? `/me/questions?cursor=${encodeURIComponent(pageParam)}` : '/me/questions',
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: MyQuestionsPage) => last.nextCursor,
  });
}

export interface MyInterviewsPage {
  items: MyInterview[];
  nextCursor: string | null;
}

/**
 * W08 — cursor pages, never offset. One key for the whole list (`{cursor: null}`) because
 * `useInfiniteQuery` holds the pages: a per-cursor key would make the delete invalidation
 * chase every page it had ever fetched.
 */
export function useMyInterviews(
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<MyInterviewsPage>, ApiError> {
  return useInfiniteQuery({
    queryKey: queryKeys.meInterviews(),
    queryFn: ({ pageParam }) =>
      fetchJson<MyInterviewsPage>(
        pageParam ? `/me/interviews?cursor=${encodeURIComponent(pageParam)}` : '/me/interviews',
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** One day of the practice grid. Only days the account practised on are sent (issue 245). */
export interface ActivityDay {
  /** `YYYY-MM-DD`, UTC — the day the interview was started. */
  date: string;
  count: number;
}

export interface MonthActivity {
  month: string;
  days: ActivityDay[];
  /** The busiest day of this month, and therefore the top of the shading scale. */
  max: number;
  /** `YYYY-MM` of the account's first started interview, or null — the picker's floor. */
  earliest: string | null;
}

/**
 * The month grid's own read, deliberately not derived from `useMyInterviews`: that answers
 * twenty rows, which is neither a whole month nor an old one (issue 245).
 *
 * `placeholderData` holds the month already on screen while the next one loads, so stepping
 * through months redraws rather than blanking — the grid is the thing being navigated, and a
 * flash of empty cells reads as "you did nothing that month".
 */
export function useMonthActivity(
  month: string,
  enabled = true,
): UseQueryResult<MonthActivity, ApiError> {
  return useQuery({
    queryKey: queryKeys.meActivity(month),
    queryFn: () => fetchJson<MonthActivity>(`/me/interviews/activity?month=${month}`),
    placeholderData: (previous) => previous,
    enabled,
  });
}

/**
 * W08 — soft delete. Not retried (W02 policy: a repeated DELETE is a second write) and not
 * optimistic: the row goes on the refetch, so a refusal never resurrects a row the list
 * already dropped.
 */
export function useDeleteInterview(): UseMutationResult<void, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await apiDelete(`/interviews/${id}`);
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.meInterviews() }),
  });
}

/**
 * `DELETE /me` — KVKK/GDPR erasure (issue 009). The whole cache is dropped rather than
 * invalidated: every key in it belongs to an account that no longer exists, and a refetch
 * of `/me` would only answer 401.
 */
export function useDeleteAccount(): UseMutationResult<void, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await apiDelete('/me');
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
    },
    onSuccess: () => client.clear(),
  });
}

/** One tile's identity. `avatarSet` carries the content-addressed keys (`personas.avatar_set`). */
export interface RoomPersona {
  id: string;
  role: string;
  name: string;
  roundType: 'hr' | 'tech';
  avatarSet: Record<string, string>;
}

/**
 * C04 — the typed answer surface the conductor put on screen for the current question, when it
 * asked for one. Mirrors `WidgetSchema` (`packages/ai/src/schemas.ts`), which is the gate the
 * server writes through: `options` is required by `choice` and meaningless to `textbox`.
 *
 * It hangs off `currentQuestion`, not off the message that announced it, because the surface is
 * a property of the question — a refresh has to re-render the box and the message is prose.
 */
export interface RoomWidget {
  kind: 'textbox' | 'choice';
  label: string;
  options?: string[];
}

/**
 * C02 — one utterance in the conversation, which since the conductor landed is the interview's
 * actual state. Not the same view as `transcript`: that is question/answer pairs for the report,
 * this is everything that was said in order, including what a pair cannot hold — the welcome,
 * the clarifications, the handover, and the system line where the server overrode the
 * interviewer.
 *
 * `action` is what the server did with the turn AFTER clamping (`conductor.ts` re-derives it),
 * never what the model asked for, so a client may read it as fact. Null on user and older rows.
 * `id` is the only stable handle on a message: it survives a refetch, an index does not, and it
 * is what `…/messages/:id/speech` is keyed by.
 */
export interface RoomMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  action:
    | 'continue'
    | 'next_question'
    | 'handover'
    | 'end_interview'
    | 'show_widget'
    | 'drift'
    | null;
  questionId: string | null;
  /** Which interviewer said it; null for lines belonging to no question. */
  roundType: 'hr' | 'tech' | null;
  createdAt: string;
}

/** The single room truth (`GET /interviews/:id/state`) — see REFERENCE for the shape. */
export interface InterviewStateResponse {
  interviewId: string;
  state: string;
  mode: 'text' | 'voice';
  currentIndex: number;
  targetQuestionCount: number;
  endedReason: string | null;
  language: string;
  /** Server-stamped; null until the interview started. The interview's date, nothing more. */
  startedAt: string | null;
  /**
   * I16 — seconds the candidate has actually spent in the room, which is what the rail shows.
   * Not `now - startedAt`: leaving and returning an hour later resumes the clock where it
   * stopped. A snapshot as of the response, so a reader ticks forward from when it arrived
   * rather than treating it as still current (`useRoomElapsed`).
   */
  elapsedSeconds: number;
  /**
   * The instant the speech ceiling ends the interview (S09). Null in text mode and before the
   * start — the ceiling bounds voice only. Never recomputed here: the countdown re-derives from
   * this on every tick so it cannot promise time the server will refuse.
   *
   * Since I16 it can move *later* as well as earlier — it is now `now + seconds of active time
   * left`, so a break pushes it out by however long the break was.
   */
  expiresAt: string | null;
  /** The ACTIVE speaker only — `null` outside a live round. */
  persona: { id: string; role: string; name: string; avatarState: string; avatar: number } | null;
  /** Both rounds' personas, hr then tech: the two tiles, never a second live speaker. */
  personas: RoomPersona[];
  currentQuestion: {
    id: string;
    text: string;
    kind: string;
    widget: RoomWidget | null;
    deliveredAt: string;
  } | null;
  transcript: {
    questionId: string;
    question: string;
    answer: string;
    roundType: 'hr' | 'tech';
  }[];
  /** The conversation, oldest first. A room rebuilds itself from this alone (§3.8). */
  messages: RoomMessage[];
  transcriptCursor: number;
  /**
   * T03 — the half-sentence the gate is holding for the CURRENT question, or null. Read with a
   * plain `GET`: two refreshes see the same text and a polling client cannot eat its own answer.
   */
  pendingTurn: string | null;
}

export function useInterviewState(
  id: string | null,
): UseQueryResult<InterviewStateResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.interviewState(id ?? ''),
    queryFn: () => {
      if (!id) throw new ApiError('UNKNOWN');
      return fetchJson<InterviewStateResponse>(`/interviews/${id}/state`);
    },
    enabled: Boolean(id),
  });
}

/**
 * I03 body. Occupation and language are not sent and never were: the server classifies the
 * occupation from the listing and takes the language off the session.
 *
 * `hrQuestionCount` is the custom shape only — omitted, the server applies its own 40/60 split.
 */
export interface CreateInterviewBody {
  mode: 'text' | 'voice';
  jobText?: string;
  uploadId?: string;
  targetQuestionCount: number;
  hrQuestionCount?: number;
}

/** I03's 201 — no occupation/language/cluster back either. Round split only. */
export interface CreateInterviewResponse {
  interviewId: string;
  hrCount: number;
  techCount: number;
}

/** W05 — never retried, the room is entered only after this resolves (no optimistic nav). */
export function useCreateInterview(): UseMutationResult<
  CreateInterviewResponse,
  ApiError,
  CreateInterviewBody
> {
  return useMutation({
    mutationFn: async (body: CreateInterviewBody) => {
      const result = await apiPost<CreateInterviewResponse>('/interviews', body);
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data as CreateInterviewResponse;
    },
  });
}

/**
 * I05 body — layer 2, the per-interview pre-questions, or a skip. `{ skip: true }` is the
 * whole body for the no-form path setup uses today.
 */
export type SubmitProfileBody = { skip: true } | { perInterview: Record<string, unknown> };

/**
 * `POST /interviews/:id/profile` — the only edge out of `profiling`, and the call that
 * generates the HR batch. Setup fires it between create and navigation so an interview never
 * reaches the room parked in `profiling` (issue 53). Never retried, matching W02.
 */
export function useSubmitProfile(): UseMutationResult<
  { state: string },
  ApiError,
  { interviewId: string; body: SubmitProfileBody }
> {
  return useMutation({
    mutationFn: async ({ interviewId, body }) => {
      const result = await apiPost<{ state: string }>(`/interviews/${interviewId}/profile`, body);
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data as { state: string };
    },
  });
}

export interface SubmitAnswerBody {
  questionId: string;
  transcript: string;
  inputMode: 'text';
}


/**
 * I06 — never retried (W02 mutation policy). The silent refetch for the "client is behind"
 * codes lives here, not in the composer: every caller of this mutation owes the same
 * reconciliation, and a second caller (W10's voice submit) would otherwise have to remember it.
 * `routeForError` owns which codes those are (§4.5).
 */
export function useSubmitAnswer(
  interviewId: string,
): UseMutationResult<unknown, ApiError, SubmitAnswerBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: SubmitAnswerBody) => {
      const result = await apiPost(`/interviews/${interviewId}/answers`, body);
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data;
    },
    onError: (err) => {
      if (SILENT_REFETCH_CODES.has(err.code)) {
        void client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) });
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) }),
  });
}

export interface SubmitAudioAnswerBody {
  questionId: string;
  audio: Blob;
}

/**
 * S06 — the recorded twin of `useSubmitAnswer`, not its replacement: `POST …/answers/audio`
 * transcribes and then runs the SAME I06 advance, so both mutations owe the same
 * reconciliation and invalidate the same key.
 *
 * The part's media type is sent bare. `MediaRecorder` reports `audio/webm;codecs=opus`, and the
 * backend allow-list (`stt.ts`) carries media types, not codec strings.
 */
export function useSubmitAudioAnswer(
  interviewId: string,
): UseMutationResult<unknown, ApiError, SubmitAudioAnswerBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ questionId, audio }: SubmitAudioAnswerBody) => {
      const type = (audio.type || 'audio/webm').split(';')[0];
      const form = new FormData();
      form.append('questionId', questionId);
      form.append('audio', new File([audio], 'answer', { type }), 'answer');
      const result = await apiPostForm(`/interviews/${interviewId}/answers/audio`, form);
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data;
    },
    onError: (err) => {
      if (SILENT_REFETCH_CODES.has(err.code)) {
        void client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) });
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) }),
  });
}

/** How the candidate produced it. `widget` is C04's typed surface, not a third input device. */
export type TurnInputMode = 'text' | 'voice' | 'widget';

/**
 * T03/T04 — `silence` is a turn with no text, and the union is what keeps it that way: the
 * server's schema drops any text arriving on one, and a body that could carry both would let
 * this client decide what a silent turn "said".
 */
export type SubmitTurnBody =
  | { kind?: 'utterance'; text: string; inputMode: TurnInputMode }
  | { kind: 'silence'; inputMode: TurnInputMode };

/**
 * C02 — `POST /interviews/:id/turns`, the conversational path, and deliberately not a second
 * shape of `POST /answers`. `/answers` promises "this is the answer to question X, advance",
 * which is why it takes a `questionId` and 409s on the wrong one. A turn promises none of that:
 * the candidate may be answering, clarifying, asking something back or saying nothing useful,
 * and whether the question advances is the conductor's call. So there is no question to name —
 * sending one would only let the client assert a progression it does not own (K11).
 *
 * `{ state, currentIndex }` comes back and is thrown away here on purpose: the room reads both
 * off the `interviewState` refetch below, and a mutation result that raced that refetch would be
 * a second source of truth for the one thing K11 says has exactly one. Same silent-refetch
 * reconciliation as `useSubmitAnswer` — every caller of a progression route owes it, and
 * `routeForError` owns which codes those are (§4.5). Never retried (W02).
 */
export function useSubmitTurn(
  interviewId: string,
): UseMutationResult<unknown, ApiError, SubmitTurnBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: SubmitTurnBody) => {
      const result = await apiPost(`/interviews/${interviewId}/turns`, body);
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data;
    },
    onError: (err) => {
      if (SILENT_REFETCH_CODES.has(err.code)) {
        void client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) });
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) }),
  });
}

export interface SubmitAudioTurnBody {
  audio: Blob;
  /**
   * T04 — the manual Stop, and nothing else. It skips the completeness gate, never a ceiling:
   * the candidate ending their own turn is the escape hatch ADR-S06 kept visible.
   */
  force?: boolean;
}

/**
 * T03's wire, on every path of `POST /turns/audio`. `pendingTurn` non-null means the gate called
 * the utterance unfinished: nothing was conducted, no row was written, and the room keeps
 * listening. Null means the turn happened — `state`/`currentIndex` are still read off the state
 * refetch rather than from here (K11), so only this field is consumed.
 */
export interface SubmitAudioTurnResult {
  pendingTurn: string | null;
}

/**
 * The recorded twin of `useSubmitTurn` (`POST …/turns/audio`): transcribes, then runs the SAME
 * conductor turn, so both owe the same reconciliation and invalidate the same key. No
 * `questionId` in the part list either — see above, the server decides what the utterance was
 * about.
 *
 * The part's media type is sent bare. `MediaRecorder` reports `audio/webm;codecs=opus`, and the
 * backend allow-list (`stt.ts`) carries media types, not codec strings.
 */
export function useSubmitAudioTurn(
  interviewId: string,
): UseMutationResult<SubmitAudioTurnResult, ApiError, SubmitAudioTurnBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ audio, force }: SubmitAudioTurnBody) => {
      const type = (audio.type || 'audio/webm').split(';')[0];
      const form = new FormData();
      form.append('audio', new File([audio], 'answer', { type }), 'answer');
      // The route's only field, and only when it is true: `stt.ts` refuses any other name and
      // any other value, so an omitted `force` and `force=0` must not be the same request.
      if (force) form.append('force', '1');
      const result = await apiPostForm<SubmitAudioTurnResult>(
        `/interviews/${interviewId}/turns/audio`,
        form,
      );
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      // A pre-T03 body has no `pendingTurn`; absent is "nothing held", never "held undefined".
      return { pendingTurn: result.data?.pendingTurn ?? null };
    },
    onError: (err) => {
      if (SILENT_REFETCH_CODES.has(err.code)) {
        void client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) });
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) }),
  });
}

/**
 * K15 `reports.payload`, verbatim — snake_case because the backend stores what the model
 * returned and `ReportPayloadSchema` (`packages/ai/src/schemas.ts`) gates those exact keys.
 * Every score is an integer 0..100. Renamed here and the read silently drifts from the gate.
 */
export interface ReportPayload {
  overall_impression: string;
  overall_score: number;
  strengths: string[];
  improvements: string[];
  rounds: { type: 'hr' | 'tech'; score: number; summary: string; note?: string }[];
  questions: { question_id: string; score: number; reason: string; star_adherence: number }[];
  language: string;
}

/** `GET /interviews/:id` (R01) — thin by design: transcript/endedReason come from state (ADR-W08). */
export interface ReportResponse {
  interviewId: string;
  state: string;
  report: { status: string; payload: ReportPayload } | null;
}

/** 12 polls at 5 s covers the §8.1 < 60 s report budget; the page stops asking at the ceiling. */
const REPORT_POLL_MS = 5_000;

/**
 * W07. SSE (`useInterviewEvents`) is primary — this `refetchInterval` is the fallback for a
 * silent stream, so it is off unless the caller is inside the wait budget AND no report has
 * landed. An always-on interval would hammer `/interviews/:id` for every completed report.
 */
export function useReport(
  id: string | null,
  poll = false,
): UseQueryResult<ReportResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.interview(id ?? ''),
    queryFn: () => {
      if (!id) throw new ApiError('UNKNOWN');
      return fetchJson<ReportResponse>(`/interviews/${id}`);
    },
    enabled: Boolean(id),
    refetchInterval: (query) => (poll && !query.state.data?.report ? REPORT_POLL_MS : false),
  });
}

/**
 * `GET /interviews/:id/report/download` (issue 63) — a mutation, not a query: the signed
 * URL carries a TTL (`MAX_TTL_SECONDS`), so it is minted on click, never on page load or
 * cached. `INTERVIEW_NOT_FOUND` here means "no `pdf_key` yet" as often as "not yours"
 * (ADR-I11) — the caller shows an inline "not ready" state, it never routes off the page.
 */
export function useReportDownload(id: string): UseMutationResult<{ url: string }, ApiError, void> {
  return useMutation({
    mutationFn: () => fetchJson<{ url: string }>(`/interviews/${id}/report/download`),
  });
}

/** I07 — resume from `paused`; `BUDGET_EXCEEDED` refetches into `evaluating` (W07's surface). */
export function useResumeInterview(
  interviewId: string,
): UseMutationResult<unknown, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await apiPost(`/interviews/${interviewId}/resume`, {});
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data;
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) }),
  });
}

/**
 * `POST /interviews/:id/abandon` (issue 104) — the room's Leave, once confirmed.
 *
 * Returns the state it landed in, which the caller needs: a run with answers goes to
 * `evaluating` and its report, one without ends at `abandoned` and has none. Both list
 * caches are invalidated because the row's state and `endedReason` both just changed, and
 * the home list renders "in progress" off exactly those.
 */
export function useAbandonInterview(
  interviewId: string,
): UseMutationResult<{ state: string }, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await apiPost<{ state: string }>(`/interviews/${interviewId}/abandon`, {});
      if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN');
      return result.data as { state: string };
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) });
      void client.invalidateQueries({ queryKey: queryKeys.meInterviews() });
    },
  });
}

/**
 * `GET /me/interviews` row (N01 `my-interviews.ts`). No score and no cost: the candidate
 * list is deliberately thinner than the admin audit, so the score lives on the report.
 */
export interface InterviewListItem {
  id: string;
  state: string;
  mode: string;
  occupation: string | null;
  endedReason: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface InterviewListPage {
  items: InterviewListItem[];
  nextCursor: string | null;
}

/**
 * Cursor pagination (K11 — no offset paging); one page per opaque `nextCursor`.
 * `enabled=false` while `useRequireAuth` resolves — an anonymous 401 here is noise.
 */
export function useInterviewList(enabled = true): UseInfiniteQueryResult<
  { pages: InterviewListPage[] },
  ApiError
> {
  return useInfiniteQuery({
    enabled,
    queryKey: queryKeys.meInterviews(),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      fetchJson<InterviewListPage>(
        `/me/interviews${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: InterviewListPage) => lastPage.nextCursor,
  });
}
