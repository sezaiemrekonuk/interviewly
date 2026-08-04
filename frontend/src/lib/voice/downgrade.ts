import { apiPost } from '@/lib/api';

/**
 * POST /interviews/:id/voice/downgrade — set mode=text via the V03 path.
 * Call when microphone permission is denied before any mint occurs.
 */
export function voiceDowngrade(interviewId: string) {
  return apiPost(`/interviews/${interviewId}/voice/downgrade`, {});
}
