/**
 * The block that tells a candidate what the interview they are about to start knows about
 * them. Three states, and the one it must never show is a fourth: "no CV attached" written
 * before the profile has answered, then retracted.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';

import { CvNotice } from './cv-notice';

const CV = {
  id: 'up_1',
  filename: 'cv-2026.pdf',
  mime: 'application/pdf',
  sizeBytes: 12_800,
  uploadedAt: '2026-04-12T09:00:00.000Z',
};

interface Call {
  url: string;
  method: string;
}

/** `/me/profile` is the only read; `/uploads` is the only write, and it repoints the CV. */
function stub(options: { cv?: typeof CV | null; uploadStatus?: number; uploadBody?: unknown } = {}) {
  const calls: Call[] = [];
  let cv = options.cv ?? null;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });

      if (url === '/api/uploads') {
        const status = options.uploadStatus ?? 201;
        // The server's own write, which is why nothing here is threaded into the create.
        if (status === 201) cv = CV;
        return json(status, options.uploadBody ?? { uploadId: 'up_1' });
      }
      if (url === '/api/me/profile') {
        return json(200, { profile: {}, onboardingCompletedAt: 'now', cvUploadId: cv?.id ?? null, cv });
      }
      return json(404, { error: { code: 'NOT_FOUND' } });
    }),
  );

  return calls;
}

async function render() {
  await act(async () => {
    renderWithProviders(<CvNotice />);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the CV block on setup', () => {
  // The mistake this exists to stop: claiming an account has no CV before asking.
  it('claims nothing until the profile has answered', async () => {
    let answer: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    await render();

    expect(screen.queryByTestId('cv-notice')).toBeNull();
    expect(screen.queryByTestId('cv-attached')).toBeNull();

    await act(async () => {
      answer(
        new Response(
          JSON.stringify({ profile: {}, onboardingCompletedAt: 'now', cvUploadId: null, cv: null }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    await waitFor(() => expect(screen.getByTestId('cv-notice')).toBeInTheDocument());
  });

  it('states the fact and offers the upload when no CV is attached', async () => {
    stub({ cv: null });
    await render();

    const notice = await screen.findByTestId('cv-notice');
    expect(notice).toHaveTextContent(messages.setup.cvTitle);
    expect(notice).toHaveTextContent(messages.setup.cvBody);
    expect(screen.getByLabelText(messages.fields.cvLabel)).toBeInTheDocument();
    // Not an alarm: this screen's only real failure is a refused create, and nothing here is
    // wrong yet. A `role="alert"` would say otherwise to a screen reader.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the CV already on the account instead of the notice', async () => {
    stub({ cv: CV });
    await render();

    const line = await screen.findByTestId('cv-attached');
    expect(line).toHaveTextContent('cv-2026.pdf');
    expect(screen.queryByTestId('cv-notice')).toBeNull();
    // Quiet: the file picker is behind the one control, not sitting open on the screen.
    expect(screen.queryByLabelText(messages.fields.cvLabel)).toBeNull();
    expect(screen.getByRole('button', { name: messages.setup.cvChange })).toBeInTheDocument();
  });

  it('attaches a CV from this screen and says which one it is', async () => {
    const calls = stub({ cv: null });
    await render();
    const user = userEvent.setup();

    await user.upload(
      await screen.findByLabelText(messages.fields.cvLabel),
      new File(['%PDF-1.4 cv'], 'cv-2026.pdf', { type: 'application/pdf' }),
    );

    // The line replaces the notice, read back from the refetched profile rather than from the
    // upload's own answer (issue 62) — which is why the stub moves the CV onto the account.
    await waitFor(() => expect(screen.getByTestId('cv-attached')).toHaveTextContent('cv-2026.pdf'));
    expect(screen.queryByTestId('cv-notice')).toBeNull();
    expect(calls.some((call) => call.url === '/api/uploads' && call.method === 'POST')).toBe(true);
    expect(calls.filter((call) => call.url === '/api/me/profile').length).toBeGreaterThan(1);
  });

  it('opens the picker to replace a CV, and closes it again', async () => {
    stub({ cv: CV });
    await render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: messages.setup.cvChange }));
    expect(screen.getByLabelText(messages.fields.cvLabel)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: messages.setup.cvKeep }));
    expect(screen.queryByLabelText(messages.fields.cvLabel)).toBeNull();
  });

  it('reports a refused upload without losing the block', async () => {
    stub({ cv: null, uploadStatus: 422, uploadBody: { error: { code: 'PDF_TEXT_TOO_SHORT' } } });
    await render();
    const user = userEvent.setup();

    await user.upload(
      await screen.findByLabelText(messages.fields.cvLabel),
      new File(['not really a cv'], 'cv.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText(new RegExp(messages.errors.PDF_TEXT_TOO_SHORT))).toBeInTheDocument();
    expect(screen.getByTestId('cv-notice')).toBeInTheDocument();
  });
});

// The block says what is on the account in its own words; `CvField`'s own line said it again,
// and in Turkish with a second word for the same document.
describe('the block does not say the same thing twice', () => {
  it('drops the field\'s own state line', async () => {
    stub({ cv: null });
    await render();

    await screen.findByTestId('cv-notice');
    expect(screen.queryByTestId('cv-state')).toBeNull();
    expect(screen.queryByText(messages.fields.cvNone)).toBeNull();
  });
});
