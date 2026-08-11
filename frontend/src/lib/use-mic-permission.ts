// W09 — the permission gate behind pre-join, microphone half. Audio-only on purpose: the
// camera is optional, gates nothing, and owns its own stream in `components/camera-view.tsx`,
// so nothing here should ever ask for video. No audio leaves the tab — the realtime session
// is V02/W10.
// ponytail: the AnalyserNode/RMS loop is not shared with the voice ledger's device check yet;
// extract a `micLevel` helper if a third caller shows up.
import { useCallback, useEffect, useRef, useState } from 'react';

export type MicPermissionState = 'idle' | 'prompt' | 'granted' | 'denied' | 'unavailable';

export interface MicDevice {
  deviceId: string;
  label: string;
}

export interface UseMicPermission {
  state: MicPermissionState;
  /** 0..1 RMS level; only moves while state === 'granted'. */
  level: number;
  /** The live capture, for `MediaRecorder` (S06). Owned here — the caller never stops it. */
  stream: MediaStream | null;
  devices: MicDevice[];
  /** The device backing the live stream, once one is granted. */
  deviceId: string | null;
  request: (deviceId?: string) => void;
  /** Switch input: re-requests against the chosen device and releases the old track. */
  select: (deviceId: string) => void;
  muted: boolean;
  /** Mute by disabling the track, not by dropping it — re-acquiring re-prompts on some browsers. */
  toggleMute: () => void;
}

// `NotFoundError` is "this machine has no microphone" — a different screen from "you said no",
// so it must not collapse into `denied`, which offers a retry that cannot succeed.
const NO_DEVICE = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']);

export function useMicPermission(): UseMicPermission {
  const [state, setState] = useState<MicPermissionState>('idle');
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const liveRef = useRef(true);

  const release = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current = null;
    setStream(null);
  }, []);

  const meter = useCallback((stream: MediaStream) => {
    if (typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    audioCtxRef.current = ctx;

    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!liveRef.current) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const sample of buf) sum += sample * sample;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length)));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const request = useCallback(
    async (wanted?: string) => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        return;
      }
      release();
      setLevel(0);
      setState('prompt');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: wanted ? { deviceId: { exact: wanted } } : true,
        });
        if (!liveRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setStream(stream);
        setDeviceId(wanted ?? stream.getAudioTracks()[0]?.getSettings().deviceId ?? null);
        setState('granted');
        meter(stream);

        // Labels are empty until a grant exists, so enumeration is worth nothing before this
        // point — that is why the device list is populated here and not on mount.
        const all = (await navigator.mediaDevices.enumerateDevices?.()) ?? [];
        if (!liveRef.current) return;
        setDevices(
          all
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label })),
        );
      } catch (err) {
        if (!liveRef.current) return;
        setState(NO_DEVICE.has((err as { name?: string })?.name ?? '') ? 'unavailable' : 'denied');
      }
    },
    [meter, release],
  );

  const select = useCallback(
    (next: string) => {
      setDeviceId(next);
      void request(next);
    },
    [request],
  );

  const toggleMute = useCallback(() => {
    setMuted((was) => {
      const next = !was;
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      // The analyser keeps reading a disabled track as silence, but pinning it to 0 keeps the
      // meter from lagging a frame behind the button.
      if (next) setLevel(0);
      return next;
    });
  }, []);

  // The non-negotiable: no hot mic after the user leaves.
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      release();
    };
  }, [release]);

  return { state, level, stream, devices, deviceId, request, select, muted, toggleMute };
}
