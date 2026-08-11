'use client';

import { useEffect, useRef, useState } from 'react';

import type { AvatarState } from '../lib/room-avatar';

import styles from './avatar.module.css';

/**
 * `personas.avatar_set` as room-state ships it: `{ [key]: storageKey }` (§3.6). Two families of
 * key live in there — the five `AvatarState` ones (§3.6) and the three `expr-n` expression slots
 * the `change_avatar` tool addresses (additionals ADR-ADD01) — so the type is keyed by string
 * rather than by `AvatarState` alone.
 */
export type AvatarSet = Record<string, string | undefined>;

// Mirrors the backend's S3_PUBLIC_PREFIX; the edge proxies it to the bucket. Same contract the
// mascot uses, kept local so the room never imports a mascot module.
const ASSET_PREFIX = (process.env.NEXT_PUBLIC_ASSETS_PREFIX || '/assets').replace(/\/+$/, '');

/**
 * The key `change_avatar`'s expression `n` is stored under (`seed.ts`). These are the only keys
 * carrying real artwork — the `AvatarState` ones are 1×1 placeholders — so an expression that
 * fails to resolve falls back to `idle`, which then fails the size check below and becomes the
 * monogram. A wrong expression is never worth a broken tile.
 */
export const expressionKey = (n: number) => `expr-${n}`;

export function avatarUrl(avatarSet: AvatarSet, key: string): string | null {
  const storageKey = avatarSet[key] ?? avatarSet.idle;
  return storageKey ? `${ASSET_PREFIX}/${storageKey}` : null;
}

/**
 * ui §3.6 — one state, one immutable key, plain `<img>` (no next/image loader for a
 * content-addressed object). The key comes from the persona row, never from a client-side
 * sha guess: a wrong digest is a broken tile in the one screen that must not flicker.
 */
/**
 * The seeded `AvatarState` objects are 34-byte 1×1 placeholders: they load successfully, so
 * `onError` never fires and the tile paints a stretched empty box. Anything decoded
 * narrower than this is a placeholder, not artwork.
 */
const MIN_REAL_WIDTH = 10;

export function Avatar({
  personaId,
  state,
  expression,
  avatarSet,
  name,
  size = 96,
  className,
}: {
  personaId: string;
  state: AvatarState;
  /**
   * `change_avatar`'s live slot for this persona, 1..3. When given it decides the artwork and
   * `state` only labels the tile — the expression is what the interviewer asked for, the state
   * is what the room's lifecycle is doing, and they change on different clocks.
   */
  expression?: number;
  avatarSet: AvatarSet;
  /** Persona display name — its initial is the monogram shown when no artwork resolves. */
  name?: string;
  size?: number;
  className?: string;
}) {
  // The key that failed, not a boolean: a new expression is a new image, and a flag would
  // latch the first placeholder and render every later one as the monogram.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const key = expression ? expressionKey(expression) : state;
  const src = failedKey === key ? null : avatarUrl(avatarSet, key);

  useEffect(() => {
    // An image that resolved before hydration never fires onLoad/onError at React, so the
    // decoded size is re-checked on mount. `complete` covers success and failure alike.
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth < MIN_REAL_WIDTH) setFailedKey(key);
  }, [src, key]);

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
        className={[styles.fallback, className].filter(Boolean).join(' ')}
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
      className={[styles.image, className].filter(Boolean).join(' ')}
      data-avatar-state={state}
      data-avatar-expression={expression}
      data-persona-id={personaId}
      onError={() => setFailedKey(key)}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth < MIN_REAL_WIDTH) setFailedKey(key);
      }}
    />
  );
}
