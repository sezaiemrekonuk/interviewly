'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Avatar } from '../avatar';
import { CameraView } from '../camera-view';
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
 * Presence beside the face. Neither interviewer has a camera, so the voice is drawn under their
 * portrait: CSS bars with per-bar delays (a `style` attribute would be dropped by the CSP),
 * settling flat the moment that persona stops — a finished interviewer must read as finished,
 * not as a dropped connection.
 *
 * `state` is the resolved avatar state (§3.8) — the same value that used to pick an avatar
 * frame now decides whether these bars move.
 */
function Wave({
  speaking,
  small = false,
  state,
  className,
}: {
  speaking: boolean;
  small?: boolean;
  state?: AvatarState;
  className?: string;
}) {
  return (
    <span
      className={cx(styles.wave, small && styles.waveSm, !speaking && styles.waveOff, className)}
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

/**
 * A meeting tile: the picture is the tile, everything else floats on top of it. The name plate
 * sits bottom-right and the LIVE badge top-right, the way every call surface a candidate has
 * used puts them — the tile is read at a glance, and a header row above the face makes it a
 * card instead.
 *
 * `children` is the picture: a persona's expression, or the candidate's own camera.
 */
function VideoTile({
  name,
  role,
  live,
  lead,
  testId,
  wave,
  children,
  className,
}: {
  name: string;
  role: string;
  live: boolean;
  lead: boolean;
  testId: string;
  wave: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('room');

  return (
    <div
      data-testid={testId}
      data-live={live ? 'true' : 'false'}
      className={cx(styles.videoTile, lead ? styles.videoLead : styles.videoSmall, className)}
    >
      {children}
      {live ? (
        <span className={cx(styles.liveBadge, styles.badgeFloat)}>
          <MiniBars />
          {t('live')}
        </span>
      ) : null}
      {wave}
      <div className={styles.plate}>
        <p className={styles.plateName}>{name}</p>
        <p className={styles.plateRole}>{role}</p>
      </div>
    </div>
  );
}

function PersonaTile({
  persona,
  live,
  state,
  expression,
  video,
  lead,
  className,
}: {
  persona: RoomPersona;
  live: boolean;
  state: AvatarState;
  /** `change_avatar`'s live slot for this persona (1..3). Only the speaker is ever asked. */
  expression: number;
  /** Stage layout: the tile is a picture with its name on it. Text mode's strip is a row. */
  video: boolean;
  lead: boolean;
  className?: string;
}) {
  const t = useTranslations('room');
  const role = persona.roundType === 'hr' ? t('roleHr') : t('roleTech');
  const speaking = live && state === 'speaking';
  const portrait = (
    <Avatar
      personaId={persona.id}
      name={persona.name}
      avatarSet={persona.avatarSet}
      state={state}
      expression={expression}
      size={video ? (lead ? 480 : 240) : 40}
      className={video ? styles.portraitFill : styles.portraitSm}
    />
  );

  if (video) {
    return (
      <VideoTile
        testId={`persona-tile-${persona.roundType}`}
        name={persona.name}
        role={role}
        live={live}
        lead={lead}
        className={className}
        wave={
          <Wave
            speaking={speaking}
            small={!lead}
            state={live ? state : 'idle'}
            className={styles.waveFloat}
          />
        }
      >
        {portrait}
      </VideoTile>
    );
  }

  return (
    <div
      data-testid={`persona-tile-${persona.roundType}`}
      data-live={live ? 'true' : 'false'}
      className={cx(styles.tile, styles.tileSmall, className)}
    >
      <div className={styles.tileHead}>
        {portrait}
        <div className={styles.tileWho}>
          <p className={styles.tileName}>{persona.name}</p>
          <p className={styles.tileRole}>{role}</p>
        </div>
        {live ? (
          <span className={styles.liveBadge}>
            <MiniBars />
            {t('live')}
          </span>
        ) : null}
      </div>
      <Wave speaking={speaking} small state={live ? state : 'idle'} />
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
  activeExpression = 1,
  layout = 'stage',
  candidate = null,
}: {
  personas: RoomPersona[];
  activeId: string | null;
  activeState: AvatarState;
  /**
   * `GET /state`'s `persona.avatar` — the expression the *speaker* was last asked for
   * (`change_avatar`). The server resolves it for the live persona only, so every other tile
   * keeps the first slot: an interviewer who is not talking has nothing to react to.
   */
  activeExpression?: number;
  layout?: 'stage' | 'strip';
  /** Voice only: the candidate is the third tile, and the only one with a level and a camera. */
  candidate?: { level: number; muted: boolean; camera: boolean } | null;
}) {
  const t = useTranslations('room');
  const expressionFor = (personaId: string) => (personaId === activeId ? activeExpression : 1);

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
            expression={expressionFor(persona.id)}
            video={false}
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
        expression={expressionFor(lead.id)}
        video
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
              expression={expressionFor(persona.id)}
              video
              lead={false}
            />
          ))}

        {candidate ? (
          // The candidate's tile is the same tile as everyone else's — their own camera where
          // the interviewer has a portrait, and the same plate in the same corner. A room where
          // one participant is drawn differently from the others is not a room.
          <VideoTile
            testId="persona-tile-you"
            name={t('speakerYou')}
            role={t('roleCandidate')}
            live={false}
            lead={false}
            wave={
              <Wave
                speaking={!candidate.muted && candidate.level > SPEAKING_LEVEL}
                small
                className={styles.waveFloat}
              />
            }
          >
            {/* Off unless they turned it on. With no picture the tile is the drawn voice again,
                which is what the wave above is doing — nothing else has to change. */}
            {candidate.camera ? <CameraView enabled className={styles.selfCam} /> : null}
            {/* The candidate's own level, the one thing in this room that is measured. */}
            <div className={styles.micMeter} data-testid="mic-level">
              <Meter value={candidate.level} max={1} tone="live" instant label={t('micLevel')} />
            </div>
          </VideoTile>
        ) : null}
      </div>
    </div>
  );
}
