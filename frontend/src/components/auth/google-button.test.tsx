/**
 * Issue 60. The button is a full browser navigation, so offering it against a deployment
 * with no Google credentials replaces the app with `{"error":{"code":"NOT_READY"}}` — the
 * one place a raw code could reach a visitor. What is under test is that the control is
 * only ever rendered when the API says the flow can actually complete.
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';

import { GoogleButton } from './google-button';

function stubCapabilities(google: boolean) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify({ oauth: { google } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

const label = () => screen.queryByText(messages.auth.googleButton);

describe('GoogleButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the link once the API reports Google as available', async () => {
    const fetchSpy = stubCapabilities(true);
    renderWithProviders(<GoogleButton />);

    await waitFor(() => expect(label()).toBeTruthy());
    expect(label()?.getAttribute('href')).toBe('/api/auth/google');
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/capabilities', {
      credentials: 'same-origin',
    });
  });

  it('renders nothing at all when Google is not configured', async () => {
    stubCapabilities(false);
    const { container } = renderWithProviders(<GoogleButton />);

    // The divider goes with it: an "or" above nothing is its own kind of dead control.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(label()).toBeNull();
  });

  it('shows nothing while the answer is still in flight', () => {
    stubCapabilities(true);
    const { container } = renderWithProviders(<GoogleButton />);

    expect(container).toBeEmptyDOMElement();
  });

  it('fails closed when the capabilities call is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const { container } = renderWithProviders(<GoogleButton />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
