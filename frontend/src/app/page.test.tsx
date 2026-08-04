import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import trMessages from '../../messages/tr.json';
import { mascotUrl } from '../components/mascot';
import { messages, renderWithIntl } from '../test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));

import styles from './page.module.css';
import Home from './page';

describe('landing (screen 1)', () => {
  it('renders the hero and the value props', () => {
    renderWithIntl(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messages.landing.hero);
    expect(screen.getByText(messages.landing.subhead)).toBeInTheDocument();
    for (const prop of ['practice', 'feedback', 'progress'] as const) {
      expect(screen.getByText(messages.landing.props[prop].title)).toBeInTheDocument();
    }
  });

  it('has exactly one --primary CTA and it links to /register', () => {
    const { container } = renderWithIntl(<Home />);
    const ctas = container.querySelectorAll(`.${styles.cta}`);
    expect(ctas).toHaveLength(1);
    expect(ctas[0]).toHaveAttribute('href', '/register');
    expect(ctas[0]).toHaveTextContent(messages.landing.cta);
  });

  it('shows the wave mascot', () => {
    const { container } = renderWithIntl(<Home />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', mascotUrl('wave'));
  });

  it('resolves its copy in Turkish', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={trMessages}>
        <Home />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(trMessages.landing.hero);
    expect(screen.getByRole('link', { name: trMessages.landing.cta })).toBeInTheDocument();
  });

  it('pulls no React Query into the landing tree (§8.1 JS budget)', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toContain('@tanstack/react-query');
    expect(source).not.toContain('./providers');
  });
});
