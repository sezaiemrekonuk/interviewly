import { describe, expect, it } from 'vitest';

import { resolveAvatarState, roomPhase } from './room-avatar';

describe('resolveAvatarState (§3.8)', () => {
  it('maps every lifecycle phase to its avatar state', () => {
    expect(resolveAvatarState('awaiting-next', 'idle')).toBe('thinking');
    expect(resolveAvatarState('typing-question', 'idle')).toBe('speaking');
    expect(resolveAvatarState('awaiting-answer', 'idle')).toBe('listening');
    expect(resolveAvatarState('just-submitted', 'idle')).toBe('acknowledging');
  });

  it('falls back to the refetched server value only when nothing is in flight', () => {
    expect(resolveAvatarState('settled', 'listening')).toBe('listening');
    // A server value the client does not know is not rendered as an image key.
    expect(resolveAvatarState('settled', 'nonsense')).toBe('idle');
    // Between refetches the phase wins, whatever the last sync value said.
    expect(resolveAvatarState('typing-question', 'listening')).toBe('speaking');
  });
});

describe('roomPhase', () => {
  const question = { id: 'q1' };

  it('is thinking-ward while a live round has no question yet', () => {
    expect(roomPhase({ state: 'hr_round', question: null, typedFor: null, submitting: false })).toBe(
      'awaiting-next',
    );
  });

  it('settles outside a live round', () => {
    expect(
      roomPhase({ state: 'evaluating', question: null, typedFor: null, submitting: false }),
    ).toBe('settled');
  });

  it('types the question, then listens once it is fully shown', () => {
    expect(roomPhase({ state: 'hr_round', question, typedFor: null, submitting: false })).toBe(
      'typing-question',
    );
    expect(roomPhase({ state: 'hr_round', question, typedFor: 'q1', submitting: false })).toBe(
      'awaiting-answer',
    );
    // A stale done-marker from the previous question does not skip the animation.
    expect(roomPhase({ state: 'hr_round', question, typedFor: 'q0', submitting: false })).toBe(
      'typing-question',
    );
  });

  it('acknowledges an in-flight submit above everything else', () => {
    expect(roomPhase({ state: 'hr_round', question, typedFor: 'q1', submitting: true })).toBe(
      'just-submitted',
    );
  });
});
