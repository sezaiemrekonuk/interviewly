/**
 * The two things the tiles now draw besides a waveform: the interviewer's expression, which is
 * whatever `change_avatar` last asked for (additionals ADR-ADD01), and the candidate's own
 * camera, which is theirs alone and off unless they turned it on.
 */
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { messages } from '../../test/render';
import { PersonaTiles } from './persona-tiles';

const PERSONAS = [
  {
    id: 'p-hr',
    role: 'hr',
    name: 'Ada',
    roundType: 'hr' as const,
    avatarSet: {
      idle: 'personas/p-hr/idle-a.webp',
      'expr-1': 'personas/p-hr/expr-1-a.png',
      'expr-2': 'personas/p-hr/expr-2-b.png',
      'expr-3': 'personas/p-hr/expr-3-c.png',
    },
  },
  {
    id: 'p-tech',
    role: 'tech',
    name: 'Turing',
    roundType: 'tech' as const,
    avatarSet: {
      idle: 'personas/p-tech/idle-a.webp',
      'expr-1': 'personas/p-tech/expr-1-a.png',
    },
  },
];

const tiles = (over: Partial<Parameters<typeof PersonaTiles>[0]> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PersonaTiles
        personas={PERSONAS}
        activeId="p-hr"
        activeState="speaking"
        activeExpression={2}
        {...over}
      />
    </NextIntlClientProvider>,
  );

const portrait = (personaId: string) =>
  document.querySelector(`img[data-persona-id="${personaId}"]`);

describe('PersonaTiles portraits', () => {
  it('draws the speaker at the expression the tool asked for', () => {
    tiles();

    expect(portrait('p-hr')).toHaveAttribute('src', '/assets/personas/p-hr/expr-2-b.png');
  });

  it('leaves everyone else on the first slot — only the speaker is ever asked', () => {
    tiles();

    expect(portrait('p-tech')).toHaveAttribute('src', '/assets/personas/p-tech/expr-1-a.png');
  });

  it('falls back to the first slot when the server named no expression', () => {
    tiles({ activeExpression: undefined });

    expect(portrait('p-hr')).toHaveAttribute('src', '/assets/personas/p-hr/expr-1-a.png');
  });
});

describe('PersonaTiles self-camera', () => {
  const candidate = (camera: boolean) => ({ level: 0.4, muted: false, camera });

  it('is not on the candidate tile until they turn it on', () => {
    tiles({ candidate: candidate(false) });

    expect(screen.queryByTestId('camera-view')).not.toBeInTheDocument();
  });

  it('replaces the drawn voice once it is on', () => {
    tiles({ candidate: candidate(true) });

    const you = screen.getByTestId('persona-tile-you');
    expect(within(you).getByTestId('camera-view')).toBeInTheDocument();
    expect(within(you).queryByTestId('wave')).not.toBeInTheDocument();
  });
});
