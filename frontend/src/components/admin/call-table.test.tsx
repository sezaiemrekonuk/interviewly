import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCallRow } from '../../lib/query';
import { renderWithIntl } from '../../test/render';

import { CallTable } from './call-table';

const SPEECH_ROW: AdminCallRow = {
  id: 'row-speech',
  provider: 'elevenlabs',
  model: 'tts-multilingual',
  promptUuid: '',
  promptVersion: 0,
  attemptNo: 1,
  fellBackFrom: null,
  units: '812',
  unitKind: 'character',
  inputTokens: null,
  outputTokens: null,
  costUsd: '0.012000',
  latencyMs: 640,
  traceId: 'trace-speech',
  createdAt: '2026-08-10T09:00:00.000Z',
};

const LLM_ROW: AdminCallRow = {
  id: 'row-llm',
  provider: 'openai',
  model: 'gpt-4.1',
  promptUuid: '11111111-2222-3333-4444-555555555555',
  promptVersion: 5,
  attemptNo: 2,
  fellBackFrom: 'gpt-4.1-mini',
  units: '500',
  unitKind: 'token',
  inputTokens: 300,
  outputTokens: 200,
  costUsd: '0.003000',
  latencyMs: 900,
  traceId: 'trace-llm',
  createdAt: '2026-08-10T09:05:00.000Z',
};

function open(items: AdminCallRow[]) {
  return renderWithIntl(
    <CallTable
      items={items}
      hasNextPage={false}
      isFetchingNextPage={false}
      onLoadMore={vi.fn()}
      sort={{ field: 'created', dir: 'desc' }}
      onSort={vi.fn()}
    />,
  );
}

describe('CallTable', () => {
  it('shows an em-dash for a speech row instead of a bare v0 pill', () => {
    open([SPEECH_ROW]);
    const row = screen.getByTestId('admin-call-row');

    expect(within(row).queryByText('v0')).not.toBeInTheDocument();
    expect(within(row).queryByTitle('')).not.toBeInTheDocument();
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  it('still shows the hash, version pill, attempt pill and corrected fallback text for an LLM row', () => {
    const row_ = open([LLM_ROW]).getByTestId('admin-call-row');

    expect(within(row_).getByText('11111111')).toBeInTheDocument();
    expect(within(row_).getByText('v5')).toBeInTheDocument();
    expect(within(row_).getByText('Attempt 2')).toBeInTheDocument();
    expect(within(row_).getByText('After gpt-4.1-mini')).toBeInTheDocument();
  });
});
