/**
 * Issue 009 AC-1 and AC-5: both documents render, in both locales, with the named
 * sub-processors and the retention paragraph actually on the page — a privacy notice that
 * does not say who else sees the data is not a privacy notice.
 */
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import trMessages from '../../../messages/tr.json';
import { messages, renderWithIntl } from '../../test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/privacy',
}));

import PrivacyPage from './privacy/page';
import TermsPage from './terms/page';

describe('legal pages (issue 009)', () => {
  it('renders the privacy notice with every section it declares', () => {
    renderWithIntl(<PrivacyPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      messages.legal.privacy.title,
    );
    for (const section of messages.legal.privacy.sections) {
      expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeInTheDocument();
    }
  });

  it('names the LLM sub-processors and the retention rule', () => {
    renderWithIntl(<PrivacyPage />);

    const page = screen.getByRole('heading', { level: 1 }).closest('article');
    expect(page?.textContent).toContain('OpenAI');
    expect(page?.textContent).toContain('Gemini');
    expect(page?.textContent).toContain('ElevenLabs');
    expect(page?.textContent).toContain('delete your account');
  });

  it('renders the terms with every section it declares', () => {
    renderWithIntl(<TermsPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messages.legal.terms.title);
    for (const section of messages.legal.terms.sections) {
      expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeInTheDocument();
    }
  });

  it('resolves both documents in Turkish', () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="tr" messages={trMessages}>
        <PrivacyPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      trMessages.legal.privacy.title,
    );
    unmount();

    render(
      <NextIntlClientProvider locale="tr" messages={trMessages}>
        <TermsPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      trMessages.legal.terms.title,
    );
  });
});
