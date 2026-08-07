'use client';

import { useTranslations } from 'next-intl';

import { Meter } from '../shell/meter';
import type { RoomPersona } from '../../lib/query';
import type { AvatarState } from '../../lib/room-avatar';

import styles from './room.module.css';

const LEAD_BARS = 24;
const SMALL_BARS = 16;

/** Above this the candidate's own bars move; below it the room is quiet, not broken. */
const SPEAKING_LEVEL = 0.06;

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

/**
 * Presence without a camera. Neither interviewer will ever have one, so the voice is drawn:
 * CSS bars with per-bar delays (a `style` attribute would be dropped by the CSP), settling
 * flat the moment that persona stops — a finished interviewer must read as finished, not as
 * a dropped connection.
 *
 * `state` is the resolved avatar state (§3.8) — the same value that used to pick an avatar
 * frame now decides whether these bars move.
 */
function Wave({
  speaking,
  small = false,
  state,
}: {
  speaking: boolean;
  small?: boolean;
  state?: AvatarState;
}) {
  return (
    <span
      className={cx(styles.wave, small && styles.waveSm, !speaking && styles.waveOff)}
      data-testid="wave"
      data-speaking={speaking ? 'true' : 'false'}
      data-avatar-state={state}
      aria-hidden="true"
    >
      {Array.from({ length: small ? SMALL_BARS : LEAD_BARS }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

/** Four static bars — a glyph on a control, never a second reading of the mic level. */
export function MiniBars() {
  return (
    <span className={styles.mini} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function PersonaTile({
  persona,
  live,
  state,
  lead,
  className,
}: {
  persona: RoomPersona;
  live: boolean;
  state: AvatarState;
  lead: boolean;
  className?: string;
}) {
  const t = useTranslations('room');

  return (
    <div
      data-testid={`persona-tile-${persona.roundType}`}
      data-live={live ? 'true' : 'false'}
      className={cx(styles.tile, lead ? styles.tileLead : styles.tileSmall, className)}
    >
      <div className={styles.tileHead}>
        <div>
          <p className={styles.tileName}>{persona.name}</p>
          <p className={styles.tileRole}>
            {persona.roundType === 'hr' ? t('roleHr') : t('roleTech')}
          </p>
        </div>
        {live ? (
          <span className={styles.liveBadge}>
            <MiniBars />
            {t('live')}
          </span>
        ) : null}
      </div>
      <Wave speaking={live && state === 'speaking'} small={!lead} state={live ? state : 'idle'} />
    </div>
  );
}

/**
 * The stage: the speaker on the rail's material, everyone else small and light beside them.
 * `strip` is text mode's roster — the same tiles in a row, with no stage under them.
 *
 * The wrapper is `display: contents` in stage layout: the tiles are grid items of the stage
 * itself, so the element only names them for a test, it does not box them.
 */
export function PersonaTiles({
  personas,
  activeId,
  activeState,
  layout = 'stage',
  candidate = null,
}: {
  personas: RoomPersona[];
  activeId: string | null;
  activeState: AvatarState;
  layout?: 'stage' | 'strip';
  /** Voice only: the candidate is the third tile, and the only one with a live level. */
  candidate?: { level: number; muted: boolean } | null;
}) {
  const t = useTranslations('room');

  // No roster, no empty grid: an interview with no personas resolved yet shows the question
  // alone rather than a pair of blank boxes.
  if (personas.length === 0) return null;

  if (layout === 'strip') {
    return (
      <div className={styles.strip} data-testid="persona-tiles">
        {personas.map((persona) => (
          <PersonaTile
            key={persona.id}
            persona={persona}
            live={persona.id === activeId}
            state={persona.id === activeId ? activeState : 'idle'}
            lead={false}
            className={styles.stripTile}
          />
        ))}
      </div>
    );
  }

  const lead = personas.find((persona) => persona.id === activeId) ?? personas[0];

  return (
    <div className={styles.tiles} data-testid="persona-tiles">
      <PersonaTile
        persona={lead}
        live={lead.id === activeId}
        state={lead.id === activeId ? activeState : 'idle'}
        lead
      />
      <div className={styles.side}>
        {personas
          .filter((persona) => persona.id !== lead.id)
          .map((persona) => (
            <PersonaTile
              key={persona.id}
              persona={persona}
              live={persona.id === activeId}
              state={persona.id === activeId ? activeState : 'idle'}
              lead={false}
            />
          ))}

        {candidate ? (
          <div className={cx(styles.tile, styles.tileSmall)} data-testid="persona-tile-you">
            <div className={styles.tileHead}>
              <div>
                <p className={styles.tileName}>{t('speakerYou')}</p>
                <p className={styles.tileRole}>{t('roleCandidate')}</p>
              </div>
            </div>
            <Wave speaking={!candidate.muted && candidate.level > SPEAKING_LEVEL} small />
            {/* The candidate's own level, the one thing in this room that is measured. */}
            <div className={styles.micMeter} data-testid="mic-level">
              <Meter
                value={candidate.level}
                max={1}
                tone="live"
                instant
                label={t('micLevel')}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
