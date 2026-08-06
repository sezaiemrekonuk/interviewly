/**
 * The acceptance ring starts no bucket (server.ts), so `object_storage.feature` needs a store
 * it can both sign against and read back. The URL shape is deliberately the SigV4 presigned
 * one — `X-Amz-Date` + `X-Amz-Expires` + `X-Amz-Signature` — so the steps that assert the TTL
 * parse a real presigned URL the same way, and nothing about the assertion is fake-specific.
 */
import { createHash } from 'node:crypto';

import { clock } from '../../src/lib/clock';
import { cappedTtl, type Storage } from '../../src/lib/storage';

export interface FakeStorage extends Storage {
  keys(): string[];
  /** What a client would get by GETting the signed URL: 403 once the clock passes the expiry. */
  fetchSigned(url: string): { status: 200 | 403; body?: Buffer };
}

/** `20260729T100000Z` — the SigV4 basic-format instant. */
const amzDate = (at: Date): string => at.toISOString().replace(/[-:]|\.\d{3}/g, '');

export function parseSignedExpiry(url: string): { signedAt: Date; expiresIn: number } {
  const q = new URL(url).searchParams;
  const date = q.get('X-Amz-Date');
  const expires = q.get('X-Amz-Expires');
  if (!date || !expires) throw new Error(`not a presigned URL: ${url}`);
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`;
  return { signedAt: new Date(iso), expiresIn: Number(expires) };
}

export function makeFakeStorage(bucketUrl = 'https://objects.test.local/private'): FakeStorage {
  const objects = new Map<string, Buffer>();
  const basePath = new URL(bucketUrl).pathname;

  return {
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`no object for key ${key}`);
      return bytes;
    },
    async remove(key) {
      objects.delete(key);
    },
    async signedUrl(key, ttlSeconds) {
      const url = new URL(`${bucketUrl}/${key}`);
      url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
      url.searchParams.set('X-Amz-Date', amzDate(clock.now()));
      url.searchParams.set('X-Amz-Expires', String(cappedTtl(ttlSeconds)));
      url.searchParams.set(
        'X-Amz-Signature',
        createHash('sha256').update(`${key}:${url.searchParams.get('X-Amz-Date')}`).digest('hex'),
      );
      return url.toString();
    },
    keys() {
      return [...objects.keys()];
    },
    fetchSigned(url) {
      const { signedAt, expiresIn } = parseSignedExpiry(url);
      if (clock.now().getTime() > signedAt.getTime() + expiresIn * 1000) return { status: 403 };
      // Keys carry slashes (`reports/<id>.pdf`), so the key is everything past the base path.
      const key = decodeURIComponent(new URL(url).pathname.slice(basePath.length + 1));
      const body = objects.get(key);
      return body ? { status: 200, body } : { status: 403 };
    },
  };
}
