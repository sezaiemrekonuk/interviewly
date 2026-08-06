'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useMyInterviews, useProfile } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';
import { Mascot } from '../mascot';

import { DeleteAccount } from './delete-account';
import styles from './home.module.css';
import { InterviewRow } from './interview-row';

/** `fullName` is one free-text field; the greeting wants the first word of it, or nothing. */
function firstName(fullName: string | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

/**
 * W08 — the signed-in half of `/`: greeting, the one `--primary` CTA, and the history.
 *
 * `/` stays an entry surface (`ENTRY_ROUTES` is closed, ui §4.2), so this keeps the gradient
 * ground the page already paints and `--shadow-soft` on its cards; the task file's
 * "flat `--bg`" was written for a standalone `/dashboard` route that does not exist.
 */
export function AuthedHome() {
  const t = useTranslations('home');
  const errorMessage = useErrorMessage();
  const profile = useProfile();
  const list = useMyInterviews();

  const name = firstName(profile.data?.profile.fullName);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const empty = !list.isPending && !list.error && items.length === 0;

  return (
    <section className={styles.home} data-testid="authed-home">
      <header className={styles.greetingBlock}>
        <h1 className={styles.greeting}>
          {name ? t('greeting', { name }) : t('greetingPlain')}
        </h1>
        {/* One `--primary` per surface: on an empty history the empty state carries it. */}
        {empty ? null : (
          <Link href="/interviews/new" className={styles.primaryCta}>
            {t('newInterview')}
          </Link>
        )}
      </header>

      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>{t('historyTitle')}</h2>

        {list.isPending ? (
          <ul className={styles.list} data-testid="history-skeleton" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className={styles.skeletonRow} />
            ))}
          </ul>
        ) : null}

        {list.error ? (
          <p role="alert" className={styles.error}>
            {errorMessage(list.error.code)}
          </p>
        ) : null}

        {empty ? (
          <div className={styles.empty} data-testid="history-empty">
            <Mascot pose="shrug" size={120} alt="" />
            <h3 className={styles.emptyTitle}>{t('empty.title')}</h3>
            <p className={styles.emptyBody}>{t('empty.body')}</p>
            <Link href="/interviews/new" className={styles.emptyCta}>
              {t('empty.cta')}
            </Link>
          </div>
        ) : null}

        {items.length > 0 ? (
          <ul className={styles.list}>
            {items.map((interview) => (
              <InterviewRow key={interview.id} interview={interview} />
            ))}
          </ul>
        ) : null}

        {list.hasNextPage ? (
          <button
            type="button"
            className={styles.loadMore}
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('loadMore')}
          </button>
        ) : null}
      </div>

      <DeleteAccount />
    </section>
  );
}
