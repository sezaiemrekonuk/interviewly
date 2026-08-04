import type { AvatarState } from '@interviewly/types';

export type { AvatarState };

/** Client-only lifecycle phase, driven between refetches (REFERENCE §3.8). */
export type RoomPhase =
  | 'awaiting-next'
  | 'typing-question'
  | 'awaiting-answer'
  | 'just-submitted'
  | 'settled';

const PHASE_TO_STATE: Record<Exclude<RoomPhase, 'settled'>, AvatarState> = {
  'awaiting-next': 'thinking',
  'typing-question': 'speaking',
  'awaiting-answer': 'listening',
  'just-submitted': 'acknowledging',
};

const AVATAR_STATES: string[] = ['idle', 'listening', 'thinking', 'speaking', 'acknowledging'];

/** The states the room has a live speaker in — anywhere else there is nothing to animate. */
const LIVE_STATES = new Set(['profiling', 'hr_round', 'tech_round']);

/**
 * §3.8: `persona.avatarState` is the sync value on every refetch, the lifecycle drives the
 * state *between* refetches. So the phase wins wherever it has an opinion, and `settled` —
 * nothing in flight — is the one phase that defers to the server's value.
 */
export function resolveAvatarState(phase: RoomPhase, serverAvatarState: string): AvatarState {
  if (phase !== 'settled') return PHASE_TO_STATE[phase];
  return AVATAR_STATES.includes(serverAvatarState) ? (serverAvatarState as AvatarState) : 'idle';
}

export function roomPhase(input: {
  state: string;
  question: { id: string } | null;
  /** The question id whose type animation finished — not a boolean, or a fresh question
   *  inherits the previous one's "already typed" and never animates. */
  typedFor: string | null;
  submitting: boolean;
}): RoomPhase {
  if (input.submitting) return 'just-submitted';
  if (!LIVE_STATES.has(input.state)) return 'settled';
  if (!input.question) return 'awaiting-next';
  return input.typedFor === input.question.id ? 'awaiting-answer' : 'typing-question';
}
