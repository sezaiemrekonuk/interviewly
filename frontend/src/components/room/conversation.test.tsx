/**
 * T04 / ADR-T05 — the recovery notice. It exists for one moment: the candidate reloaded
 * mid-thought and has no other way to see what survived.
 *
 * The two things it must not do are both accessibility failures rather than visual ones — it
 * must not live inside the `aria-live` list (a growing partial would re-announce itself over
 * the interviewer's words, which in voice are only ever met through that list), and it must not
 * change once shown. Freezing is the room's job; staying outside the list is this component's.
 */
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { messages } from '../../test/render';
import { Conversation, ResumedNotice, type ConversationMessage } from './conversation';

const LINES: ConversationMessage[] = [
  { id: 'm1', role: 'assistant', content: 'Tell me about yourself.', roundType: 'hr' },
];

/**
 * The notice is a SIBLING of the conversation, not a part of it — voice mode keeps that panel
 * closed, and closed is `clip: rect(0 0 0 0)`. Rendered the way the room renders it: outside.
 */
function renderConversation(pendingTurn: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ResumedNotice text={pendingTurn} />
      <Conversation messages={LINES} speakerName="Ada" live />
    </NextIntlClientProvider>,
  );
}

describe('Conversation — the recovery notice (AC-12, AC-13)', () => {
  it('shows the held partial with the label and the hint', () => {
    renderConversation('I was in the middle of saying');

    const notice = screen.getByTestId('turn-resumed');
    expect(within(notice).getByText(messages.room.voice.resumed.label)).toBeInTheDocument();
    expect(within(notice).getByText(/I was in the middle of saying/)).toBeInTheDocument();
    // "Saved", never "sent": the interviewer has not seen it, and saying "sent" would explain
    // its silence as rudeness.
    expect(within(notice).getByText(messages.room.voice.resumed.hint)).toBeInTheDocument();
  });

  it('renders it outside the live region, and outside the conversation panel entirely', () => {
    renderConversation('I was in the middle of saying');

    const list = screen.getByRole('list');
    const notice = screen.getByTestId('turn-resumed');
    expect(list).toHaveAttribute('aria-live', 'polite');
    expect(list.contains(notice)).toBe(false);
    // Not merely outside the `<ol>` — outside the whole panel. Inside it, voice mode's closed
    // default clips the notice to a pixel, which is how it shipped and why this line exists.
    expect(screen.getByTestId('conversation').contains(notice)).toBe(false);
  });

  it('keeps the tail of a long partial and elides the front', () => {
    const long = `${'x'.repeat(400)} the sentence I was in the middle of`;
    renderConversation(long);

    const quoted = screen.getByTestId('turn-resumed-text');
    expect(quoted).toHaveTextContent('the sentence I was in the middle of');
    expect(quoted.textContent!.startsWith('…')).toBe(true);
    expect(quoted.textContent!.length).toBeLessThanOrEqual(200);
  });

  it('renders nothing when the server holds nothing', () => {
    renderConversation(null);

    expect(screen.queryByTestId('turn-resumed')).not.toBeInTheDocument();
  });
});
