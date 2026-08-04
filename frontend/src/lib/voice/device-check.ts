export type PermissionResult = 'granted' | 'denied' | 'prompt';

export interface DeviceCheck {
  micPermission: PermissionResult;
  camPermission: PermissionResult;
  /** Subscribe to mic RMS level (0–1). Returns unsubscribe fn. Null when mic denied. */
  micLevel$: ((cb: (rms: number) => void) => () => void) | null;
  /** Local camera preview stream, or null when cam denied / not requested. */
  previewStream: MediaStream | null;
  /** Stop all tracks, close AudioContext. Safe to call multiple times. */
  release: () => void;
}

/** Request mic (and optionally camera). Never throws — permission failures map to 'denied'. */
export async function checkDevices(): Promise<DeviceCheck> {
  let micStream: MediaStream | null = null;
  let camStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;

  let micPermission: PermissionResult = 'denied';

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micPermission = 'granted';
  } catch {
    micPermission = 'denied';
  }

  let camPermission: PermissionResult = 'prompt';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    camPermission = 'granted';
  } catch {
    camPermission = 'denied';
  }

  // Build the AnalyserNode only when the mic stream is available.
  if (micStream) {
    try {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(micStream).connect(analyser);
    } catch {
      audioCtx = null;
      analyser = null;
    }
  }

  function micLevel$(cb: (rms: number) => void): () => void {
    if (!analyser) return () => {};
    const buf = new Float32Array(analyser.fftSize);
    function tick() {
      analyser!.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const s of buf) sum += s * s;
      cb(Math.sqrt(sum / buf.length));
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }

  function release() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    analyser?.disconnect();
    audioCtx?.close().catch(() => {});
    micStream?.getTracks().forEach((t) => t.stop());
    camStream?.getTracks().forEach((t) => t.stop());
  }

  return {
    micPermission,
    camPermission,
    micLevel$: micStream ? micLevel$ : null,
    previewStream: camStream,
    release,
  };
}
