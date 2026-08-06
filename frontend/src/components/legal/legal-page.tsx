import { useTranslations } from 'next-intl';
import Link from 'next/link';

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
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const t = useTranslations('legal');
  const d = useTranslations(`legal.${doc}` as 'legal.privacy');
  // `raw`: the sections are an array of objects — data the page walks, not an ICU message.
  const sections = d.raw('sections') as Section[];

  return (
    <main className={styles.doc}>
      <article className={styles.panel}>
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.updated}>{t('updated')}</p>
        <p className={styles.intro}>{d('intro')}</p>

        {sections.map((section) => (
          <section key={section.heading} className={styles.section}>
            <h2 className={styles.heading}>{section.heading}</h2>
            <p className={styles.body}>{section.body}</p>
          </section>
        ))}

        <p className={styles.contact}>{t('contact', { email: t('contactEmail') })}</p>
        <Link href="/" className={styles.back}>
          {t('backHome')}
        </Link>
      </article>
    </main>
  );
}
