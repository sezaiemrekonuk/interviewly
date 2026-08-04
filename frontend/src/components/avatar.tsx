'use client';

import { useState } from 'react';

import type { AvatarState } from '../lib/room-avatar';

/** `personas.avatar_set` as room-state ships it: `{ [AvatarState]: storageKey }` (§3.6). */
export type AvatarSet = Partial<Record<AvatarState, string>>;

// Mirrors the backend's S3_PUBLIC_PREFIX; the edge proxies it to the bucket. Same contract the
// mascot uses, kept local so the room never imports a mascot module.
const ASSET_PREFIX = (process.env.NEXT_PUBLIC_ASSETS_PREFIX || '/assets').replace(/\/+$/, '');

export function avatarUrl(avatarSet: AvatarSet, state: AvatarState): string | null {
  const key = avatarSet[state] ?? avatarSet.idle;
  return key ? `${ASSET_PREFIX}/${key}` : null;
}

/**
 * ui §3.6 — one state, one immutable key, plain `<img>` (no next/image loader for a
 * content-addressed object). The key comes from the persona row, never from a client-side
 * sha guess: a wrong digest is a broken tile in the one screen that must not flicker.
 */
export function Avatar({
  personaId,
  state,
  avatarSet,
  size = 96,
  className,
}: {
  personaId: string;
  state: AvatarState;
  avatarSet: AvatarSet;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const src = errored ? null : avatarUrl(avatarSet, state);

  if (!src) {
    // ponytail: fallback is a flat placeholder, not a second asset request.
    return (
      <div
        data-testid={`avatar-fallback-${personaId}`}
        data-avatar-state={state}
        aria-hidden="true"
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- immutable content-addressed key
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      decoding="async"
      className={className}
      data-avatar-state={state}
      data-persona-id={personaId}
      onError={() => setErrored(true)}
    />
  );
}

/**
 * Both personas' full sets, warmed during the waiting beat (ui §3.6) — the handover to the
 * technical persona must not be the first time its images are fetched.
 */
export function AvatarPreload({ sets }: { sets: AvatarSet[] }) {
  const hrefs = [
    ...new Set(
      sets.flatMap((set) => Object.values(set).map((key) => `${ASSET_PREFIX}/${key}`)),
    ),
  ];
  return (
    <>
      {hrefs.map((href) => (
        <link key={href} rel="preload" as="image" href={href} />
      ))}
    </>
  );
}
