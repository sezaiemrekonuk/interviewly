'use client';

import { QueryClient, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiGet } from './api';
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
