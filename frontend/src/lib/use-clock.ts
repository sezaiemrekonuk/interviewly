'use client';

import { useSyncExternalStore } from 'react';

/**
 * The wall clock as an external store (S09). A readout cannot call `Date.now()` while rendering
 * — it is impure — and cannot seed itself from an effect either, so the clock lives outside
 * React and components subscribe to it.
 *
 * One interval for the whole app, so the room's elapsed and its countdown are read from the
 * same instant and can never disagree by a tick. Neither of them accumulates: they subtract two
 * timestamps, which is what makes a slept tab and a moved deadline correct themselves.
 *
 * `0` until something subscribes — a server render has no clock, and a readout that has not got
 * one yet renders nothing rather than a guess it would have to correct on hydration.
 */
let nowMs = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  nowMs = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // First subscriber reads the clock immediately: `nowMs` is otherwise 0, or whatever the last
  // unmount left behind.
  if (!timer) {
    tick();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => nowMs;
const getServerSnapshot = () => 0;

/** Milliseconds since the epoch, repainting once a second. `0` before the clock is subscribed. */
export function useNowMs(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
