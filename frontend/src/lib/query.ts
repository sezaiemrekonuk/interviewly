'use client';

import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiGet, apiPatch, apiPost } from './api';
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

/** The single room truth (`GET /interviews/:id/state`) — see REFERENCE for the shape. */
export interface InterviewStateResponse {
  interviewId: string;
  state: string;
  mode: 'text' | 'voice';
  currentIndex: number;
  targetQuestionCount: number;
  endedReason: string | null;
  language: string;
  persona: { role: string; name: string; avatarState: string };
  currentQuestion: {
    id: string;
    text: string;
    kind: string;
    widget: unknown | null;
    deliveredAt: string;
  } | null;
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
