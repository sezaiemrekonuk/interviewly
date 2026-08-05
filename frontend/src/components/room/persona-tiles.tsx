'use client';

import { useTranslations } from 'next-intl';

import { Avatar } from '../avatar';
import type { RoomPersona } from '../../lib/query';
import type { AvatarState } from '../../lib/room-avatar';

import styles from './room.module.css';

/**
 * Two tiles, one live speaker (§3.2, K2). `activeId` is the id room-state named as the active
 * persona — the other tile is a roster row, never a second animated speaker, and `--live`
 * (the ring and the badge) is on exactly one tile or none.
 */
export function PersonaTiles({
  personas,
  activeId,
  activeState,
}: {
  personas: RoomPersona[];
  activeId: string | null;
  activeState: AvatarState;
}) {
  const t = useTranslations('room');

  // No roster, no empty grid: an interview with no personas resolved yet shows the question
  // panel alone rather than a pair of blank boxes.
  if (personas.length === 0) return null;

  return (
    <div className={styles.tiles} data-testid="persona-tiles">
      {personas.map((persona) => {
        const live = persona.id === activeId;
        return (
          <div
            key={persona.id}
            data-testid={`persona-tile-${persona.roundType}`}
            data-live={live ? 'true' : 'false'}
            className={live ? `${styles.tile} ${styles.tileLive}` : styles.tile}
          >
            <Avatar
              personaId={persona.id}
              state={live ? activeState : 'idle'}
              avatarSet={persona.avatarSet}
              name={persona.name}
              size={72}
              className={styles.tileAvatar}
            />
            <div className={styles.tileText}>
              <p className={live ? `${styles.tileName} ${styles.tileNameLive}` : styles.tileName}>
                {persona.name}
              </p>
              <p className={live ? `${styles.tileRole} ${styles.tileRoleLive}` : styles.tileRole}>
                {persona.roundType === 'hr' ? t('roleHr') : t('roleTech')}
              </p>
            </div>
            {live ? <span className={styles.liveBadge}>{t('live')}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
