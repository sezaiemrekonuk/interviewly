import { useTranslations } from 'next-intl';

import styles from './chrome.module.css';

/**
 * The first Tab stop on every page (issue 96). Without it, reaching the content past a header
 * of section anchors costs a keyboard user five or six presses on every navigation — and the
 * header is sticky, so there is no scrolling past it either.
 *
 * Mounted once in the root layout rather than per shell: it has to be the first focusable
 * element in the document, and only the layout can promise that. Every `<main>` in the app
 * carries `id="content"` to receive it.
 *
 * A real anchor, not a button with a scroll handler — but an anchor alone is not enough: a
 * browser only moves focus to a target that can hold it, so `#content` scrolled into view and
 * left `document.activeElement` on `<body>`, which means the next Tab returns to the nav the
 * user just skipped. Every `<main id="content">` carries `tabIndex={-1}` for that reason: not
 * focusable by Tab, focusable by the link. Measured in a browser, not assumed.
 */
export function SkipLink() {
  const t = useTranslations('common');

  return (
    <a href="#content" className={styles.skipLink}>
      {t('skipToContent')}
    </a>
  );
}
