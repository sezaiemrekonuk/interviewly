'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import styles from './camera-view.module.css';

/**
 * The self-camera (voice spec §3.2). Local-only and off by default: the stream is bound to a
 * `<video>` in this tab and nothing else — it is never recorded, never sent to the server, and
 * never handed to the caller, so there is no path by which it could be. `enabled` going false
 * unmounts the capture, which stops the tracks and puts the hardware light out; the candidate's
 * "camera off" must be the device's, not a hidden element.
 *
 * Denial is not an error here. A blocked or missing camera leaves the frame with a sentence in
 * it and changes nothing else — the interview is audio, and the spec says so twice.
 */
export type CameraState = 'off' | 'starting' | 'live' | 'blocked' | 'unavailable';

/** `NotFoundError` is "this machine has no camera" — a different sentence from "you said no". */
const NO_DEVICE = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']);

/** Per tab, not per browser: a choice made on the way into *this* interview. */
const CHOICE_KEY = 'interviewly.camera';

/** Remember what the candidate chose, so the room opens the way pre-join left it. */
export function rememberCamera(on: boolean): void {
  try {
    sessionStorage.setItem(CHOICE_KEY, on ? 'on' : 'off');
  } catch {
    // Private-mode storage refusals are not worth a broken toggle.
  }
}

/**
 * Whether the room should open with the camera already running. Their own choice wins where
 * they made one; failing that, a camera this browser has *already* granted comes on by itself —
 * the permission is the consent, and asking for a second click to see a picture they already
 * agreed to is the friction, not the care. Never prompts: `permissions.query` cannot.
 */
export async function cameraStartsOn(): Promise<boolean> {
  try {
    const chosen = sessionStorage.getItem(CHOICE_KEY);
    if (chosen) return chosen === 'on';
  } catch {
    // fall through to the permission below
  }
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return status?.state === 'granted';
  } catch {
    // Firefox has no 'camera' permission descriptor; there, a click is the way in.
    return false;
  }
}

export function CameraView({
  enabled,
  deviceId,
  className,
}: {
  enabled: boolean;
  /** Which camera, when the candidate picked one. Changing it restarts the capture. */
  deviceId?: string;
  className?: string;
}) {
  // Two components rather than one holding an `off` flag: the capture's whole lifecycle is its
  // mount, so turning the camera off releases the device and turning it back on starts from
  // `starting` — with one component, a refusal would still be on screen the next time. Keyed on
  // the device for the same reason: switching cameras is a new capture, not a mutated one.
  return enabled ? (
    <Capture key={deviceId ?? 'default'} deviceId={deviceId} className={className} />
  ) : (
    <Frame state="off" className={className} />
  );
}

/** A camera the browser will name once any capture has been granted (labels need a grant). */
export interface CameraDevice {
  deviceId: string;
  label: string;
}

/**
 * The cameras this machine has. Enumerated only once `ready` — the lobby passes the microphone's
 * grant, because `enumerateDevices` returns unlabelled entries before any permission exists and
 * a picker of "Camera 1, Camera 2" is not a picker. Re-reads on `devicechange`: plugging a
 * webcam in while the lobby is open is exactly when this list is wrong.
 */
export function useCameraDevices(ready: boolean): CameraDevice[] {
  const [devices, setDevices] = useState<CameraDevice[]>([]);

  useEffect(() => {
    // Held, not re-read: the element this listener is bound to has to be the same one it is
    // unbound from, and `navigator.mediaDevices` can be gone by the time cleanup runs.
    const media = navigator.mediaDevices;
    if (!ready || !media?.enumerateDevices) return;
    let live = true;
    const read = () => {
      void media
        .enumerateDevices()
        .then((all) => {
          if (!live) return;
          setDevices(
            all
              .filter((device) => device.kind === 'videoinput')
              .map((device) => ({ deviceId: device.deviceId, label: device.label })),
          );
        })
        .catch(() => undefined);
    };
    read();
    media.addEventListener?.('devicechange', read);
    return () => {
      live = false;
      media.removeEventListener?.('devicechange', read);
    };
  }, [ready]);

  return devices;
}

function Capture({ deviceId, className }: { deviceId?: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<Exclude<CameraState, 'off'>>('starting');

  useEffect(() => {
    let live = true;
    let stream: MediaStream | null = null;

    // A browser with no `getUserMedia` at all takes the same path as a machine with no camera:
    // one outcome, one sentence, and no state written synchronously from an effect.
    const asked = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        })
      : Promise.reject(Object.assign(new Error('no camera API'), { name: 'NotFoundError' }));

    asked
      .then((granted) => {
        // Turned off while the permission prompt was open: release it rather than leave a
        // camera light on for a tile that is no longer asking for one.
        if (!live) {
          granted.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = granted;
        if (videoRef.current) videoRef.current.srcObject = granted;
        setState('live');
      })
      .catch((err: unknown) => {
        if (!live) return;
        setState(NO_DEVICE.has((err as { name?: string })?.name ?? '') ? 'unavailable' : 'blocked');
      });

    return () => {
      live = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);

  return (
    <Frame state={state} className={className}>
      {/* Mounted before the stream exists, not after: it is attached in a promise callback,
          which needs the element to already be there. `muted` is not optional — an unmuted
          self-view is a feedback loop. */}
      <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
    </Frame>
  );
}

function Frame({
  state,
  className,
  children,
}: {
  state: CameraState;
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('common');

  return (
    <div
      className={[styles.frame, className].filter(Boolean).join(' ')}
      data-testid="camera-view"
      data-camera={state}
    >
      {children}
      {state === 'live' ? null : (
        <p className={styles.hint} aria-live="polite">
          {t(`camera.${state}`)}
        </p>
      )}
    </div>
  );
}
