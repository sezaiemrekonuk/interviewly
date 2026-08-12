// I12 owns this file and extends it with `get` and `signedUrl(key, ttl)`. I11 added the
// minimal `put` it needed, so I12 grows the interface rather than reworking it.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { clock } from './clock';
import { config } from './env';

// The declared knob, not a literal that shadowed it (issue #117). `cappedTtl` keeps its
// ceiling semantics: this is the maximum a caller can ask for, not a default it overrides.
export const MAX_TTL_SECONDS = config.SIGNED_URL_TTL;

// @AC-6: a hard ceiling, not a default — `signedUrl(key, 600)` still expires at 300 s.
export const cappedTtl = (ttlSeconds: number): number =>
  Math.max(1, Math.min(ttlSeconds, MAX_TTL_SECONDS));

export interface Storage {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  signedUrl(key: string, ttlSeconds: number, filename?: string): Promise<string>;
  /** Erasure (issue 009). Idempotent on both S3 and MinIO — a missing key is not an error. */
  remove(key: string): Promise<void>;
}

// forcePathStyle: MinIO serves path-style only. Same client shape as prisma/seed.ts.
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});

const s3Public = new S3Client({
  endpoint: config.PUBLIC_ORIGIN,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});

// ponytail: one implementation, so a module-level binding swapped wholesale by `setStorage`
// beats a DI container. The acceptance ring starts no bucket and replaces it in a Before hook.
export let storage: Storage = {
  async put(key, bytes, mime) {
    await s3.send(
      new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: bytes, ContentType: mime }),
    );
  },
  async get(key) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    if (!obj.Body) throw new Error(`S3 object body missing for key ${key}`);
    return Buffer.from(await obj.Body.transformToByteArray());
  },
  async remove(key) {
    await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  },
  // `signingDate` from the Clock seam, not wall time: the expiry the presigned URL carries is
  // what @AC-6 measures against the fixed clock.
  async signedUrl(key, ttlSeconds, filename) {
    return getSignedUrl(
      s3Public,
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: filename ? `attachment; filename="${filename}"` : undefined,
      }),
      { expiresIn: cappedTtl(ttlSeconds), signingDate: clock.now() },
    );
  },
};

export function setStorage(next: Storage): void {
  storage = next;
}
