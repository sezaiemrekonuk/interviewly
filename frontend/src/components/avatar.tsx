'use client';

import { useEffect, useRef, useState } from 'react';

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
/**
 * The seeded avatar objects are 34-byte 1×1 placeholders: they load successfully, so
 * `onError` never fires and the tile paints a stretched empty box. Anything decoded
 * narrower than this is a placeholder, not artwork.
 */
const MIN_REAL_WIDTH = 10;

export function Avatar({
  personaId,
  state,
  avatarSet,
  name,
  size = 96,
  className,
}: {
  personaId: string;
  state: AvatarState;
  avatarSet: AvatarSet;
  /** Persona display name — its initial is the monogram shown when no artwork resolves. */
  name?: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const src = errored ? null : avatarUrl(avatarSet, state);

  useEffect(() => {
    // An image that resolved before hydration never fires onLoad/onError at React, so the
    // decoded size is re-checked on mount. `complete` covers success and failure alike.
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth < MIN_REAL_WIDTH) setErrored(true);
  }, [src]);

  if (!src) {
    // A monogram tile, not a blank box: ui §3.6 forbids a blank interviewer as much as a
    // broken-image glyph. No second asset request — the letter is the fallback.
    const initial = (name?.trim() || personaId).charAt(0).toUpperCase();
    return (
      <div
        data-testid={`avatar-fallback-${personaId}`}
        data-avatar-state={state}
        data-persona-id={personaId}
        aria-hidden="true"
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          fontFamily: 'var(--font-heading), sans-serif',
          // 28px at 600 clears the AA *large-text* floor (3:1) on --primary-soft.
          fontSize: '28px',
          fontWeight: 600,
          color: 'var(--primary)',
          background: 'var(--primary-soft)',
          borderRadius: 'var(--radius-card)',
        }}
      >
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- immutable content-addressed key
    <img
      ref={imgRef}
      src={src}
      width={size}
      height={size}
      alt=""
      decoding="async"
      className={className}
      data-avatar-state={state}
      data-persona-id={personaId}
      onError={() => setErrored(true)}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth < MIN_REAL_WIDTH) setErrored(true);
      }}
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
      sets.flatMap((set) =>
        Object.values(set)
          .filter((key): key is string => Boolean(key))
          .map((key) => `${ASSET_PREFIX}/${key}`),
      ),
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
