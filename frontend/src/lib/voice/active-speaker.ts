export type RoundState = string;
export type ActiveSpeaker = 'hr' | 'tech';

/**
 * Derives which persona tile is active from the K2 round state.
 * The state machine is the authority on WHO is speaking; audio decides HOW LOUD.
 * Exactly one tile is active — two simultaneous active states are impossible (K2).
 */
export function resolveActiveSpeaker(round: RoundState): ActiveSpeaker {
  return round === 'tech_round' ? 'tech' : 'hr';
}

export interface ActiveSpeakerHandle {
  /** Which tile is currently active, derived from round state. */
  readonly activeTile: ActiveSpeaker;
  /**
   * Subscribe to amplitude level (0–1) from the agent audio source.
   * Falls back to an event-timer interpolation when no AudioNode is available (§15.1 item 3).
   * Returns unsubscribe fn.
   */
  amplitude$: (cb: (level: number) => void) => () => void;
  /** Disconnect the audio graph and cancel any timers. */
  release: () => void;
}

/**
 * Create an active-speaker handle for the current round.
 * @param round  K2 round state (`hr_round` | `tech_round`).
 * @param source Optional audio source — an `AudioNode` or `MediaStream` from the SDK.
 *               When absent, amplitude pulses on a 120 ms event-timer (§3.6 fallback).
 */
export function createActiveSpeaker(
  round: RoundState,
  source?: AudioNode | MediaStream,
): ActiveSpeakerHandle {
  const activeTile = resolveActiveSpeaker(round);

  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
  let timerId: ReturnType<typeof setInterval> | null = null;

  if (source) {
    try {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      if (source instanceof MediaStream) {
        audioCtx.createMediaStreamSource(source).connect(analyser);
      } else {
        (source as AudioNode).connect(analyser);
      }
    } catch {
      audioCtx = null;
      analyser = null;
    }
  }

  function amplitude$(cb: (level: number) => void): () => void {
    if (analyser) {
      const buf = new Float32Array(analyser.fftSize);
      function tick() {
        analyser!.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const s of buf) sum += s * s;
        cb(Math.sqrt(sum / buf.length));
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
      return () => { if (rafId !== null) cancelAnimationFrame(rafId); };
    }

    // ponytail: event-timer fallback — pings at 120 ms to animate the speaking ring.
    //   Upgrade path: pass the SDK's AudioNode once §15.1 item 3 is resolved.
    timerId = setInterval(() => cb(0.5), 120);
    return () => { if (timerId !== null) clearInterval(timerId); };
  }

  function release() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (timerId !== null) clearInterval(timerId);
    analyser?.disconnect();
    audioCtx?.close().catch(() => {});
  }

  return { activeTile, amplitude$, release };
}
