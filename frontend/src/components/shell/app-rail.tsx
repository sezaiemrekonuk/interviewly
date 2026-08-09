'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { Link, usePathname, useRouter } from '../../i18n/navigation';
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
  const accountRef = useRef<HTMLDetailsElement>(null);

  // What identifies the account in the panel and on the monogram: the name from card 1
  // (§3.3) when it exists, else the address's local part — never the raw address as the
  // "name", and never a placeholder there is no signal for.
  const displayName = user?.fullName || (user?.email ?? '?').split('@')[0];
  const monogram = displayName.slice(0, 1).toLocaleUpperCase(locale);
  const account = ACCOUNT.filter((item) => !('adminOnly' in item) || user?.role === 'admin');
  // Which account surface, if any, the user is looking at. Below 60rem these live behind the
  // monogram, so this is also what the closed disclosure has to announce.
  const here = account.find((item) => pathname === item.href);

  // The one bit of script `<details>` doesn't give for free: a click anywhere outside the
  // panel closes it, the way every other menu on the platform behaves. `mousedown` rather than
  // `click` so this fires before a click *inside* the panel (e.g. a nav Link) triggers its own
  // navigation — closing on the trailing `click` there would race the route change.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const node = accountRef.current;
      if (node?.open && !node.contains(event.target as Node)) node.open = false;
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

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

      {/* The account, behind one click on the monogram at every width: who is signed in, the
          surfaces that belong to them, and the way out. A native <details> — keyboard-complete
          with no focus trap. `app-rail.module.css` opens the panel downward under the top
          bar's trigger below 60rem, and upward from the viewport-pinned desktop rail above it,
          with a short scale-and-fade so the reveal isn't a hard cut. The one behaviour the
          element doesn't give for free — closing on an outside click — is the `pointerdown`
          listener above; everything else here is still markup, no focus trap and no state of
          our own to get out of sync with `open`. */}
      <details className={styles.account} ref={accountRef}>
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
          {/* Visible, not just in the `aria-label`: closed, this is the only place on the rail
              that says who is signed in. `.summaryName` folds away below 60rem, where the
              top bar has no room for it beside the three nav items. */}
          <span className={styles.summaryName} aria-hidden="true">
            {displayName}
          </span>
        </summary>

        <div className={styles.panel}>
          {/* The name from card 1, or the address's local part when no card was filled: on a
              shared handset "which account am I in" is the first question the menu has to
              answer, and a raw address is a worse answer to it than a name would be. The full
              address is still one hover away via the title. */}
          <div className={styles.identity}>
            <span className={styles.monogram} aria-hidden="true">
              {monogram}
            </span>
            <span className={styles.name} title={user?.email}>
              {displayName}
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
