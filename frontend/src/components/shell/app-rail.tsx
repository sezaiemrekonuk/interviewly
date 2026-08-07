'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useSignOut } from '../../lib/query';
import type { SessionUser } from '../../lib/use-require-auth';

import { RailMark } from './split-shell';
import styles from './app-rail.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

/**
 * The rail carries navigation on every signed-in surface.
 *
 * Before this, the product had a header on two routes out of seventeen and no way at all to
 * end a session — `POST /auth/logout` had shipped and nothing called it, so on a shared
 * machine the only exit was account deletion. A top bar would have been the obvious fix and
 * the wrong one: DESIGN §2 rule 4 makes the split shell the one layout, and the rail is
 * already the column that says where you are. It just never said where you could go.
 *
 * Which surfaces get this rail, and which keep their own: anything the user *browses* takes
 * this one. The room, pre-join and the report keep a context rail, because those screens have
 * something more urgent to say than "here is the menu" — but each of them carries a way back
 * to `/dashboard`, which is what they were missing.
 */

interface NavItem {
  href: string;
  key: 'today' | 'interviews' | 'new';
  /** `/interviews/new` lives under `/interviews`, so only the exact path may match it. */
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard', key: 'today' },
  { href: '/interviews', key: 'interviews', exact: true },
  { href: '/interviews/new', key: 'new' },
];

/** The account's own surfaces. A list rather than three hand-written links so the disclosure
 *  can name the one that is current without a second copy of the same three paths. */
const ACCOUNT = [
  { href: '/profile', key: 'profile' },
  { href: '/settings', key: 'settings' },
  { href: '/admin', key: 'admin', adminOnly: true },
] as const;

function isCurrent(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function AppRail({ user }: { user: SessionUser | null }) {
  const t = useTranslations('nav');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const signOut = useSignOut();

  const monogram = (user?.email ?? '?').slice(0, 1).toLocaleUpperCase(locale);
  const account = ACCOUNT.filter((item) => !('adminOnly' in item) || user?.role === 'admin');
  // Which account surface, if any, the user is looking at. Below 60rem these live behind the
  // monogram, so this is also what the closed disclosure has to announce.
  const here = account.find((item) => pathname === item.href);

  async function endSession() {
    await signOut.mutateAsync();
    // `replace`, not `push`: the signed-in page must not be a back-button target once the
    // session behind it is gone.
    router.replace('/');
  }

  return (
    <>
      <Link href="/dashboard" className={styles.markLink}>
        <RailMark />
      </Link>

      <nav className={styles.nav} aria-label={t('label')}>
        {NAV.map((item) => {
          const current = isCurrent(pathname, item);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cx(styles.navItem, current && styles.navItemOn)}
              // The raised block is not the only signal — assistive tech reads this, and it is
              // what a screen reader user has instead of the lighter background.
              aria-current={current ? 'page' : undefined}
            >
              {t(item.key)}
            </Link>
          );
        })}
      </nav>

      {/* The account, at the foot: who is signed in, the surfaces that belong to them, and the
          way out. On the rail proper it is a flat list — the column has the room, and a menu
          would hide the one control whose absence was the defect.

          Below 60rem the rail is a top bar and there is no room: eight permanently-visible
          items wrapped into three stacked rows and ate a fifth of a 390×844 phone before any
          content. So the account collapses behind the monogram there, as a native <details>.
          The platform's own disclosure is keyboard-complete with no JS, no focus trap and no
          outside-click listener to leak, and the landing FAQ already uses one. Above 60rem
          `app-rail.module.css` removes the summary and forces the panel open, so the desktop
          rail is unchanged and its summary is not in the tab order or the a11y tree. */}
      <details className={styles.account}>
        <summary
          className={cx(styles.summary, here && styles.summaryOn)}
          // The monogram is decorative, so without this the toggle has no name at all. When
          // the current item is one of the ones it hides, the name says which — `aria-current`
          // on a link nobody can reach announces nothing.
          aria-label={here ? t('accountCurrent', { section: t(here.key) }) : t('account')}
        >
          <span className={styles.monogram} aria-hidden="true">
            {monogram}
          </span>
        </summary>

        <div className={styles.panel}>
          {/* The address is hidden beside the monogram on a phone but not lost: on a shared
              handset "which account am I in" is the first question the menu has to answer. */}
          <div className={styles.identity}>
            <span className={styles.monogram} aria-hidden="true">
              {monogram}
            </span>
            <span className={styles.email} title={user?.email}>
              {user?.email}
            </span>
          </div>

          {account.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={cx(styles.accountLink, item === here && styles.accountLinkOn)}
              aria-current={item === here ? 'page' : undefined}
            >
              {t(item.key)}
            </Link>
          ))}

          <button
            type="button"
            className={styles.signOut}
            disabled={signOut.isPending}
            onClick={() => void endSession()}
          >
            {signOut.isPending ? t('signingOut') : t('signOut')}
          </button>
        </div>
      </details>
    </>
  );
}
