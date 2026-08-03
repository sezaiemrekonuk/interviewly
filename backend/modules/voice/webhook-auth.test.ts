/**
 * Gates 1 and 2 are pure functions over bytes and a clock, and they are the two the acceptance
 * ring can only exercise one way each: `voice_webhook.feature` @AC-3 sends one wrong secret and
 * one stale timestamp. The forgeries that matter — a body tampered with after signing, a
 * truncated digest, a signature valid for a *different* payload, a secret that was never
 * configured, skew in the future rather than the past — have no Gherkin worth writing and every
 * one of them is a way in.
 */
import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { clock } from '../../src/lib/clock';

import { checkFreshness, verifySignature, webhookSeam } from './webhook-auth';

const SECRET = 'webhook-secret-under-test';
const realNow = clock.now;
const realSecret = webhookSeam.secret;
const realWindow = webhookSeam.freshnessSeconds;

afterEach(() => {
  clock.now = realNow;
  webhookSeam.secret = realSecret;
  webhookSeam.freshnessSeconds = realWindow;
});

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifySignature (gate 1)', () => {
  const body = '{"interviewId":"itv_1","nonce":"n1","transcript":"hello"}';

  it('accepts the digest of the exact bytes signed', () => {
    webhookSeam.secret = SECRET;
    expect(verifySignature(Buffer.from(body), sign(body))).toBe(true);
  });

  it('accepts a bare hex digest without the sha256= prefix', () => {
    webhookSeam.secret = SECRET;
    expect(verifySignature(Buffer.from(body), sign(body).replace('sha256=', ''))).toBe(true);
  });

  it('rejects a body altered after signing', () => {
    webhookSeam.secret = SECRET;
    const header = sign(body);
    const tampered = body.replace('hello', 'hellp');
    expect(verifySignature(Buffer.from(tampered), header)).toBe(false);
  });

  it('rejects a signature computed with a different secret', () => {
    webhookSeam.secret = SECRET;
    expect(verifySignature(Buffer.from(body), sign(body, 'some-other-secret'))).toBe(false);
  });

  it('rejects a signature valid for a different payload (replay onto a new body)', () => {
    webhookSeam.secret = SECRET;
    const other = '{"interviewId":"itv_2","nonce":"n2"}';
    expect(verifySignature(Buffer.from(body), sign(other))).toBe(false);
  });

  it('rejects a truncated digest rather than throwing on the length mismatch', () => {
    webhookSeam.secret = SECRET;
    const truncated = sign(body).slice(0, 40);
    expect(() => verifySignature(Buffer.from(body), truncated)).not.toThrow();
    expect(verifySignature(Buffer.from(body), truncated)).toBe(false);
  });

  it.each([undefined, null, 42, '', 'not-hex-at-all'])('rejects a %p header', (header) => {
    webhookSeam.secret = SECRET;
    expect(verifySignature(Buffer.from(body), header)).toBe(false);
  });

  // The one that turns the gate off entirely: ELEVENLABS_WEBHOOK_SECRET is optional in env.ts,
  // so an unconfigured deploy must reject every webhook, not accept every webhook.
  it('fails closed when no secret is configured', () => {
    webhookSeam.secret = '';
    expect(verifySignature(Buffer.from(body), sign(body, ''))).toBe(false);
  });
});

describe('checkFreshness (gate 2)', () => {
  const now = new Date('2026-07-29T10:00:00Z');
  const unix = Math.floor(now.getTime() / 1000);

  function at(offsetSeconds: number): boolean {
    clock.now = () => now;
    webhookSeam.freshnessSeconds = 300;
    return checkFreshness(String(unix + offsetSeconds));
  }

  it('accepts a timestamp inside the window in the past', () => {
    expect(at(-299)).toBe(true);
  });

  it('accepts a timestamp inside the window in the future (clock skew cuts both ways)', () => {
    expect(at(299)).toBe(true);
  });

  it('accepts the window boundary exactly', () => {
    expect(at(-300)).toBe(true);
  });

  it('rejects a timestamp older than the window', () => {
    expect(at(-301)).toBe(false);
  });

  it('rejects a timestamp further ahead than the window', () => {
    expect(at(301)).toBe(false);
  });

  it.each([undefined, null, '', 'yesterday', NaN])('rejects a %p timestamp', (header) => {
    clock.now = () => now;
    expect(checkFreshness(header)).toBe(false);
  });
});
