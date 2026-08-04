import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';

import messages from '../../messages/en.json';

// Re-exported so assertions can look a string up by its key instead of hard-coding the
// English copy. A test that spells out "An account with this email already exists."
// passes for the wrong reason and fails the moment the wording is polished.
export { messages };

export function renderWithIntl(ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/**
 * For screens that mount React Query hooks. A fresh client per render keeps one test's
 * cache out of the next; retries off so a failing query resolves in the first tick.
 */
export function renderWithProviders(
  ui: ReactElement,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): RenderResult & { queryClient: QueryClient } {
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { ...result, queryClient: client };
}
