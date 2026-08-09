/**
 * S07 — where a resumed interview lands. A voice interview must go through the device check;
 * the history list linked straight into the room, so a resume skipped the only screen that
 * asks for a microphone.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';
import type { MyInterview } from '../../lib/query';

import { CarryOn, SessionCard } from './modules';

const interview = (mode: 'text' | 'voice'): MyInterview => ({
  id: 'i1',
  state: 'hr_round',
  mode,
  occupation: 'Backend developer',
  endedReason: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  startedAt: '2026-08-01T10:05:00.000Z',
  endedAt: null,
  overallScore: null,
  roundScores: { hr: null, tech: null },
});

describe('resuming an interview', () => {
  it('sends a voice session through pre-join from the history row', () => {
    renderWithProviders(<SessionCard interview={interview('voice')} />);

    expect(screen.getByRole('link', { name: messages.dashboard.session.continue })).toHaveAttribute(
      'href',
      '/interviews/i1/pre-join',
    );
  });

  it('sends a text session straight to the room from the history row', () => {
    renderWithProviders(<SessionCard interview={interview('text')} />);

    expect(screen.getByRole('link', { name: messages.dashboard.session.continue })).toHaveAttribute(
      'href',
      '/interviews/i1/room',
    );
  });

  it('branches the same way on the carry-on card', () => {
    renderWithProviders(<CarryOn interview={interview('voice')} />);

    expect(screen.getByRole('link', { name: messages.dashboard.carryOn.cta })).toHaveAttribute(
      'href',
      '/interviews/i1/pre-join',
    );
  });
});
