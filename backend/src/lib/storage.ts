// I12 owns this file and extends it with `get` and `signedUrl(key, ttl)`. I11 added the
// minimal `put` it needed, so I12 grows the interface rather than reworking it.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { config } from './env';

export interface Storage {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
}

// forcePathStyle: MinIO serves path-style only. Same client shape as prisma/seed.ts.
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
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
};

export function setStorage(next: Storage): void {
  storage = next;
}
