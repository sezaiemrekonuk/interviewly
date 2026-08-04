import type { MascotPose } from '@interviewly/types';
import { useTranslations } from 'next-intl';

// sha256 of the seed's PLACEHOLDER_WEBP (backend/prisma/seed.ts). Real artwork lands at a
// different digest, so the deployed value is env-supplied; this is only the seeded default.
const SEED_SHA256 = '86be52bdb7547413cafb3ed175a806a798c65de98b40849e0b974c47d187de65';
const rawSha256 = process.env.NEXT_PUBLIC_MASCOT_SHA256;
const SHA256 = rawSha256 && /^[0-9a-f]{64}$/i.test(rawSha256) ? rawSha256.toLowerCase() : SEED_SHA256;
// Mirrors the backend's S3_PUBLIC_PREFIX; the edge proxies it to the bucket.
const ASSET_PREFIX = (process.env.NEXT_PUBLIC_ASSETS_PREFIX || '/assets').replace(/\/+$/, '');

export function mascotKey(pose: MascotPose): string {
  return `mascot/${pose}-${SHA256}.webp`;
}

export function mascotUrl(pose: MascotPose): string {
  return `${ASSET_PREFIX}/${mascotKey(pose)}`;
}

/**
 * ui §4.2.1 — one pose, one immutable key, plain `<img>` (no next/image loader for a
 * content-addressed object). Never animates: motion is a room concern.
 */
export function Mascot({
  pose,
  size = 96,
  alt,
  className,
}: {
  pose: MascotPose;
  size?: number;
  alt?: string;
  className?: string;
}) {
  const t = useTranslations('mascot');
  const src = mascotUrl(pose);
  return (
    <>
      {/* preload only the pose this screen uses (§8.1); React hoists it into <head> */}
      <link rel="preload" as="image" href={src} />
      {/* eslint-disable-next-line @next/next/no-img-element -- immutable content-addressed key */}
      <img
        src={src}
        width={size}
        height={size}
        alt={alt ?? t(pose)}
        decoding="async"
        className={className}
      />
    </>
  );
}
