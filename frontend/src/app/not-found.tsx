import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';

import { Link } from '../i18n/navigation';

import styles from './not-found.module.css';

/**
 * The route that was being navigated to and did not exist.
 *
 * `lib/error-routing.ts` sends every `INTERVIEW_NOT_FOUND` to `/not-found`, and there was no
 * such page — so opening a deleted interview landed on Next's own 404: no chrome, no wordmark,
 * no way back into the product except the browser's back button. This file is both the literal
 * `/not-found` route and Next's handler for every unmatched URL, so one page covers both.
 *
 * It lives above `[locale]` because Next renders a not-found outside the matched route's
 * layouts, and an unmatched URL has no locale segment to read. The locale it speaks is the one
 * the middleware negotiated — so a Turkish visitor's dead link is a Turkish 404 — and it brings
 * its own provider because the one in `[locale]/layout.tsx` is not above it (issue 91).
 *
 * Deliberately not the split shell. The rail's job is to say what is true right now, and on a
 * page that exists because something is missing there is nothing true to put on it.
 */
export default async function NotFound() {
  const t = await getTranslations('notFound');
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <main id="content" tabIndex={-1} className={styles.ground}>
        <div className={styles.panel}>
          <p className={styles.code}>404</p>
          <h1 className={styles.title}>{t('title')}</h1>
          <p className={styles.body}>{t('body')}</p>
          <div className={styles.actions}>
            <Link href="/dashboard" className={styles.primary}>
              {t('home')}
            </Link>
            <Link href="/interviews" className={styles.secondary}>
              {t('interviews')}
            </Link>
          </div>
        </div>
      </main>
    </NextIntlClientProvider>
  );
}
