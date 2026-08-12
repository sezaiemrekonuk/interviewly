import styles from './peeps.module.css';

import type { ReactElement } from 'react';

export type PeepName = 'ada' | 'turing';

export type PeepMood = 'idle' | 'listening' | 'asking' | 'marking' | 'pleased' | 'unconvinced';

const BROWS: Record<PeepMood, string> = {
  idle: 'M57 52 q10 -3 20 -1 M87 51 q10 -2 20 1',
  listening: 'M56 47 q10 -6 21 -1 M86 46 q11 -5 21 2',
  asking: 'M57 50 q10 -4 20 -1 M87 49 q10 -3 20 1',
  marking: 'M57 51 q10 4 20 8 M87 59 q10 -4 20 -8',
  pleased: 'M55 48 q11 -7 22 -2 M86 46 q11 -5 22 2',
  unconvinced: 'M57 57 q10 1 20 2 M86 45 q11 -5 21 1',
};

const MOUTH: Record<PeepMood, string> = {
  idle: 'M69 99 q11 3 22 -1',
  listening: 'M71 98 q9 5 19 -1',
  asking: '',
  marking: 'M70 100 q11 -1 21 -2',
  pleased: 'M64 95 q17 14 33 -3',
  unconvinced: 'M68 103 q12 -8 25 -2',
};

const NARROWED = new Set<PeepMood>(['marking', 'unconvinced']);
const ARCHED = new Set<PeepMood>(['pleased']);

function Eyes({ mood }: { mood: PeepMood }) {
  if (NARROWED.has(mood)) {
    return <path className={styles.line} d="M60 73 q7 -3 14 0 M90 73 q7 -3 14 0" />;
  }
  if (ARCHED.has(mood)) {
    return <path className={styles.line} d="M60 75 q7 -10 14 0 M90 75 q7 -10 14 0" />;
  }
  return (
    <g className={styles.eyes}>
      <circle className={styles.pupil} cx="67" cy="72" r="5" />
      <circle className={styles.pupil} cx="97" cy="72" r="5" />
    </g>
  );
}

function Face({ mood }: { mood: PeepMood }) {
  return (
    <g>
      <path className={styles.line} d={BROWS[mood]} />
      <Eyes mood={mood} />
      <path className={styles.line} d="M80 70 q-6 13 3 16" />
      {mood === 'asking' ? (
        <ellipse className={styles.mouthOpen} cx="80" cy="101" rx="9" ry="7" />
      ) : (
        <path className={styles.line} d={MOUTH[mood]} />
      )}
    </g>
  );
}

function Bust({ collar }: { collar: string }) {
  return (
    <g>
      <path className={styles.line} d="M64 112 q0 12 -3 18 M98 112 q0 12 3 18" />
      <path className={styles.fillBody} d="M18 192 q2 -42 30 -56 q14 -7 30 -8 q16 1 30 8 q28 14 30 56 Z" />
      <path className={styles.line} d="M18 192 q2 -42 30 -56 M142 192 q-2 -42 -30 -56" />
      <path className={styles.line} d={collar} />
    </g>
  );
}

const ADA = {
  back: (
    <path
      className={styles.fillHair}
      d="M80 8 q56 0 56 64 q0 48 -12 82 q-6 -42 -14 -60 q-30 10 -60 0 q-8 18 -14 60 q-12 -34 -12 -82 q0 -64 56 -64 Z"
    />
  ),
  front: (
    <>
      <path
        className={styles.fillHair}
        d="M39 68 q1 -54 41 -54 q40 0 41 54 q-11 -32 -34 -34 q-8 17 -28 19 q-14 2 -20 15 Z"
      />
      <circle className={styles.hoop} cx="45" cy="97" r="7" />
    </>
  ),
  collar: 'M62 130 l18 22 l18 -22 M80 152 v12',
};

const TURING = {
  back: null,
  front: (
    <>
      <path
        className={styles.fillHair}
        d="M39 74 q-2 -54 41 -56 q43 2 41 56 q-7 -30 -21 -34 q-21 6 -42 0 q-14 4 -19 34 Z"
      />
      <circle className={styles.glass} cx="67" cy="72" r="17" />
      <circle className={styles.glass} cx="97" cy="72" r="17" />
      <path className={styles.line} d="M84 70 h-4 M50 70 q-7 -1 -10 3 M114 70 q7 -1 10 3" />
      <path className={styles.band} d="M31 78 q1 -52 49 -52 q48 0 49 52" />
      <rect className={styles.cup} x="21" y="62" width="20" height="32" rx="9" />
      <rect className={styles.cup} x="119" y="62" width="20" height="32" rx="9" />
    </>
  ),
  collar: 'M60 132 q20 12 40 0 M60 132 q1 8 3 12 M100 132 q-1 8 -3 12',
};

interface CastEntry {
  back: ReactElement | null;
  front: ReactElement;
  collar: string;
}

const CAST: Record<PeepName, CastEntry> = { ada: ADA, turing: TURING };

export function Peep({
  name,
  mood = 'idle',
  className,
}: {
  name: PeepName;
  mood?: PeepMood;
  className?: string;
}): ReactElement {
  const cast = CAST[name];
  return (
    <svg
      viewBox="0 0 160 192"
      className={[styles.peep, styles[name], className].filter(Boolean).join(' ')}
      data-mood={mood}
      aria-hidden="true"
      focusable="false"
    >
      {cast.back}
      <ellipse className={styles.fillSkin} cx="80" cy="72" rx="42" ry="48" />
      <path className={styles.line} d="M38 72 a42 48 0 1 1 84 0 a42 48 0 1 1 -84 0" />
      {cast.front}
      <Face mood={mood} />
      <Bust collar={cast.collar} />
    </svg>
  );
}
