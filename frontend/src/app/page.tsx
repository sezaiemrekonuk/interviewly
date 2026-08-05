import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { SiteFooter } from '../components/chrome/footer';
import { SiteHeader } from '../components/chrome/header';
import { HomeSwitch } from '../components/home/home-switch';
import { Mascot } from '../components/mascot';
import styles from './page.module.css';

// One lead card + two narrow ones: the rhythm is asymmetric on purpose (DESIGN §3.6 —
// three identical tiles read as a template, not as three different promises).
const NARROW_PROPS = ['feedback', 'progress'] as const;

// Server Component: the client islands are the locale switcher and `HomeSwitch`, which
// swaps this whole marketing body for the signed-in home once `/me` answers (§8.1 budget).
export default function Home() {
  const t = useTranslations('landing');

  return (
    <main className={styles.ground}>
      <SiteHeader />

      <HomeSwitch>
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

          <div className={styles.showcase}>
            <div className={styles.mascotSlot}>
              <Mascot pose="wave" size={240} alt="" />
            </div>

            <figure className={styles.preview} data-testid="conversation-preview">
              <figcaption className={styles.previewLabel}>{t('preview.label')}</figcaption>
              <p className={styles.turn}>
                <span className={`${styles.persona} ${styles.personaHr}`}>
                  <span className={styles.personaDot} aria-hidden="true" />
                  {t('preview.hrChip')}
                </span>
                <span className={styles.question}>{t('preview.hrQuestion')}</span>
              </p>
              <p className={styles.answer}>{t('preview.answer')}</p>
              <p className={styles.turn}>
                <span className={`${styles.persona} ${styles.personaTech}`}>
                  <span className={styles.personaDot} aria-hidden="true" />
                  {t('preview.techChip')}
                </span>
                <span className={styles.question}>{t('preview.techQuestion')}</span>
              </p>
              <p className={styles.scoreTag}>{t('preview.score')}</p>
            </figure>
          </div>
        </section>

        <ul className={styles.props}>
          <li className={`${styles.prop} ${styles.propLead}`}>
            <h2 className={styles.propLeadTitle}>{t('props.practice.title')}</h2>
            <p className={styles.propLeadBody}>{t('props.practice.body')}</p>
          </li>
          {NARROW_PROPS.map((key) => (
            <li key={key} className={styles.prop}>
              <h2 className={styles.propTitle}>{t(`props.${key}.title`)}</h2>
              <p className={styles.propBody}>{t(`props.${key}.body`)}</p>
            </li>
          ))}
        </ul>

        {/* Quiet on purpose: the hero owns the surface's one `--primary`, so the closing
            band invites in the secondary shape (DESIGN §3.3/§3.6). */}
        <section className={styles.closing}>
          <p className={styles.closingLine}>{t('closing.line')}</p>
          <Link href="/register" className={styles.closingCta}>
            {t('closing.cta')}
          </Link>
        </section>
      </HomeSwitch>

      <SiteFooter />
    </main>
  );
}
