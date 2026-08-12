import { useTranslations } from 'next-intl';

import { SiteFooter } from '../../components/chrome/footer';
import { SiteHeader } from '../../components/chrome/header';
import { Handover } from '../../components/home/handover';
import { Peep } from '../../components/home/peeps';
import { Link } from '../../i18n/navigation';
import { alternatesFor } from '../../lib/site';

import styles from './page.module.css';

import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: alternatesFor('/', locale) };
}

const FAQ = ['listing', 'voice', 'time', 'languages', 'data'] as const;

const STEPS = ['listing', 'rounds', 'report'] as const;

const ANATOMY = ['score', 'rounds', 'strengths', 'questions', 'transcript', 'pdf'] as const;

export default function Home() {
  const t = useTranslations('landing');

  return (
    <>
      <SiteHeader onDark />

      <main id="content" tabIndex={-1} className={styles.ground}>
        <Handover />

        <section id="mechanism" className={styles.band} aria-labelledby="mechanism-title">
          <div className={styles.bandHead}>
            <h2 id="mechanism-title" className={styles.bandTitle}>
              {t('mechanism.title')}
            </h2>
            <p className={styles.bandLede}>{t('mechanism.lede')}</p>
          </div>

          <ol className={styles.flow}>
            {STEPS.map((key, index) => (
              <li key={key} className={styles.node}>
                <span className={styles.nodeRule} aria-hidden="true" />
                <span className={`${styles.nodeIndex} tabular`} aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className={styles.nodeTitle}>{t(`mechanism.steps.${key}.title`)}</h3>
                <p className={styles.nodeBody}>{t(`mechanism.steps.${key}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="modes" className={styles.band} aria-labelledby="modes-title">
          <div className={styles.bandHead}>
            <h2 id="modes-title" className={styles.bandTitle}>
              {t('modes.title')}
            </h2>
            <p className={styles.bandLede}>{t('modes.lede')}</p>
          </div>

          <div className={styles.modes}>
            <article className={styles.mode}>
              <h3 className={styles.modeTitle}>{t('modes.voice.title')}</h3>
              <p className={styles.modeBody}>{t('modes.voice.body')}</p>
              <div className={styles.controlBar} aria-hidden="true">
                <span className={styles.control}>{t('modes.voice.mute')}</span>
                <span className={styles.control}>{t('modes.voice.captions')}</span>
                <span className={styles.controlLeave}>{t('modes.voice.leave')}</span>
              </div>
            </article>

            <article className={styles.mode}>
              <h3 className={styles.modeTitle}>{t('modes.text.title')}</h3>
              <p className={styles.modeBody}>{t('modes.text.body')}</p>
              <div className={styles.composer} aria-hidden="true">
                <span className={styles.composerLabel}>{t('modes.text.label')}</span>
                <span className={styles.composerField}>{t('modes.text.placeholder')}</span>
                <span className={styles.composerSend}>{t('modes.text.send')}</span>
              </div>
            </article>
          </div>
        </section>

        <section id="report" className={styles.band} aria-labelledby="report-title">
          <div className={styles.bandHead}>
            <h2 id="report-title" className={styles.bandTitle}>
              {t('report.title')}
            </h2>
            <p className={styles.bandLede}>{t('report.lede')}</p>
          </div>

          <dl className={styles.anatomy}>
            {ANATOMY.map((key) => (
              <div key={key} className={styles.anatomyRow}>
                <dt className={styles.anatomyTerm}>{t(`report.items.${key}.term`)}</dt>
                <dd className={styles.anatomyDef}>{t(`report.items.${key}.def`)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={styles.band} aria-labelledby="lang-title">
          <div className={styles.bandHead}>
            <h2 id="lang-title" className={styles.bandTitle}>
              {t('languages.title')}
            </h2>
            <p className={styles.bandLede}>{t('languages.lede')}</p>
          </div>

          <div className={styles.langPair}>
            <figure className={styles.langCard}>
              <figcaption className={styles.langTag}>{t('languages.en')}</figcaption>
              <p className={styles.langQuote}>{t('languages.enQuestion')}</p>
            </figure>
            <div className={styles.langAsker}>
              <Peep name="turing" mood="asking" />
            </div>
            <figure className={styles.langCard}>
              <figcaption className={styles.langTag}>{t('languages.tr')}</figcaption>
              <p className={styles.langQuote}>{t('languages.trQuestion')}</p>
            </figure>
          </div>
        </section>

        <section id="faq" className={styles.band} aria-labelledby="faq-title">
          <div className={styles.bandHead}>
            <h2 id="faq-title" className={styles.bandTitle}>
              {t('faq.title')}
            </h2>
          </div>

          <div className={styles.faq}>
            {FAQ.map((key) => (
              <details key={key} className={styles.faqItem}>
                <summary className={styles.faqQuestion}>{t(`faq.items.${key}.q`)}</summary>
                <p className={styles.faqAnswer}>{t(`faq.items.${key}.a`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.closing}>
          <div className={styles.closingCast} aria-hidden="true">
            <span className={styles.closingPeep}>
              <Peep name="ada" mood="pleased" />
            </span>
            <span className={styles.closingPeep}>
              <Peep name="turing" mood="idle" />
            </span>
          </div>
          <p className={styles.closingLine}>{t('closing.line')}</p>
          <Link href="/register" className={styles.closingCta}>
            {t('closing.cta')}
          </Link>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
