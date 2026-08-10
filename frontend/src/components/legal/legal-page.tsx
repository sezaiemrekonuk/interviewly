import { useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import styles from './legal.module.css';

export type LegalDoc = 'privacy' | 'terms';

interface Section {
  heading: string;
  body: string;
}

/**
 * Both legal documents are the same shape with different words, so they are one component
 * reading a `legal.<doc>` namespace rather than two near-identical pages — two pages drift
 * the first time only one of them is edited, and a policy that says two things is worse
 * than one that says one.
 *
 * A Server Component: there is nothing to interact with, and the §8.1 JS budget should not
 * pay for a document.
 *
 * Deliberately *not* the split shell. Direction B's rail says what is true right now, and a
 * policy has no right-now — the rail would be a dark column carrying a wordmark and nothing
 * else, on the one screen whose whole job is an uninterrupted read. So: a centred sheet on
 * the flat ground, the site chrome above and below it for the way out, and the measure
 * capped where a long read stays readable.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const t = useTranslations('legal');
  const d = useTranslations(`legal.${doc}` as 'legal.privacy');
  // `raw`: the sections are an array of objects — data the page walks, not an ICU message.
  const sections = d.raw('sections') as Section[];

  return (
    <main id="content" tabIndex={-1} className={styles.doc}>
      <article className={styles.sheet}>
        <header className={styles.head}>
          <p className={styles.updated}>{t('updated')}</p>
          <h1 className={styles.title}>{d('title')}</h1>
          <p className={styles.intro}>{d('intro')}</p>
        </header>

        {sections.map((section, index) => (
          <section key={section.heading} className={styles.section}>
            {/* The ordinal is a sibling of the heading, never inside it: nested in the h2 it
                would join the accessible name and every "clause 3" reference would read
                "03 Clause 3". */}
            <div className={styles.sectionHead}>
              <span className={`${styles.ordinal} tabular`} aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h2 className={styles.heading}>{section.heading}</h2>
            </div>
            <p className={styles.body}>{section.body}</p>
          </section>
        ))}

        <footer className={styles.foot}>
          <p className={styles.contact}>{t('contact', { email: t('contactEmail') })}</p>
          {/* A text link, not a button: leaving a policy is not an action the surface
              promotes. */}
          <Link href="/" className={styles.back}>
            {t('backHome')}
          </Link>
        </footer>
      </article>
    </main>
  );
}
