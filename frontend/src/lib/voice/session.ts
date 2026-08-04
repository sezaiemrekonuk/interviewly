import { apiPost } from '@/lib/api';

export interface VoiceSessionData {
  token: string;
  wssOrigin: string;
  dynamicVars: { interviewId: string; nonce: string };
  expiresAt: string;
}

/** POST /interviews/:id/voice/session — mint a voice session token. */
export function mintVoiceSession(interviewId: string) {
  return apiPost<VoiceSessionData>(`/interviews/${interviewId}/voice/session`, {});
}
