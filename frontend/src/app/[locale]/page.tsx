import { useTranslations } from 'next-intl';

import { SiteFooter } from '../../components/chrome/footer';
import { SiteHeader } from '../../components/chrome/header';
import { DemoInterview } from '../../components/home/demo-interview';
import { HomeSwitch } from '../../components/home/home-switch';
import { Link } from '../../i18n/navigation';
import { alternatesFor } from '../../lib/site';

import styles from './page.module.css';

import type { Metadata } from 'next';

/**
 * The landing page's own canonical, and the hreflang pair that gives the Turkish landing page
 * an address a crawler can find (issue 91). The root layout deliberately sets none — a
 * canonical inherited by every route is how `/privacy` and `/terms` came to claim they were
 * duplicates of this page — so each public route declares its own.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: alternatesFor('/', locale) };
}

/*
 * THESIS — This page is an interview, not a page about one. It refuses the category's
 * arrangement (hero, three feature cards, testimonial band, CTA) and the product's own previous
 * arrangement (one static <figure> mocking a session). The visitor sits in the chair in the
 * first viewport and is scored before they have an account.
 *
 * OWN-WORLD — Direction B, unchanged and inherited: the rail's near-black indigo as the room's
 * material against the light working surface; burnt orange used exactly once on the page;
 * Source Serif for anything spoken, Public Sans for anything operated, JetBrains Mono for
 * anything measured; 1px hairlines and near-square corners. Recognisable with every word
 * removed by the dark stage sitting inside a light document.
 *
 * STORY — "Two interviewers, and they want different things from me." The visitor answers Ada,
 * watches four axes fill and a written criticism arrive, then watches Turing probe something
 * else entirely with the same machinery. They understand the mechanism before they read a
 * single claim about it, and the claims that follow only name what they already saw.
 *
 * FIRST VIEWPORT — A tight hero band (headline, one line, the page's single --primary) sitting
 * directly above the stage: two interviewer tiles on the rail's material, Ada lit, her question
 * typing itself out in serif at 28px, and three answers waiting underneath. The primary action
 * is top-right of the band; the interesting action is the answer the visitor picks.
 *
 * FORM — Two interviewers as the page's spine. Candidate 6 of the grounded list, assigned by
 * concept-seed key d2e717bb (scope surface, mode persuade). Staging: the product's own room,
 * lifted onto the document — the grid-break and epoch-descent challengers were weighed and lost
 * on product clarity, both being compositions about sequence rather than about the two probes.
 */

/** Native <details> for the FAQ: a disclosure widget the platform already ships, keyboard-complete. */
const FAQ = ['listing', 'voice', 'time', 'languages', 'data'] as const;

/** Named so the index is authored once rather than in three copies of the markup. */
const STEPS = ['listing', 'rounds', 'report'] as const;

export default function Home() {
  const t = useTranslations('landing');

  return (
    <>
      <SiteHeader />

      <main id="content" tabIndex={-1} className={styles.ground}>
        <HomeSwitch>
          {/* Deliberately short — headline, subhead, one CTA. The argument is the stage
              directly below, and a full-height hero would put it under the fold. */}
          <section className={styles.hero}>
            <h1 className={styles.title}>{t('hero')}</h1>
            <p className={styles.subhead}>{t('subhead')}</p>
            <div className={styles.heroAct}>
              <Link href="/register" className={styles.cta}>
                {t('cta')}
              </Link>
            </div>
          </section>

          <section id="demo" className={styles.demoSection} aria-labelledby="how-it-works-title">
            <h2 id="how-it-works-title" className={styles.demoSectionTitle}>
              {t('howItWorks')}
            </h2>
            <DemoInterview />
          </section>

          {/* ---------------------------------------------- how the questions get written */}
          <section id="mechanism" className={styles.band} aria-labelledby="mechanism-title">
            <div className={styles.bandHead}>
              <h2 id="mechanism-title" className={styles.bandTitle}>
                {t('mechanism.title')}
              </h2>
              <p className={styles.bandLede}>{t('mechanism.lede')}</p>
            </div>

            <ol className={styles.steps}>
              {STEPS.map((key, index) => (
                <li key={key} className={styles.step}>
                  <span className={`${styles.stepIndex} tabular`} aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3 className={styles.stepTitle}>{t(`mechanism.steps.${key}.title`)}</h3>
                  <p className={styles.stepBody}>{t(`mechanism.steps.${key}.body`)}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* ------------------------------------------------------------ voice, or text */}
          <section id="modes" className={styles.band} aria-labelledby="modes-title">
            <div className={styles.bandHead}>
              <h2 id="modes-title" className={styles.bandTitle}>
                {t('modes.title')}
              </h2>
              <p className={styles.bandLede}>{t('modes.lede')}</p>
            </div>

            <div className={styles.modes}>
              <article className={styles.modeVoice}>
                <h3 className={styles.modeTitle}>{t('modes.voice.title')}</h3>
                <p className={styles.modeBody}>{t('modes.voice.body')}</p>
                {/* The room's own control bar, at rest. Not an illustration of one. */}
                <div className={styles.controlBar} aria-hidden="true">
                  <span className={styles.control}>{t('modes.voice.mute')}</span>
                  <span className={styles.control}>{t('modes.voice.captions')}</span>
                  <span className={styles.controlLeave}>{t('modes.voice.leave')}</span>
                </div>
              </article>

              <article className={styles.modeText}>
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

          {/* --------------------------------------------------- what the report contains */}
          <section id="report" className={styles.band} aria-labelledby="report-title">
            <div className={styles.bandHead}>
              <h2 id="report-title" className={styles.bandTitle}>
                {t('report.title')}
              </h2>
              <p className={styles.bandLede}>{t('report.lede')}</p>
            </div>

            {/* A document, not a card grid: this is the shape of the thing being described. */}
            <dl className={styles.anatomy}>
              {(['score', 'rounds', 'strengths', 'questions', 'transcript', 'pdf'] as const).map(
                (key) => (
                  <div key={key} className={styles.anatomyRow}>
                    <dt className={styles.anatomyTerm}>{t(`report.items.${key}.term`)}</dt>
                    <dd className={styles.anatomyDef}>{t(`report.items.${key}.def`)}</dd>
                  </div>
                ),
              )}
            </dl>
          </section>

          {/* --------------------------------------------------------------- two languages */}
          <section className={styles.langBand} aria-labelledby="lang-title">
            <div className={styles.bandHead}>
              <h2 id="lang-title" className={styles.bandTitle}>
                {t('languages.title')}
              </h2>
              <p className={styles.bandLede}>{t('languages.lede')}</p>
            </div>

            {/* The claim, shown: the same question as each interviewer actually asks it. */}
            <div className={styles.langPair}>
              <figure className={styles.langCard}>
                <figcaption className={styles.langTag}>{t('languages.en')}</figcaption>
                <p className={styles.langQuote}>{t('languages.enQuestion')}</p>
              </figure>
              <figure className={styles.langCard}>
                <figcaption className={styles.langTag}>{t('languages.tr')}</figcaption>
                <p className={styles.langQuote}>{t('languages.trQuestion')}</p>
              </figure>
            </div>
          </section>

          {/* ------------------------------------------------------------------------ faq */}
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

          {/* Quiet by design: the surface's one --primary is in the hero, so the closing band
              invites in the secondary shape rather than competing with it. */}
          <section className={styles.closing}>
            <p className={styles.closingLine}>{t('closing.line')}</p>
            <Link href="/register" className={styles.closingCta}>
              {t('closing.cta')}
            </Link>
          </section>
        </HomeSwitch>
      </main>

      <SiteFooter />
    </>
  );
}
