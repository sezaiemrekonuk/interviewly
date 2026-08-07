'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Meter } from '../shell/meter';
import {
  DEMO_CHOICES,
  DEMO_MAX,
  DEMO_ROLES,
  DEMO_ROUNDS,
  DEMO_SCORES,
  demoOverall,
  type DemoChoice,
  type DemoRole,
  type DemoRound,
  type DemoScore,
} from './demo-content';

import styles from './landing.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

/**
 * Fisher–Yates. Three items, so `sort(() => Math.random() - 0.5)` would put its bias somewhere
 * a visitor could learn — which is the whole thing this is here to prevent.
 */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Characters per second while a question is being asked. Fast enough to read along with. */
const TYPE_MS = 18;

type Phase = 'asking' | 'choosing' | 'scored';

/**
 * One question typing itself out. Not CSS: a steps() animation on a fixed width cannot wrap,
 * and every question here is two lines on a phone. Returns the visible prefix plus whether it
 * has finished, because the answers must not appear until the interviewer has stopped talking.
 */
function useTyped(text: string, enabled: boolean): { shown: string; done: boolean } {
  // Reduced motion gets the whole question at once. The information *is* the question, and
  // withholding it for two seconds is the part someone asked us not to do. Feature-detected
  // rather than assumed: where `matchMedia` is missing the question still has to arrive, so
  // the absent case types rather than throwing.
  const instant =
    !enabled ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Reset during render rather than in an effect. A new question must not paint once at the
  // previous one's length before an effect corrects it, and setState inside an effect body is
  // the cascading-render pattern React asks you not to write.
  const [state, setState] = useState({ text, count: instant ? text.length : 0 });
  if (state.text !== text) setState({ text, count: instant ? text.length : 0 });

  const count = state.text === text ? state.count : 0;

  useEffect(() => {
    if (instant) return;
    const id = window.setInterval(() => {
      // In a timer callback, not the effect body — this is exactly the "subscribe to an
      // external source of updates" case effects exist for.
      setState((prev) => {
        if (prev.text !== text) return prev;
        if (prev.count >= text.length) {
          window.clearInterval(id);
          return prev;
        }
        return { text, count: prev.count + 1 };
      });
    }, TYPE_MS);
    return () => window.clearInterval(id);
  }, [text, instant]);

  return { shown: text.slice(0, count), done: count >= text.length };
}

/**
 * The meters have to start empty and fill, or the scoring is a number that was always there.
 * `<progress>` only transitions when its value *changes*, so the first paint is 0 and the real
 * value lands on the next frame — one rAF, not a timeout, so it is a single frame either way.
 */
function useSettled(key: string): boolean {
  // Same reason as `useTyped`: the reset belongs in render, so a new answer never paints one
  // frame at the previous answer's width before dropping back to zero to animate.
  const [state, setState] = useState({ key, settled: false });
  if (state.key !== key) setState({ key, settled: false });

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setState({ key, settled: true }));
    return () => window.cancelAnimationFrame(id);
  }, [key]);

  return state.key === key && state.settled;
}

function ScorePanel({
  score,
  reason,
  roundKey,
}: {
  score: DemoScore;
  reason: string;
  roundKey: string;
}) {
  const t = useTranslations('landing.demo');
  const settled = useSettled(roundKey);
  const { shown } = useTyped(reason, true);
  // `null` on the technical rounds, where the product returns no STAR figure at all
  // (`DemoScore.star`). No tag, no meter, and nothing about STAR in the spoken verdict.
  const percent = score.star === undefined ? null : Math.round(score.star * 100);
  const typing = shown !== reason;

  return (
    <div className={styles.score} data-testid="demo-score">
      {/* The verdict, announced once as a sentence. Read as marked-up, the figure and the tag
          are "4", "/ 5", "STAR 82%" — three fragments in a row and no statement — so they are
          hidden here and the region carries the sentence instead (WCAG 4.1.3). */}
      <div className={styles.scoreHead} role="status">
        <p className={styles.scoreFigureBlock} aria-hidden="true">
          <span className={cx(styles.scoreFigure, 'tabular')} data-testid="demo-score-overall">
            {score.overall}
          </span>
          <span className={styles.scoreOutOf}>{t('outOf', { max: DEMO_MAX })}</span>
        </p>
        {percent === null ? null : (
          <p className={styles.starTag} aria-hidden="true">
            {t('star', { percent })}
          </p>
        )}
        <span className={styles.srOnly} data-testid="demo-verdict">
          {percent === null
            ? t('verdictPlain', { score: score.overall, max: DEMO_MAX })
            : t('verdict', { score: score.overall, max: DEMO_MAX, percent })}
        </span>
      </div>

      {/* The two measurements the report actually carries per question, drawn. Both bars are
          decorative — the number is beside each one in text, so a score is never readable by
          width alone (DESIGN §6). They fill from zero on the frame after mount, which is the
          measurement arriving rather than a number that was always there. */}
      <dl className={styles.axes}>
        <div className={styles.axis}>
          <dt className={styles.axisLabel}>{t('axes.score')}</dt>
          <dd className={styles.axisValue}>
            <Meter
              value={settled ? score.overall : 0}
              max={DEMO_MAX}
              tone="primary"
              decorative
              className={styles.axisMeter}
            />
            <span className={cx(styles.axisNumber, 'tabular')}>
              {score.overall}
              <span className={styles.axisUnit}>{t('outOf', { max: DEMO_MAX })}</span>
            </span>
          </dd>
        </div>
        {percent === null ? null : (
          <div className={styles.axis}>
            <dt className={styles.axisLabel}>{t('axes.star')}</dt>
            <dd className={styles.axisValue}>
              <Meter
                value={settled ? percent : 0}
                tone="primary"
                decorative
                className={styles.axisMeter}
              />
              <span className={cx(styles.axisNumber, 'tabular')}>{`${percent}%`}</span>
            </dd>
          </div>
        )}
      </dl>

      {/* The criticism is the product; the typing is decoration. Assistive tech gets the whole
          sentence on the frame it exists rather than a prefix that grows under it — the visible
          run is hidden while it types and becomes the accessible copy once it is complete, so
          the finished panel holds the reason exactly once. */}
      <p className={styles.reason} aria-hidden={typing || undefined}>
        {shown}
      </p>
      {typing ? <p className={styles.srOnly}>{reason}</p> : null}
    </div>
  );
}

/**
 * The landing's spine, and the argument the rest of the page only annotates: two interviewers,
 * two rounds, two jobs. The visitor sits in the chair before they have an account — Ada asks,
 * they answer, the meters fill where the answers were, the written criticism types out, and then
 * Turing takes over and the same machinery probes something else entirely.
 *
 * No network. Every question, answer and reason here is authored sample material carried in
 * `messages/*`; the scores are in `demo-content.ts`. Nothing on this surface calls the API, so
 * the anonymous landing keeps its zero-React-Query budget (§8.1, `app/page.test.tsx`).
 */
export function DemoInterview() {
  const t = useTranslations('landing.demo');

  const [role, setRole] = useState<DemoRole>('frontend');
  const [round, setRound] = useState<DemoRound>('hr');
  const [picked, setPicked] = useState<{ hr: DemoChoice | null; tech: DemoChoice | null }>({
    hr: null,
    tech: null,
  });

  // One draw per question, made once per mount. `a` is the strong answer in every set
  // (`demo-content.ts`), so a fixed order taught "first is right" inside a single round and
  // handed the second one over before Turing had asked it — hence per question rather than one
  // order for the whole demo. Not in an effect and not per render: nothing below renders until
  // the interviewer has finished typing, which is well after hydration, so the server's HTML
  // has no answer list for this to disagree with.
  const [orders] = useState<Record<string, DemoChoice[]>>(() =>
    Object.fromEntries(
      DEMO_ROLES.flatMap((key) =>
        DEMO_ROUNDS.map((each) => [`${key}.${each}`, shuffled(DEMO_CHOICES)]),
      ),
    ),
  );

  const roundRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const choice = picked[round];
  const phase: Phase = choice ? 'scored' : 'asking';

  const question = t(`roles.${role}.${round}.question`);
  const { shown: shownQuestion, done: asked } = useTyped(question, phase === 'asking');

  // The button that was just pressed unmounts with the answer list, and focus falls back to
  // <body> — a keyboard user's next Tab restarts at the top of the page, three viewports above
  // the panel that just appeared (WCAG 2.4.3). It goes to the result instead.
  useEffect(() => {
    if (choice) resultRef.current?.focus();
  }, [choice]);

  const reset = useCallback((next: DemoRole) => {
    setRole(next);
    setRound('hr');
    setPicked({ hr: null, tech: null });
  }, []);

  const bothAnswered = picked.hr !== null && picked.tech !== null;

  // Moving to the technical round swaps the whole panel; without this the visitor is left
  // looking at a report they have not scrolled to while Turing asks above them.
  function toTech() {
    setRound('tech');
    // Feature-detected: jsdom has no scrollIntoView, and a missing scroll must not take the
    // round change down with it — the state is the point, the scroll is the courtesy.
    roundRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  const interviewer = round === 'hr' ? t('ada') : t('turing');
  const roleLabel = round === 'hr' ? t('roleHr') : t('roleTech');

  return (
    <section className={styles.demo} aria-labelledby="demo-title" data-testid="demo-interview">
      <div className={styles.demoIntro}>
        {/* The section needs a name for the landmark; it does not need a second headline
            eighty pixels under the first one. The hero already said this. */}
        <h2 id="demo-title" className={styles.srOnly}>
          {t('title')}
        </h2>

        <fieldset className={styles.roles}>
          <legend className={styles.rolesLegend}>{t('rolePrompt')}</legend>
          {DEMO_ROLES.map((key) => (
            <button
              key={key}
              type="button"
              className={cx(styles.roleChip, key === role && styles.roleChipOn)}
              aria-pressed={key === role}
              onClick={() => reset(key)}
            >
              {t(`roles.${key}.label`)}
            </button>
          ))}
        </fieldset>

        {/* The listing is the mechanism: these questions exist because of this line, and the
            real thing reads yours. Stated here rather than in a caption three sections down. */}
        <p className={styles.listing}>
          <span className={styles.listingLabel}>{t('fromListing')}</span>
          <span className={styles.listingText}>{t(`roles.${role}.listing`)}</span>
        </p>
      </div>

      {/* The rail's material, because this is the room. Two tiles, one lit — told apart by the
          name and the word under it, never by colour alone. `--live` stays in the room. */}
      <div className={styles.stage} ref={roundRef}>
        <div className={styles.tiles}>
          {(['hr', 'tech'] as const).map((key) => {
            const on = key === round;
            return (
              <div
                key={key}
                className={cx(styles.tile, on && styles.tileOn)}
                data-testid={`demo-tile-${key}`}
                data-floor={on ? 'true' : 'false'}
              >
                <span className={styles.tileName}>{key === 'hr' ? t('ada') : t('turing')}</span>
                <span className={styles.tileRole}>
                  {key === 'hr' ? t('roleHr') : t('roleTech')}
                </span>
                {/* Moving only while this interviewer is actually mid-sentence. Bars that go
                    on dancing after the question has landed say "someone is talking" when
                    nobody is, which is wrong as a metaphor before it is wrong as motion. */}
                <span
                  className={cx(
                    styles.wave,
                    !on && styles.waveOff,
                    on && !asked && styles.waveSpeaking,
                  )}
                  aria-hidden="true"
                >
                  {Array.from({ length: 14 }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
                <span className={styles.tileState}>
                  {on ? t('hasFloor') : picked[key] ? t('roundDone') : t('roundWaiting')}
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.turn}>
          <p className={styles.asking}>
            {t('asks', { name: interviewer, role: roleLabel })}
          </p>
          <p className={styles.question} data-testid="demo-question">
            {shownQuestion}
            {!asked ? <span className={styles.caret} aria-hidden="true" /> : null}
          </p>
          {/* Announced once, when the interviewer has finished — not per character. */}
          <p className={styles.srOnly} role="status">
            {asked ? question : ''}
          </p>

          {/* The candidate's side, inside the room rather than under it: the exchange is one
              object. Light buttons on the dark ground, because your half of an interview is
              not made of the same material as theirs.
              Unlabelled on purpose — the visitor picks the answer they would actually give and
              finds out what it is worth. A "strong / weak" tag would give the demonstration
              away before it ran. */}
          {phase === 'asking' && asked ? (
            <div className={styles.answers} data-testid="demo-answers">
              <p className={styles.answersPrompt}>{t('yourTurn')}</p>
              <ul className={styles.answerList}>
                {orders[`${role}.${round}`].map((key, index) => (
                  <li key={key}>
                    <button
                      type="button"
                      className={cx(styles.answerButton, styles[`answerIn${index}`])}
                      onClick={() => setPicked((prev) => ({ ...prev, [round]: key }))}
                    >
                      {t(`roles.${role}.${round}.answers.${key}`)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* The marking happens where the answering happened: the chosen answer and its score
              take the answer list's place, inside the room, against the same dark ground. Both
              are `--surface` cards for the same reason the answer buttons are — your half of an
              interview is not made of the same material as theirs.

              This used to render below the stage, on the light document. It left the room a
              flat navy rectangle with a question stranded at the top of it, and put the written
              reason — the thing the product is actually selling — under the fold on a 900px
              screen. Nothing below the stage now but the assembled report. */}
          {choice ? (
            <>
              <div
                className={styles.result}
                data-testid="demo-result"
                ref={resultRef}
                tabIndex={-1}
              >
                <blockquote className={styles.chosen}>
                  <p className={styles.chosenLabel}>{t('youAnswered')}</p>
                  <p className={styles.chosenText}>
                    {t(`roles.${role}.${round}.answers.${choice}`)}
                  </p>
                </blockquote>

                <ScorePanel
                  score={DEMO_SCORES[role][round][choice]}
                  reason={t(`roles.${role}.${round}.reasons.${choice}`)}
                  roundKey={`${role}-${round}-${choice}`}
                />
              </div>

              {/* The visitor who picked the weak answer is the one this demo exists for, and
                  until now the only thing offered to them was Turing. The other two answers to
                  *this* question are one press away; the whole-demo replay stays on the report
                  where it belongs. */}
              <div className={styles.advanceRow}>
                <p className={styles.marked}>{t('marked')}</p>
                <button
                  type="button"
                  className={styles.retry}
                  onClick={() => setPicked((prev) => ({ ...prev, [round]: null }))}
                >
                  {t('tryAgain')}
                </button>
                {round === 'hr' ? (
                  <button type="button" className={styles.advance} onClick={toTech}>
                    {t('nextRound', { name: t('turing') })}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* The two rounds converge. This is the product's actual output shape — an overall, a
          per-round split, and the criticism — rendered from the two answers they just gave. */}
      {bothAnswered ? (
        <div className={styles.reportCard} data-testid="demo-report">
          <div className={styles.reportHead}>
            <h3 className={styles.reportTitle}>{t('report.title')}</h3>
            <p className={styles.reportMeta}>{t('report.meta', { count: 2 })}</p>
          </div>

          <div className={styles.reportBody}>
            <p className={styles.reportFigureBlock}>
              <span className={cx(styles.reportFigure, 'tabular')} data-testid="demo-report-overall">
                {demoOverall(
                  DEMO_SCORES[role].hr[picked.hr as DemoChoice],
                  DEMO_SCORES[role].tech[picked.tech as DemoChoice],
                )}
              </span>
              <span className={styles.reportOutOf}>{t('outOf', { max: DEMO_MAX })}</span>
            </p>

            <dl className={styles.reportRounds}>
              {(['hr', 'tech'] as const).map((key) => {
                const value = DEMO_SCORES[role][key][picked[key] as DemoChoice].overall;
                return (
                  <div key={key} className={styles.reportRound}>
                    <dt className={styles.reportRoundLabel}>
                      {key === 'hr' ? t('roleHr') : t('roleTech')}
                    </dt>
                    <dd className={styles.reportRoundValue}>
                      <Meter value={value} max={DEMO_MAX} tone="primary" decorative />
                      <span className={cx(styles.axisNumber, 'tabular')}>{value}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>

          <p className={styles.reportClose}>{t('report.close')}</p>

          <div className={styles.reportActions}>
            <Link href="/register" className={styles.reportCta}>
              {t('report.cta')}
            </Link>
            <button type="button" className={styles.replay} onClick={() => reset(role)}>
              {t('report.replay')}
            </button>
          </div>
        </div>
      ) : null}

      <p className={styles.sampleNote}>{t('sampleNote')}</p>
    </section>
  );
}
