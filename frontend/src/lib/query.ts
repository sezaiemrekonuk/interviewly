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

import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import { SILENT_REFETCH_CODES } from './error-routing';
import type { SessionUser } from './use-require-auth';

/**
 * K11 — the seven server-state shapes, spelled once. A screen that writes a key by hand
 * eventually writes a *different* key, and the SSE nudge then invalidates a cache entry
 * nobody reads.
 */
export const queryKeys = {
  me: () => ['me'] as const,
  meProfile: () => ['me', 'profile'] as const,
  meInterviews: (cursor: string | null = null) => ['me', 'interviews', { cursor }] as const,
  interviewState: (id: string) => ['interview', id, 'state'] as const,
  interview: (id: string) => ['interview', id] as const,
  adminInterviews: (filters: Record<string, unknown> = {}) =>
    ['admin', 'interviews', filters] as const,
  adminStats: (filters: Record<string, unknown> = {}) => ['admin', 'stats', filters] as const,
};

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

/** `GET /admin/interviews` row (N01 audit projection — bypasses `userInterviews`, deleted included). */
export interface AdminInterviewRow {
  id: string;
  userId: string;
  state: string;
  deleted: boolean;
  occupation: string | null;
  occupationCluster: string | null;
  totalTokens: number;
  costUsd: string;
}
export interface AdminInterviewsPage {
  items: AdminInterviewRow[];
  nextCursor: string | null;
}

/** `enabled=false` while `useRequireAuth` resolves — a 401/403 fired at an unknown viewer is noise. */
export function useAdminInterviews(enabled = true): UseInfiniteQueryResult<
  InfiniteData<AdminInterviewsPage>,
  ApiError
> {
  return useInfiniteQuery({
    queryKey: queryKeys.adminInterviews(),
    queryFn: ({ pageParam }) =>
      fetchJson<AdminInterviewsPage>(
        pageParam
          ? `/admin/interviews?cursor=${encodeURIComponent(pageParam)}`
          : '/admin/interviews',
      ),
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
  perOccupation: { cluster: string; label: string; count: number }[];
  weakestQuestions: { questionId: string; score: number }[];
}

export function useAdminStats(enabled = true): UseQueryResult<AdminStatsResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.adminStats(),
    queryFn: () => fetchJson<AdminStatsResponse>('/admin/stats'),
    enabled,
  });
}

export function useMe(): UseQueryResult<{ user: SessionUser }, ApiError> {
  return useQuery({ queryKey: queryKeys.me(), queryFn: () => fetchJson<{ user: SessionUser }>('/me') });
}

export interface EducationRow {
  school: string;
  degree: string;
  field: string;
  graduationYear: number;
}

/** `users.profile` (A06 §3.3 layer 1). Every field optional — a fresh account has `{}`. */
export interface AccountProfile {
  fullName?: string;
  jobTitle?: string;
  dateOfBirth?: string;
  education?: EducationRow[];
  hobbies?: string[];
  interestsText?: string;
}

export interface ProfileResponse {
  profile: AccountProfile;
  onboardingCompletedAt: string | null;
  cvUploadId: string | null;
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
  | { step: 1; fields: Pick<AccountProfile, 'fullName' | 'jobTitle' | 'dateOfBirth'> }
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

/** One tile's identity. `avatarSet` carries the content-addressed keys (`personas.avatar_set`). */
export interface RoomPersona {
  id: string;
  role: string;
  name: string;
  roundType: 'hr' | 'tech';
  avatarSet: Record<string, string>;
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
  /** The ACTIVE speaker only — `null` outside a live round. */
  persona: { id: string; role: string; name: string; avatarState: string } | null;
  /** Both rounds' personas, hr then tech: the two tiles, never a second live speaker. */
  personas: RoomPersona[];
  currentQuestion: {
    id: string;
    text: string;
    kind: string;
    widget: unknown | null;
    deliveredAt: string;
  } | null;
  transcript: {
    questionId: string;
    question: string;
    answer: string;
    roundType: 'hr' | 'tech';
  }[];
  transcriptCursor: number;
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

/** I03 body — occupation/language are NOT sent (API gap, STATE blocker); server infers nothing. */
export interface CreateInterviewBody {
  mode: 'text' | 'voice';
  jobText?: string;
  uploadId?: string;
  targetQuestionCount: number;
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

/**
 * K15 `reports.payload`, verbatim — snake_case because the backend stores what the model
 * returned and `ReportPayloadSchema` (`packages/ai/src/schemas.ts`) gates those exact keys.
 * Every score is an integer 0..5. Renamed here and the read silently drifts from the gate.
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
