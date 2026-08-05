'use client';

import type { MascotPose } from '@interviewly/types';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
 * The seeded objects are 34-byte 1×1 placeholders: they *load*, so `onError` never fires,
 * and every mascot slot paints a stretched empty block. A decoded image narrower than this
 * is a placeholder, not artwork.
 */
const MIN_REAL_WIDTH = 10;

// --------------------------------------------------------------------------- inline art
//
// One body, five deltas. Colours are token references, not literals: SVG presentation
// attributes resolve `var(--…)` against the element's own computed custom properties.

function Arm({ d }: { d: string }) {
  return (
    <path
      d={d}
      fill="none"
      stroke="var(--primary)"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/**
 * Arms are body-coloured, so a same-colour tip just reads as a horn. The mitten is the
 * belly's cream, which is the only other value in the character — one hue, two tones.
 */
function Hand({ cx, cy, r = 3.2 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="var(--primary-soft)" />;
}

function Stroke({ d, width = 1.8, color = 'var(--text)' }: { d: string; width?: number; color?: string }) {
  return (
    <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
  );
}

const DOT_EYES = (
  <>
    <circle cx="26" cy="34" r="2.6" fill="var(--text)" />
    <circle cx="38" cy="34" r="2.6" fill="var(--text)" />
    <circle cx="27.1" cy="33" r="0.9" fill="var(--surface)" />
    <circle cx="39.1" cy="33" r="0.9" fill="var(--surface)" />
  </>
);

const HAPPY_EYES = (
  <>
    <Stroke d="M23.4 34.6q2.6-3.6 5.2 0" width={2} />
    <Stroke d="M35.4 34.6q2.6-3.6 5.2 0" width={2} />
  </>
);

/** Pose = arms + eyes + mouth + props. The body, belly and outline never move. */
const POSES: Record<MascotPose, ReactNode> = {
  wave: (
    <>
      <Arm d="M17 42 10 51" />
      <Hand cx={9} cy={52} />
      <Arm d="M46 42 57 27" />
      <Hand cx={58} cy={25} r={3.8} />
      {DOT_EYES}
      <Stroke d="M28 40q4 4 8 0" />
    </>
  ),
  point: (
    <>
      <Arm d="M17 42 10 51" />
      <Hand cx={9} cy={52} />
      <Arm d="M46 42 57 38" />
      <Hand cx={58.5} cy={37.5} r={3.6} />
      {DOT_EYES}
      <Stroke d="M28 40q4 4 8 0" />
    </>
  ),
  think: (
    <>
      <Arm d="M17 42 10 51" />
      <Hand cx={9} cy={52} />
      {/* Bows outside the silhouette on its way to the chin — a straight arm drawn inside a
          body of the same colour is invisible. */}
      <Arm d="M47 41C56 46 51 53 42 51" />
      <Hand cx={40.5} cy={51.5} />
      {DOT_EYES}
      <Stroke d="M29.5 41q2.5 1.6 5 0" />
      <circle cx="52" cy="20" r="1.8" fill="var(--text-muted)" />
      <circle cx="56.5" cy="13.5" r="2.6" fill="var(--text-muted)" />
      <circle cx="61" cy="6" r="1.4" fill="var(--text-muted)" />
    </>
  ),
  cheer: (
    <>
      <Arm d="M18 42 7 27" />
      <Hand cx={6} cy={25} r={3.8} />
      <Arm d="M46 42 57 27" />
      <Hand cx={58} cy={25} r={3.8} />
      {HAPPY_EYES}
      <Stroke d="M27.5 39.5q4.5 5.5 9 0" width={2} />
      <Stroke d="M7 14 10 11" width={2} color="var(--accent)" />
      <Stroke d="M57 12 60 15" width={2} color="var(--accent)" />
      <Stroke d="M20 7 20 3.5" width={2} color="var(--accent)" />
      <Stroke d="M45 6 47.5 3.5" width={2} color="var(--accent)" />
    </>
  ),
  shrug: (
    <>
      <Arm d="M17 41 9.5 35" />
      <Hand cx={8} cy={34} />
      <Arm d="M47 41 54.5 35" />
      <Hand cx={56} cy={34} />
      {DOT_EYES}
      <Stroke d="M28.5 41h7" />
      <Stroke d="M21.5 28.5q3-2.5 6-1.5" width={1.6} color="var(--text)" />
      <Stroke d="M42.5 28.5q-3-2.5-6-1.5" width={1.6} color="var(--text)" />
    </>
  ),
};

/** The drawn stand-in. Same box as the image it replaces, so nothing shifts. */
function MascotDrawing({
  pose,
  size,
  alt,
  className,
}: {
  pose: MascotPose;
  size: number;
  alt: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      data-testid="mascot-drawing"
      data-mascot-pose={pose}
      {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
    >
      <path
        d="M32 6c8 10 18 16 18 30a18 18 0 0 1-36 0C14 22 24 16 32 6Z"
        fill="var(--primary)"
      />
      <ellipse cx="32" cy="48" rx="10" ry="6" fill="var(--primary-soft)" />
      {POSES[pose]}
    </svg>
  );
}

/**
 * ui §4.2.1 — one pose, one immutable key, plain `<img>` (no next/image loader for a
 * content-addressed object). Never animates: motion is a room concern.
 *
 * When the key resolves to a placeholder (or to nothing at all) the slot falls back to the
 * drawn character above rather than collapsing: a decorative empty box on the landing hero
 * reads as a broken page, which the graceful-degradation rule exists to prevent.
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
  const [drawn, setDrawn] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const src = mascotUrl(pose);
  const label = alt ?? t(pose);

  useEffect(() => {
    // The <img> is server-rendered, so it can finish — or fail — before hydration attaches
    // onLoad/onError, and those events are then simply never seen. `complete` is true after
    // either outcome and `naturalWidth` is 0 on a failure, so one check covers both.
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth < MIN_REAL_WIDTH) setDrawn(true);
  }, [src]);

  if (drawn) {
    return <MascotDrawing pose={pose} size={size} alt={label} className={className} />;
  }

  return (
    <>
      {/* preload only the pose this screen uses (§8.1); React hoists it into <head> */}
      <link rel="preload" as="image" href={src} />
      {/* eslint-disable-next-line @next/next/no-img-element -- immutable content-addressed key */}
      <img
        ref={imgRef}
        src={src}
        width={size}
        height={size}
        alt={label}
        decoding="async"
        className={className}
        onError={() => setDrawn(true)}
        onLoad={(event) => {
          if (event.currentTarget.naturalWidth < MIN_REAL_WIDTH) setDrawn(true);
        }}
      />
    </>
  );
}
