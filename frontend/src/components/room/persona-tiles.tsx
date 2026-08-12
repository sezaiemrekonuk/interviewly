'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Avatar } from '../avatar';
import { CameraView } from '../camera-view';
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
  testId,
  wave,
  children,
  className,
}: {
  name: string;
  role: string;
  live: boolean;
  testId: string;
  /** The drawn voice, when this participant has one to draw. The interviewers do not: their
   *  picture plus the speaking ring is the whole signal, and a waveform over a face was two
   *  things saying one thing. */
  wave?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-live={live ? 'true' : 'false'}
      className={cx(styles.videoTile, className)}
    >
      {children}
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
  className,
}: {
  persona: RoomPersona;
  live: boolean;
  state: AvatarState;
  /** `change_avatar`'s live slot for this persona (1..3). Only the speaker is ever asked. */
  expression: number;
  /** Stage layout: the tile is a picture with its name on it. Text mode's strip is a row. */
  video: boolean;
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
      size={video ? 480 : 40}
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
        className={className}
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
  view = 'grid',
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
  /** Speaker view drops the interviewer who is not talking; grid keeps the whole room. Both
   *  draw every tile at the same size — a call does not shrink one participant. */
  view?: 'speaker' | 'grid';
  /** Voice only: the candidate is the third tile, and the only one with a level and a camera. */
  candidate?: { level: number; muted: boolean; camera: boolean; cameraId?: string | null } | null;
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
            className={styles.stripTile}
          />
        ))}
      </div>
    );
  }

  // Speaker view keeps everyone on stage and gives the floor to whoever has it — a room that
  // drops the other interviewer is a room with one person in it, which is what the toggle
  // looked like when the round had only resolved one persona.
  return (
    <div className={styles.tiles} data-testid="persona-tiles" data-view={view}>
      {personas.map((persona) => (
        <PersonaTile
          key={persona.id}
          persona={persona}
          live={persona.id === activeId}
          state={persona.id === activeId ? activeState : 'idle'}
          expression={expressionFor(persona.id)}
          video
        />
      ))}

      {candidate ? (
        // The candidate's tile is the same tile as everyone else's — their own camera where the
        // interviewer has a portrait, and the same plate in the same corner. They keep the drawn
        // voice because theirs is the one level in this room that is measured.
        <VideoTile
          testId="persona-tile-you"
          name={t('speakerYou')}
          role={t('roleCandidate')}
          live={false}
          wave={
            <Wave
              speaking={!candidate.muted && candidate.level > SPEAKING_LEVEL}
              small
              className={styles.waveFloat}
            />
          }
        >
          {candidate.camera ? (
            <CameraView enabled deviceId={candidate.cameraId ?? undefined} className={styles.selfCam} />
          ) : null}
        </VideoTile>
      ) : null}
    </div>
  );
}
