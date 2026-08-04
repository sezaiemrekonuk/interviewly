import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { LocaleSwitcher } from '../components/locale-switcher';
import { Mascot } from '../components/mascot';
import styles from './page.module.css';

const PROPS = ['practice', 'feedback', 'progress'] as const;

// Server Component: the only client island is the locale switcher (§8.1 JS budget).
export default function Home() {
  const t = useTranslations('landing');

  return (
    <main className={styles.ground}>
      <header className={styles.bar}>
        <span className={styles.wordmark}>Interviewly</span>
        <LocaleSwitcher />
      </header>

      <section className={styles.hero}>
        <div>
          <h1 className={styles.title}>{t('hero')}</h1>
          <p className={styles.subhead}>{t('subhead')}</p>
          <div className={styles.actions}>
            <Link href="/register" className={styles.cta}>
              {t('cta')}
            </Link>
            <Link href="/sign-in" className={styles.secondary}>
              {t('signIn')}
            </Link>
          </div>
          <p className={styles.note}>{t('ctaNote')}</p>
        </div>
        <Mascot pose="wave" size={200} alt="" />
      </section>

      <ul className={styles.props}>
        {PROPS.map((key) => (
          <li key={key} className={styles.prop}>
            <h2 className={styles.propTitle}>{t(`props.${key}.title`)}</h2>
            <p className={styles.propBody}>{t(`props.${key}.body`)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
