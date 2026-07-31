import './setup';

import { setWorldConstructor, World } from '@cucumber/cucumber';

import { getBaseUrl } from './harness';

type Method = 'GET' | 'POST';

interface RequestOpts {
  body?: unknown;
  useSession?: boolean;
}

export class AuthWorld extends World {
  sessionCookie?: string; // stored as `session=<token>` for the Cookie header
  lastStatus = 0;
  lastBody: unknown;
  lastSetCookie: string[] = [];

  async request(method: Method, path: string, opts: RequestOpts = {}): Promise<void> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.useSession && this.sessionCookie) headers.cookie = this.sessionCookie;

    const res = await fetch(getBaseUrl() + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    this.lastStatus = res.status;
    this.lastSetCookie = res.headers.getSetCookie?.() ?? [];
    const text = await res.text();
    this.lastBody = text ? JSON.parse(text) : undefined;

    // Capture a freshly-issued session cookie for later authenticated requests.
    const pair = this.sessionPair();
    if (pair && !pair.endsWith('session=')) this.sessionCookie = pair;
  }

  /** The `session=<token>` pair from the last response's Set-Cookie, if any. */
  sessionPair(): string | undefined {
    const raw = this.lastSetCookie.find((c) => c.startsWith('session='));
    return raw?.split(';')[0];
  }

  /** True when the last response set a non-empty session cookie. */
  sessionCookieWasSet(): boolean {
    const pair = this.sessionPair();
    return pair !== undefined && pair !== 'session=';
  }

  body<T = Record<string, unknown>>(): T {
    return this.lastBody as T;
  }
}

setWorldConstructor(AuthWorld);
