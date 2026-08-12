'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Link } from '../../i18n/navigation';
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
import { Peep, type PeepMood } from './peeps';

import styles from './handover.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

const TYPE_MS = 18;

const PASS_MARK = 60;

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function useTyped(text: string, enabled: boolean): { shown: string; pending: string; done: boolean } {
  const instant =
    !enabled ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const [state, setState] = useState({ text, count: instant ? text.length : 0 });
  if (state.text !== text) setState({ text, count: instant ? text.length : 0 });

  const count = state.text === text ? state.count : 0;

  useEffect(() => {
    if (instant) return;
    const id = window.setInterval(() => {
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

  return {
    shown: text.slice(0, count),
    pending: text.slice(count),
    done: count >= text.length,
  };
}

function useSettled(key: string): boolean {
  const [state, setState] = useState({ key, settled: false });
  if (state.key !== key) setState({ key, settled: false });

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setState({ key, settled: true }));
    return () => window.cancelAnimationFrame(id);
  }, [key]);

  return state.key === key && state.settled;
}

function moodFor({
  mine,
  round,
  asked,
  score,
}: {
  mine: DemoRound;
  round: DemoRound;
  asked: boolean;
  score: DemoScore | null;
}): PeepMood {
  if (mine !== round) return score ? 'idle' : 'listening';
  if (score) return score.overall >= PASS_MARK ? 'pleased' : 'unconvinced';
  return asked ? 'listening' : 'asking';
}

function CastTile({
  round,
  mine,
  asked,
  score,
  answered,
}: {
  round: DemoRound;
  mine: DemoRound;
  asked: boolean;
  score: DemoScore | null;
  answered: boolean;
}) {
  const t = useTranslations('landing.demo');
  const on = mine === round;
  const name = mine === 'hr' ? t('ada') : t('turing');

  return (
    <div
      className={cx(styles.tile, on && styles.tileOn)}
      data-testid={`demo-tile-${mine}`}
      data-floor={on ? 'true' : 'false'}
    >
      <div className={styles.tilePortrait}>
        <Peep name={mine === 'hr' ? 'ada' : 'turing'} mood={moodFor({ mine, round, asked, score })} />
      </div>
      <div className={styles.tileMeta}>
        <span className={styles.tileName}>{name}</span>
        <span className={styles.tileRole}>{mine === 'hr' ? t('roleHr') : t('roleTech')}</span>
        {on && !asked ? (
          <span className={styles.wave} aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        ) : null}
        <span className={styles.tileState}>
          {on ? t('hasFloor') : answered ? t('roundDone') : t('roundWaiting')}
        </span>
      </div>
    </div>
  );
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
  const { shown, pending } = useTyped(reason, true);
  const percent = score.star === undefined ? null : Math.round(score.star * 100);
  const typing = shown !== reason;

  return (
    <div className={styles.score} data-testid="demo-score">
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

      <p className={styles.reason} aria-hidden={typing || undefined}>
        {shown}
        <span className={styles.pending} aria-hidden="true">
          {pending}
        </span>
      </p>
      {typing ? <p className={styles.srOnly}>{reason}</p> : null}
    </div>
  );
}

export function Handover() {
  const t = useTranslations('landing');
  const d = useTranslations('landing.demo');

  const [role, setRole] = useState<DemoRole>('frontend');
  const [round, setRound] = useState<DemoRound>('hr');
  const [picked, setPicked] = useState<{ hr: DemoChoice | null; tech: DemoChoice | null }>({
    hr: null,
    tech: null,
  });

  const [orders, setOrders] = useState<Record<string, DemoChoice[]>>(() =>
    Object.fromEntries(
      DEMO_ROLES.flatMap((key) => DEMO_ROUNDS.map((each) => [`${key}.${each}`, [...DEMO_CHOICES]])),
    ),
  );
  useEffect(() => {
    const id = window.requestAnimationFrame(() =>
      setOrders(
        Object.fromEntries(
          DEMO_ROLES.flatMap((key) =>
            DEMO_ROUNDS.map((each) => [`${key}.${each}`, shuffled(DEMO_CHOICES)]),
          ),
        ),
      ),
    );
    return () => window.cancelAnimationFrame(id);
  }, []);

  const exchangeRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const choice = picked[round];
  const question = d(`roles.${role}.${round}.question`);
  const { shown: shownQuestion, pending: pendingQuestion, done: asked } = useTyped(
    question,
    !choice,
  );

  useEffect(() => {
    if (choice) resultRef.current?.focus();
  }, [choice]);

  const reset = useCallback((next: DemoRole) => {
    setRole(next);
    setRound('hr');
    setPicked({ hr: null, tech: null });
  }, []);

  const bothAnswered = picked.hr !== null && picked.tech !== null;

  function toTech() {
    setRound('tech');
    exchangeRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  const interviewer = round === 'hr' ? d('ada') : d('turing');
  const roleLabel = round === 'hr' ? d('roleHr') : d('roleTech');
  const scoreOf = (key: DemoRound) => {
    const answer = picked[key];
    return answer ? DEMO_SCORES[role][key][answer] : null;
  };

  return (
    <section
      id="demo"
      className={styles.night}
      data-round={round}
      data-testid="demo-interview"
      aria-labelledby="landing-title"
    >
      <div className={styles.inner}>
        <div className={styles.act}>
          <div className={styles.lede}>
            <h1 id="landing-title" className={styles.title}>
              {t('hero')}
            </h1>
            <p className={styles.subhead}>{t('subhead')}</p>
            <Link href="/register" className={styles.cta}>
              {t('cta')}
            </Link>
          </div>

          <div className={styles.sheet}>
            <fieldset className={styles.roles}>
              <legend className={styles.rolesLegend}>{d('rolePrompt')}</legend>
              {DEMO_ROLES.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={cx(styles.roleChip, key === role && styles.roleChipOn)}
                  aria-pressed={key === role}
                  onClick={() => reset(key)}
                >
                  {d(`roles.${key}.label`)}
                </button>
              ))}
            </fieldset>
            <p className={styles.listing}>
              <span className={styles.listingLabel}>{d('fromListing')}</span>
              <span className={styles.listingText}>{d(`roles.${role}.listing`)}</span>
            </p>
          </div>

          <div className={styles.exchange} ref={exchangeRef}>
            <span className={styles.seam} key={round} aria-hidden="true" />
            <p className={styles.asking}>{d('asks', { name: interviewer, role: roleLabel })}</p>
            <p className={styles.question}>
              <span data-testid="demo-question">
                {shownQuestion}
                <span className={cx(styles.caret, asked && styles.pending)} aria-hidden="true" />
              </span>
              <span className={styles.pending} aria-hidden="true">
                {pendingQuestion}
              </span>
            </p>
            <p className={styles.srOnly} role="status">
              {asked ? question : ''}
            </p>

            {choice ? null : (
              <div
                className={cx(styles.answers, !asked && styles.pending)}
                data-testid="demo-answers"
                aria-hidden={!asked || undefined}
              >
                <p className={styles.answersPrompt}>{d('yourTurn')}</p>
                <ul className={styles.answerList}>
                  {orders[`${role}.${round}`].map((key, index) => (
                    <li key={key}>
                      <button
                        type="button"
                        className={cx(styles.answerButton, styles[`answerIn${index}`])}
                        onClick={() => setPicked((prev) => ({ ...prev, [round]: key }))}
                      >
                        {d(`roles.${role}.${round}.answers.${key}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {choice ? (
              <>
                <div className={styles.result} data-testid="demo-result" ref={resultRef} tabIndex={-1}>
                  <blockquote className={styles.chosen}>
                    <p className={styles.chosenLabel}>{d('youAnswered')}</p>
                    <p className={styles.chosenText}>
                      {d(`roles.${role}.${round}.answers.${choice}`)}
                    </p>
                  </blockquote>

                  <ScorePanel
                    score={DEMO_SCORES[role][round][choice]}
                    reason={d(`roles.${role}.${round}.reasons.${choice}`)}
                    roundKey={`${role}-${round}-${choice}`}
                  />
                </div>

                <div className={styles.advanceRow}>
                  <p className={styles.marked}>{d('marked')}</p>
                  <button
                    type="button"
                    className={styles.retry}
                    onClick={() => setPicked((prev) => ({ ...prev, [round]: null }))}
                  >
                    {d('tryAgain')}
                  </button>
                  {round === 'hr' ? (
                    <button type="button" className={styles.advance} onClick={toTech}>
                      {d('nextRound', { name: d('turing') })}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          {bothAnswered ? (
            <div className={styles.reportCard} data-testid="demo-report">
              <div className={styles.reportHead}>
                <h2 className={styles.reportTitle}>{d('report.title')}</h2>
                <p className={styles.reportMeta}>{d('report.meta', { count: 2 })}</p>
              </div>

              <div className={styles.reportBody}>
                <p className={styles.reportFigureBlock}>
                  <span
                    className={cx(styles.reportFigure, 'tabular')}
                    data-testid="demo-report-overall"
                  >
                    {demoOverall(
                      DEMO_SCORES[role].hr[picked.hr as DemoChoice],
                      DEMO_SCORES[role].tech[picked.tech as DemoChoice],
                    )}
                  </span>
                  <span className={styles.reportOutOf}>{d('outOf', { max: DEMO_MAX })}</span>
                </p>

                <dl className={styles.reportRounds}>
                  {DEMO_ROUNDS.map((key) => {
                    const value = DEMO_SCORES[role][key][picked[key] as DemoChoice].overall;
                    return (
                      <div key={key} className={styles.reportRound}>
                        <dt className={styles.reportRoundLabel}>
                          {key === 'hr' ? d('roleHr') : d('roleTech')}
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

              <p className={styles.reportClose}>{d('report.close')}</p>

              <div className={styles.reportActions}>
                <Link href="/register" className={styles.reportCta}>
                  {d('report.cta')}
                </Link>
                <button type="button" className={styles.replay} onClick={() => reset(role)}>
                  {d('report.replay')}
                </button>
              </div>
            </div>
          ) : null}

          <p className={styles.sampleNote}>{d('sampleNote')}</p>
        </div>

        <aside className={styles.cast} aria-hidden="true">
          <div className={styles.castTiles}>
            {DEMO_ROUNDS.map((key) => (
              <CastTile
                key={key}
                mine={key}
                round={round}
                asked={asked}
                score={scoreOf(key)}
                answered={picked[key] !== null}
              />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
