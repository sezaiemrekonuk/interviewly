'use client';

/**
 * The three profile cards' *bodies*, and the CV control beside them — the fields themselves,
 * with no opinion about what surrounds them.
 *
 * They exist because two screens render the same cards: onboarding collects them once
 * (`app/(onboarding)/onboarding/[step]`) and `/profile` edits them forever (issue 75). Copies
 * of a form drift, and a label that says one thing during onboarding and another on the profile
 * screen is the same defect as a missing translation. The copy lives in the `fields` namespace,
 * once, and both screens read it from here.
 *
 * Layout stays with the caller: onboarding stacks these in a 480px entry card, `/profile` puts
 * them in a tab panel on flat ground. Only the field stack is shared.
 */

import { useFormatter, useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';

import type { CvUpload } from '../../lib/query';
import { Button, Field, FileInput, Input, Textarea } from '../ui';

import {
  EMPTY_ROW,
  MAX_EDUCATION_ROWS,
  entryProblem,
  type EducationDraft,
  type EntryProblem,
} from './education-draft';
import styles from './profile-fields.module.css';

// --------------------------------------------------------------------------- card 1

export interface IdentityValues {
  fullName?: string;
  jobTitle?: string;
  phone?: string;
  dateOfBirth?: string;
}

export interface IdentityFieldsProps {
  values: IdentityValues;
  onChange: (patch: IdentityValues) => void;
  /**
   * Show the contact fields. Onboarding asks for a name and a title and gets out of the way;
   * the profile screen is where an account's details actually live.
   */
  extended?: boolean;
}

export function IdentityFields({ values, onChange, extended = false }: IdentityFieldsProps) {
  const t = useTranslations('fields');

  return (
    <div className={styles.stack}>
      <Field label={t('fullNameLabel')} id="fullName">
        {(control) => (
          <Input
            {...control}
            autoComplete="name"
            value={values.fullName ?? ''}
            onChange={(event) => onChange({ fullName: event.target.value })}
          />
        )}
      </Field>

      <Field label={t('jobTitleLabel')} id="jobTitle">
        {(control) => (
          <Input
            {...control}
            autoComplete="organization-title"
            value={values.jobTitle ?? ''}
            onChange={(event) => onChange({ jobTitle: event.target.value })}
          />
        )}
      </Field>

      {extended ? (
        <>
          <Field label={t('phoneLabel')} id="phone" hint={t('phoneHint')}>
            {(control) => (
              <Input
                {...control}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={values.phone ?? ''}
                onChange={(event) => onChange({ phone: event.target.value })}
              />
            )}
          </Field>

          {/* K8.7 non-negotiable: say what we do with the date of birth we collect. The hint is
              the whole answer — it stays on the account and `interview/profile.ts` strips it
              before anything reaches the model. */}
          <Field label={t('dateOfBirthLabel')} id="dateOfBirth" hint={t('dateOfBirthHint')}>
            {(control) => (
              <Input
                {...control}
                type="date"
                autoComplete="bday"
                value={values.dateOfBirth ?? ''}
                onChange={(event) => onChange({ dateOfBirth: event.target.value })}
              />
            )}
          </Field>
        </>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- card 2

export interface EducationFieldsProps {
  rows: EducationDraft[];
  onChange: (rows: EducationDraft[]) => void;
  /**
   * The new list, whenever an entry is confirmed or removed. A screen that persists per entry
   * (`/profile`) saves here; onboarding leaves it out and lets Continue carry the whole card.
   */
  onCommit?: (rows: EducationDraft[]) => void;
  /** A resolved message from the last commit. The caller looks the code up. */
  error?: string | null;
  /** True while a commit is in flight. */
  saving?: boolean;
}

/** `2015 – 2019`, `2019`, `2015 – `, or nothing. An en dash only when it separates something. */
function yearRange(row: EducationDraft): string | null {
  if (row.startYear && row.endYear) return `${row.startYear} – ${row.endYear}`;
  if (row.endYear) return row.endYear;
  if (row.startYear) return `${row.startYear} –`;
  return null;
}

/** `BSc, Mathematics` — either half may be missing, and the comma goes with it. */
function qualification(row: EducationDraft): string | null {
  return [row.degree, row.field].filter(Boolean).join(', ') || null;
}

/**
 * Education as a list of entries you add, edit and remove — the shape every profile product
 * settles on, because education *is* a list and four permanently-open inputs per entry is a
 * form pretending to be one.
 *
 * The saved entries read as cards; one entry form is open at a time, over the card being
 * edited or under the list when adding. School is the only required field.
 */
export function EducationFields({
  rows,
  onChange,
  onCommit,
  error = null,
  saving = false,
}: EducationFieldsProps) {
  const t = useTranslations('fields');
  /** Which entry the form is open over: an index, `'new'`, or closed. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<EducationDraft>(EMPTY_ROW);
  const [formError, setFormError] = useState<EntryProblem | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  function openNew() {
    setDraft(EMPTY_ROW);
    setFormError(null);
    setRemoving(null);
    setEditing('new');
  }

  function openEdit(index: number) {
    setDraft(rows[index]);
    setFormError(null);
    setRemoving(null);
    setEditing(index);
  }

  function close() {
    setEditing(null);
    setFormError(null);
  }

  function commit(next: EducationDraft[]) {
    onChange(next);
    onCommit?.(next);
  }

  function saveEntry() {
    const problem = entryProblem(draft);
    if (problem) {
      setFormError(problem);
      return;
    }
    const next =
      editing === 'new' ? [...rows, draft] : rows.map((row, i) => (i === editing ? draft : row));
    close();
    commit(next);
  }

  function removeEntry(index: number) {
    setRemoving(null);
    if (editing === index) close();
    commit(rows.filter((_, i) => i !== index));
  }

  const form = (
    <div className={styles.entryForm}>
      <div className={styles.entryGrid}>
        <Field label={t('schoolLabel')} required>
          {(control) => (
            <Input
              {...control}
              autoFocus
              value={draft.school}
              onChange={(event) => setDraft({ ...draft, school: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('degreeLabel')}>
          {(control) => (
            <Input
              {...control}
              value={draft.degree}
              onChange={(event) => setDraft({ ...draft, degree: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('fieldLabel')}>
          {(control) => (
            <Input
              {...control}
              value={draft.field}
              onChange={(event) => setDraft({ ...draft, field: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('gradeLabel')}>
          {(control) => (
            <Input
              {...control}
              maxLength={100}
              value={draft.grade}
              onChange={(event) => setDraft({ ...draft, grade: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('startYearLabel')}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              maxLength={4}
              value={draft.startYear}
              onChange={(event) => setDraft({ ...draft, startYear: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('endYearLabel')} hint={t('endYearHint')}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              maxLength={4}
              value={draft.endYear}
              onChange={(event) => setDraft({ ...draft, endYear: event.target.value })}
            />
          )}
        </Field>
      </div>

      <Field label={t('activitiesLabel')} hint={t('activitiesHint')}>
        {(control) => (
          <Textarea
            {...control}
            maxLength={1_000}
            className={styles.activities}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        )}
      </Field>

      {formError ? (
        <p className={styles.formError} role="alert">
          {t(
            formError === 'school'
              ? 'educationSchoolRequired'
              : formError === 'order'
                ? 'educationYearOrder'
                : 'educationYear',
          )}
        </p>
      ) : null}

      <div className={styles.entryActions}>
        <Button variant="secondary" size="md" onClick={close}>
          {t('entryCancel')}
        </Button>
        <Button size="md" loading={saving} onClick={saveEntry}>
          {t('entrySave')}
        </Button>
      </div>
    </div>
  );

  return (
    <div className={styles.stack}>
      {rows.length === 0 && editing !== 'new' ? (
        <p className={styles.note}>{t('educationEmpty')}</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className={styles.entryList}>
          {rows.map((row, index) => (
            <li key={index} className={styles.entryCard}>
              {editing === index ? (
                form
              ) : (
                <>
                  <div className={styles.entryText}>
                    <p className={styles.entrySchool}>{row.school}</p>
                    {qualification(row) ? (
                      <p className={styles.entryMeta}>{qualification(row)}</p>
                    ) : null}
                    {yearRange(row) ? <p className={styles.entryYears}>{yearRange(row)}</p> : null}
                    {row.grade ? (
                      <p className={styles.entryYears}>{t('gradeValue', { grade: row.grade })}</p>
                    ) : null}
                    {row.description ? (
                      <p className={styles.entryDescription}>{row.description}</p>
                    ) : null}
                  </div>

                  {removing === index ? (
                    <div className={styles.entryConfirm}>
                      <span className={styles.entryConfirmQuestion}>{t('removeEntryConfirm')}</span>
                      <button
                        type="button"
                        className={styles.entryDanger}
                        onClick={() => removeEntry(index)}
                      >
                        {t('removeEntryAction')}
                      </button>
                      <button
                        type="button"
                        className={styles.entryQuiet}
                        onClick={() => setRemoving(null)}
                      >
                        {t('entryCancel')}
                      </button>
                    </div>
                  ) : (
                    <div className={styles.entryTools}>
                      <button
                        type="button"
                        className={styles.entryQuiet}
                        aria-label={t('editEntryLabel', { school: row.school })}
                        onClick={() => openEdit(index)}
                      >
                        {t('editEntry')}
                      </button>
                      <button
                        type="button"
                        className={styles.entryQuiet}
                        aria-label={t('removeEntryLabel', { school: row.school })}
                        onClick={() => setRemoving(index)}
                      >
                        {t('removeEntry')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {editing === 'new' ? <div className={styles.entryCard}>{form}</div> : null}

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      {editing === null ? (
        rows.length < MAX_EDUCATION_ROWS ? (
          <Button variant="ghost" size="lg" className={styles.addRow} onClick={openNew}>
            {t('addEducationRow')}
          </Button>
        ) : (
          <p className={styles.note}>{t('educationFull', { max: MAX_EDUCATION_ROWS })}</p>
        )
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- card 3

export interface InterestsValues {
  hobbies?: string[];
  interestsText?: string;
}

export interface InterestsFieldsProps {
  values: InterestsValues;
  onChange: (patch: InterestsValues) => void;
  /** Show the hobby chips. Onboarding asks the open question only; the profile keeps both. */
  extended?: boolean;
}

const MAX_HOBBIES = 20;

export function InterestsFields({ values, onChange, extended = false }: InterestsFieldsProps) {
  const t = useTranslations('fields');
  const [pending, setPending] = useState('');
  const hobbies = values.hobbies ?? [];

  function addHobby() {
    const hobby = pending.trim();
    // Silent on a duplicate rather than an error: the chip the user wanted is already there,
    // which is not a problem to report.
    if (!hobby || hobbies.length >= MAX_HOBBIES || hobbies.includes(hobby)) {
      setPending('');
      return;
    }
    onChange({ hobbies: [...hobbies, hobby] });
    setPending('');
  }

  function onPendingKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    // The chip input sits inside a card that saves on its own button; Enter must add a hobby,
    // never submit whatever form the caller wrapped this in.
    event.preventDefault();
    addHobby();
  }

  return (
    <div className={styles.stack}>
      {extended ? (
        // The chips sit outside the `Field` on purpose: the hint explains how to *add* one, so
        // it belongs directly under the input, not below the list the input has been filling.
        <div className={styles.hobbies}>
          <Field label={t('hobbiesLabel')} id="hobby" hint={t('hobbiesHint')}>
            {(control) => (
              <div className={styles.chipRow}>
                <Input
                  {...control}
                  value={pending}
                  maxLength={100}
                  disabled={hobbies.length >= MAX_HOBBIES}
                  onKeyDown={onPendingKeyDown}
                  onChange={(event) => setPending(event.target.value)}
                />
                <Button
                  variant="secondary"
                  size="md"
                  disabled={!pending.trim() || hobbies.length >= MAX_HOBBIES}
                  onClick={addHobby}
                >
                  {t('hobbyAdd')}
                </Button>
              </div>
            )}
          </Field>

          {hobbies.length > 0 ? (
            <ul className={styles.chips}>
              {hobbies.map((hobby) => (
                <li key={hobby}>
                  <button
                    type="button"
                    className={styles.chip}
                    aria-label={t('hobbyRemove', { hobby })}
                    onClick={() =>
                      onChange({ hobbies: hobbies.filter((other) => other !== hobby) })
                    }
                  >
                    {hobby}
                    <span className={styles.chipGlyph} aria-hidden="true">
                      ×
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Field label={t('interestsLabel')} id="interestsText">
        {(control) => (
          <Textarea
            {...control}
            maxLength={2_000}
            value={values.interestsText ?? ''}
            onChange={(event) => onChange({ interestsText: event.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

// ------------------------------------------------------------------------------- cv

export interface CvFieldProps {
  /** The CV on the account, as the server reports it — never a local echo of the last upload. */
  cv: CvUpload | null;
  uploading: boolean;
  /** A resolved message, or null. The caller looks the error code up. */
  error: string | null;
  onFile: (file: File) => void;
  /** A pick the size guard refused, by code — the caller renders it like an upload failure. */
  onReject: (code: 'UPLOAD_TOO_LARGE') => void;
  /**
   * Whether to carry the "what is on the account" line. Off for a caller that already says it
   * in its own words — setup's CV block did, and the two sentences made the same claim twice,
   * in Turkish with two different words for the same document (issue 111's drift, in one box).
   */
  showState?: boolean;
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

/**
 * `POST /uploads` *is* the write — it repoints `users.cv_upload_id` itself — so this control has
 * no Save beside it and needs no Continue to persist. Holding the returned id in page state
 * instead is what made "CV received" a lie the moment the page reloaded (issue 62).
 */
export function CvField({ cv, uploading, error, onFile, onReject, showState = true }: CvFieldProps) {
  const t = useTranslations('fields');
  const format = useFormatter();

  const size = cv
    ? cv.sizeBytes >= BYTES_PER_MB
      ? t('sizeMb', { value: format.number(cv.sizeBytes / BYTES_PER_MB, { maximumFractionDigits: 1 }) })
      : t('sizeKb', { value: format.number(Math.max(1, Math.round(cv.sizeBytes / BYTES_PER_KB))) })
    : null;

  const meta = cv
    ? t('cvMeta', {
        size: size ?? '',
        date: format.dateTime(new Date(cv.uploadedAt), { dateStyle: 'medium' }),
      })
    : null;

  return (
    <div className={styles.stack}>
      {showState ? (
      <div data-testid="cv-state">
        {cv ? (
          <>
            {/* The name the file had when it was picked. `filename` is null only for a CV
                stored before the column existed, and then the facts below carry it alone. */}
            <p className={styles.cvName}>{cv.filename ?? t('cvUnnamed')}</p>
            <p className={styles.note}>{meta}</p>
          </>
        ) : (
          <p className={styles.note}>{t('cvNone')}</p>
        )}
      </div>
      ) : null}

      <Field
        label={t('cvLabel')}
        id="cvFile"
        hint={uploading ? t('cvUploading') : cv ? t('cvReplaceHint') : undefined}
        error={error ?? undefined}
      >
        {({ id, 'aria-describedby': describedBy }) => (
          <FileInput
            id={id}
            aria-describedby={describedBy}
            accept="application/pdf"
            disabled={uploading}
            invalid={Boolean(error)}
            action={cv ? t('cvReplace') : undefined}
            onFile={(file) => {
              // Clearing the picker is not a detach: the CV is already on the account, and no
              // endpoint takes it back off.
              if (file) onFile(file);
            }}
            onReject={onReject}
          />
        )}
      </Field>
    </div>
  );
}
