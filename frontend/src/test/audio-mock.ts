import { vi } from 'vitest';

/**
 * jsdom has no `AudioContext`, no `MediaRecorder` and no media playback, which is the whole
 * turn loop. This harness stands in for all three and hands the test the controls the browser
 * would otherwise own: when the question audio finishes, what the analyser hears, and when a
 * recording produces its bytes.
 *
 * The RMS the meter reports is the value fed to `level()` — every sample in the analyser buffer
 * is that value, so `sqrt(mean(x²))` is it exactly, and a VAD assertion reads as the number the
 * threshold is written against.
 */

export interface FakePlayer {
  src: string;
  playCalls: number;
  paused: boolean;
  /** Playback reached the end — the turn moves on to recording. */
  end: () => void;
  /** The element could not play what it was handed. */
  fail: () => void;
}

export interface FakeRecorder {
  state: 'inactive' | 'recording' | 'paused';
  mimeType: string;
  stream: MediaStream;
  starts: number;
  stops: number;
  pauses: number;
  resumes: number;
  /** What `start()` was given: a timeslice, or undefined for one blob at `stop()`. */
  timeslice: number | undefined;
  /**
   * Deliver one interim chunk, the way a timesliced recorder does. `fill` is repeated to
   * `bytes` so a test can tell which part of a long recording survived a size cap.
   */
  chunk: (bytes?: number, fill?: string) => void;
}

export interface AudioHarness {
  players: FakePlayer[];
  recorders: FakeRecorder[];
  /** What the analyser hears from here on, plus the frames that report it. */
  level: (rms: number, frames?: number) => void;
  /** Run the meter's `requestAnimationFrame` loop `count` times. */
  frames: (count?: number) => void;
  objectUrls: { created: number; revoked: number };
}

export function installAudioMock(): AudioHarness {
  const players: FakePlayer[] = [];
  const recorders: FakeRecorder[] = [];
  const objectUrls = { created: 0, revoked: 0 };
  let rms = 0;
  let pending: FrameRequestCallback[] = [];

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending.push(cb);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  class FakeAnalyser {
    fftSize = 256;
    getFloatTimeDomainData(buf: Float32Array) {
      buf.fill(rms);
    }
  }

  vi.stubGlobal(
    'AudioContext',
    class {
      createAnalyser() {
        return new FakeAnalyser();
      }
      createMediaStreamSource() {
        return { connect: () => {} };
      }
      close() {
        return Promise.resolve();
      }
    },
  );

  vi.stubGlobal(
    'Audio',
    class {
      readonly listeners = new Map<string, Set<() => void>>();
      readonly view: FakePlayer;

      constructor(readonly src: string) {
        this.view = {
          src,
          playCalls: 0,
          paused: false,
          end: () => this.emit('ended'),
          fail: () => this.emit('error'),
        };
        players.push(this.view);
      }

      addEventListener(type: string, cb: () => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(cb);
      }

      removeEventListener(type: string, cb: () => void) {
        this.listeners.get(type)?.delete(cb);
      }

      emit(type: string) {
        this.listeners.get(type)?.forEach((cb) => cb());
      }

      play() {
        this.view.playCalls += 1;
        return Promise.resolve();
      }

      pause() {
        this.view.paused = true;
      }
    },
  );

  class FakeMediaRecorder {
    static isTypeSupported() {
      return true;
    }
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readonly mimeType: string;
    readonly view: FakeRecorder;

    constructor(readonly stream: MediaStream, options?: { mimeType?: string }) {
      this.mimeType = options?.mimeType ?? 'audio/webm;codecs=opus';
      this.view = {
        state: 'inactive',
        mimeType: this.mimeType,
        stream,
        starts: 0,
        stops: 0,
        pauses: 0,
        resumes: 0,
        timeslice: undefined,
        chunk: (bytes = 8_000, fill = 'x') => {
          this.ondataavailable?.({
            data: new Blob([fill.repeat(bytes)], { type: this.mimeType }),
          });
        },
      };
      recorders.push(this.view);
    }

    /** One home for the state the recorder and its test view both read. */
    get state() {
      return this.view.state;
    }

    start(timeslice?: number) {
      this.view.state = 'recording';
      this.view.starts += 1;
      this.view.timeslice = timeslice;
    }

    pause() {
      this.view.state = 'paused';
      this.view.pauses += 1;
    }

    resume() {
      this.view.state = 'recording';
      this.view.resumes += 1;
    }

    // One chunk, delivered the way a real recorder delivers its last one: `dataavailable`
    // first, then `stop`.
    stop() {
      if (this.view.state === 'inactive') return;
      this.view.state = 'inactive';
      this.view.stops += 1;
      this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
      this.onstop?.();
    }
  }

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

  const url = globalThis.URL as unknown as {
    createObjectURL?: unknown;
    revokeObjectURL?: unknown;
  };
  url.createObjectURL = vi.fn(() => {
    objectUrls.created += 1;
    return `blob:speech-${objectUrls.created}`;
  });
  url.revokeObjectURL = vi.fn(() => {
    objectUrls.revoked += 1;
  });

  const frames = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      const due = pending;
      pending = [];
      due.forEach((cb) => cb(0));
    }
  };

  return {
    players,
    recorders,
    objectUrls,
    frames,
    level: (next: number, count = 2) => {
      rms = next;
      frames(count);
    },
  };
}
