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
