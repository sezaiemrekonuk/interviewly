'use client';

import { useTranslations } from 'next-intl';

import type { TranscriptTurn } from '../room/transcript';
import { Meter } from '../shell/meter';
import type { ReportPayload, RoomMessage } from '../../lib/query';
import { SCORE_MAX } from '../../lib/score';

import { EARLY_END_REASONS, EndedReasonLine } from './ended-reason';
import { exchangesFor, type Exchange } from './exchanges';

import styles from './report.module.css';

/**
 * The scored read-back: nothing here is computed, every number is `reports.payload` as the
 * model produced it and the K15 gate accepted it.
 *
 * One reading column on the working surface — the verdict, then the rounds, then what worked
 * and what to work on, then the question rows. The headline score and the PDF are the rail's
 * (`report-rail.tsx`), so this column starts on the sentence rather than on the number.
 */
export function ReportView({
  payload,
  endedReason,
  turns,
  messages,
}: {
  payload: ReportPayload;
  endedReason: string | null;
  turns: TranscriptTurn[];
  messages: RoomMessage[];
}) {
  const t = useTranslations('report');
  const isEarlyEnd = endedReason !== null && EARLY_END_REASONS.has(endedReason);
  // Per-question rows key off the transcript, so a model-invented `question_id` renders
  // nothing rather than a scored row with no question attached to it. The turn also carries
  // `roundType`, which is what tells a technical row that STAR does not apply to it.
  const turnFor = new Map(turns.map((turn) => [turn.questionId, turn]));
  // The conversation, split back into the exchanges it was actually made of. `turn.answer` is
  // every utterance for a question joined into one string (`answerWindow`, conductor.ts), so a
  // question that was clarified twice reads as one run-on answer to a question that was never
  // shown being re-asked. The messages carry the same content already separated by who said it.
  const exchangeFor = exchangesFor(messages);
  const rows = payload.questions.flatMap((question) => {
    const turn = turnFor.get(question.question_id);
    return turn
      ? [{ question, turn, exchanges: exchangeFor.get(question.question_id) ?? [] }]
      : [];
  });

  return (
    <div className={styles.report} data-testid="report-view">
      {isEarlyEnd ? (
        <div role="status" className={styles.earlyEnd} data-testid="report-early-end">
          <p className={styles.earlyEndText}>{t('earlyEnd')}</p>
          <EndedReasonLine endedReason={endedReason} className={styles.earlyEndText} />
        </div>
      ) : null}

      <p className={styles.impression}>{payload.overall_impression}</p>

      {/* Each block renders only when the model had something to put in it. An interview that
          was stopped after one question legitimately produces no strengths — the payload
          schema stopped demanding two once that was costing the candidate their whole report —
          and a heading over an empty list reads as a rendering fault rather than as an honest
          "there was not enough here to say". */}
      {payload.rounds.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('roundsTitle')}</h2>
          <ul className={styles.rows}>
            {payload.rounds.map((round, idx) => (
              <li key={`${round.type}-${idx}`} className={styles.row}>
                <h3 className={styles.rowTitle}>
                  {t(round.type === 'hr' ? 'roundHr' : 'roundTech')}
                </h3>
                <span className={`${styles.rowScore} tabular`}>
                  {t('scoreValue', { score: round.score, max: SCORE_MAX })}
                </span>
                {/* Decorative: the score sits on the same line, in text. */}
                <Meter className={styles.rowMeter} value={round.score} max={SCORE_MAX} decorative />
                <p className={styles.rowBody}>{round.summary}</p>
                {round.note ? <p className={styles.rowNote}>{round.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Two plain lists, not two tinted walls: on a result surface a green box and an orange
          box next to each other read as pass and fail, which is not what these are. */}
      {payload.strengths.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('strengths')}</h2>
          <ul className={styles.bullets}>
            {payload.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {payload.improvements.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('improvements')}</h2>
          <ul className={styles.bullets}>
            {payload.improvements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('questionsTitle')}</h2>
        <ul className={styles.rows} data-testid="report-questions">
          {rows.map(({ question, turn, exchanges }) => (
            <li key={question.question_id} className={styles.row}>
              <p className={styles.questionText}>{turn.question}</p>
              <span className={`${styles.rowScore} tabular`}>
                {t('scoreValue', { score: question.score, max: SCORE_MAX })}
              </span>
              <Meter className={styles.rowMeter} value={question.score} max={SCORE_MAX} decorative />
              <p className={styles.rowBody}>{question.reason}</p>
              <QuestionExchange exchanges={exchanges} fallbackAnswer={turn.answer} />
              {/* STAR is a behavioural-story rubric. The scorer returns 0 for a technical
                  answer because none applies, not because the answer failed — printed as
                  "STAR 0%" under an 80 it reads as broken scoring. The round comes off the
                  transcript turn, which every rendered row already has. */}
              {turn.roundType === 'tech' ? (
                <p className={styles.star}>{t('starNotApplicable')}</p>
              ) : (
                <p className={`${styles.star} tabular`}>
                  {t('star', { percent: Math.round(question.star_adherence * 100) })}
                </p>
              )}
            </li>
          ))}
        </ul>

        {/* What those two words mean, once under the list rather than repeated on every row —
            and only when a technical row is on screen to explain. Same sentence as the
            archive's table (`components/interviews/question-table.tsx`). */}
        {rows.some(({ turn }) => turn.roundType === 'tech') ? (
          <p className={styles.starNote}>{t('starNote')}</p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * What was actually said on one question: the question and its answer, then a labelled box per
 * clarification. One box per exchange rather than one block of joined text — the answer to
 * "can you say how you measured that?" is not more of the answer to the original question, and
 * printing them as one paragraph made a candidate who was asked twice look like one who
 * rambled once.
 *
 * The first exchange is the question itself, so it is labelled as such and the clarifications
 * count from one. `fallbackAnswer` covers an interview with no conversation rows behind it —
 * a pre-conductor run, or one answered through `POST /answers` — where the joined answer is
 * genuinely all there is.
 */
function QuestionExchange({
  exchanges,
  fallbackAnswer,
}: {
  exchanges: Exchange[];
  fallbackAnswer: string;
}) {
  const t = useTranslations('report');

  if (exchanges.length === 0) {
    return (
      <div className={styles.exchange}>
        <div className={styles.exchangeBox}>
          <p className={styles.exchangeLabel}>{t('answerLabel')}</p>
          <p className={styles.exchangeAnswer}>{fallbackAnswer}</p>
        </div>
      </div>
    );
  }

  return (
    <ol className={styles.exchange} data-testid="report-exchange">
      {exchanges.map((exchange, index) => (
        <li key={index} className={styles.exchangeBox}>
          <p className={styles.exchangeLabel}>
            {index === 0 ? t('questionLabel') : t('clarificationLabel', { n: index })}
          </p>
          {exchange.ask ? <p className={styles.exchangeAsk}>{exchange.ask}</p> : null}
          {exchange.answer ? (
            <p className={styles.exchangeAnswer}>{exchange.answer}</p>
          ) : (
            <p className={styles.exchangeUnanswered}>{t('exchangeUnanswered')}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
