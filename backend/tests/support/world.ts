import './setup';

import { setWorldConstructor, World } from '@cucumber/cucumber';

import { getBaseUrl } from './harness';

type Method = 'GET' | 'POST';

interface RequestOpts {
  body?: unknown;
  useSession?: boolean;
}

/** One answered request, kept whole so a step can assert across a batch of them. */
export interface Exchange {
  status: number;
  body: unknown;
}

export class AuthWorld extends World {
  sessionCookie?: string; // stored as `session=<token>` for the Cookie header
  lastStatus = 0;
  lastBody: unknown;
  lastSetCookie: string[] = [];

  /** Every exchange this scenario made, oldest first (A04's batched-resend assertions). */
  exchanges: Exchange[] = [];

  /** The plaintext token the scenario is currently working with (A04). */
  currentToken?: string;

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
    this.exchanges.push({ status: this.lastStatus, body: this.lastBody });

    // Capture a freshly-issued session cookie for later authenticated requests.
    const pair = this.sessionPair();
    if (pair && !pair.endsWith('session=')) this.sessionCookie = pair;
  }

  /**
   * Fires several requests at once and returns their answers without touching
   * `lastStatus`/`lastBody`. Sequential `request` calls cannot express the concurrent
   * double-confirm scenario at all: the second would start after the first had already
   * committed, which is precisely the interleaving the guarded consume exists for.
   */
  async requestConcurrently(
    times: number,
    method: Method,
    path: string,
    opts: RequestOpts = {},
  ): Promise<Exchange[]> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.useSession && this.sessionCookie) headers.cookie = this.sessionCookie;

    const answers = await Promise.all(
      Array.from({ length: times }, async () => {
        const res = await fetch(getBaseUrl() + path, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : undefined };
      }),
    );

    this.exchanges.push(...answers);
    return answers;
  }

  /** The most recent exchange, whether it came from `request` or the concurrent path. */
  lastExchange(): Exchange {
    const last = this.exchanges.at(-1);
    if (!last) throw new Error('no request has been made in this scenario');
    return last;
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
