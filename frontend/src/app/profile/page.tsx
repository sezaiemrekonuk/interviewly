'use client';

/**
 * `/profile` — what the interviewer knows about you.
 *
 * The reframe is the point. This was four tabs called `account / education / interests / cv`,
 * which is onboarding's three cards wearing a rail, plus an `account` tab that held identity
 * fields and a dead read-only email. Three things were wrong with that beyond the tabs:
 *
 *  - Account lifecycle lived here. Erasure sat at the foot of the surface, *outside* the
 *    tabpanel, so it rendered under all four cards permanently. It is on `/settings` now.
 *  - Email verification state sat in the dark nav rail while the address sat on a form tab.
 *    Both are on `/settings`, on one row, together.
 *  - Nothing said what any of it was for. Every section now names what it changes, because
 *    "your CV decides what the technical round asks you" is the only reason to fill it in.
 *
 * One page, not four panels: the fields are short, the API merges one card at a time either
 * way, and a tab rail was hiding two thirds of the answer to "what have I actually filled in".
 */

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  cardProblem,
  toDrafts,
  toRows,
  type EducationDraft,
} from '../../components/profile/education-draft';
import {
  CvField,
  EducationFields,
  IdentityFields,
  InterestsFields,
  type IdentityValues,
  type InterestsValues,
} from '../../components/profile/profile-fields';
import { AppRail } from '../../components/shell/app-rail';
import { SplitShell, WorkBody, WorkTop } from '../../components/shell/split-shell';
import { Button } from '../../components/ui';
import {
  useProfile,
  useSaveProfileCard,
  useUploadCv,
  type AccountProfile,
  type CvUpload,
} from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';
import { useRequireAuth } from '../../lib/use-require-auth';

import styles from './profile.module.css';

/**
 * The five inputs that reach the interviewer. Phone and date of birth are deliberately not
 * among them: the field hints say out loud that neither ever leaves the account, so neither
 * can make an interview better.
 *
 * Counted, never weighted into a percentage. The meter this replaced ran on hardcoded weights
 * (`cv: 3, education: 2, …`) and printed "38% of what shapes your questions is filled in" —
 * editorial opinion in the costume of a measurement, on a screen whose whole job is to be
 * believed. Five inputs is a fact; which one matters most is a sentence we can defend.
 */
function INPUTS(profile: AccountProfile | undefined, cv: CvUpload | null): unknown[] {
  return [
    profile?.fullName,
    profile?.jobTitle,
    profile?.education?.length,
    profile?.hobbies?.length || profile?.interestsText,
    cv,
  ];
}

/** Derived, so the count and the list cannot drift apart. */
const INPUT_COUNT = INPUTS(undefined, null).length;

/** A stable string per card, used only to answer "is there anything to save?". */
function identityKey(values: IdentityValues): string {
  return [values.fullName, values.jobTitle, values.phone, values.dateOfBirth]
    .map((value) => value ?? '')
    .join(' ');
}

function interestsKey(values: InterestsValues): string {
  return [(values.hobbies ?? []).join(''), values.interestsText ?? ''].join(' ');
}

/**
 * One card's footer: its outcome line and its Save. Declared at module scope, not inside the
 * page: a component created during render is a new type every render, so React remounts the
 * subtree — which in a form means losing focus on the field you are typing into.
 *
 * The two write-as-you-go cards have no footer at all. `POST /uploads` repoints the account's
 * CV itself and each education entry saves as it is confirmed, so a Save under either would
 * do nothing or repeat the write.
 */
function SaveRow({
  dirty,
  saving,
  saved,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  const t = useTranslations('profile');

  return (
    <div className={styles.actions}>
      <p className={styles.outcome} role="status">
        {saved && !dirty ? t('saved') : dirty ? '' : t('nothingToSave')}
      </p>
      {/* Secondary, not primary. Four independent cards each end in a Save, and four
          `--primary` fills on one surface is exactly the "the eye must not choose" this
          system forbids (§2 rule 1). This page has no single primary action. */}
      <Button variant="secondary" size="lg" disabled={!dirty} loading={saving} onClick={onSave}>
        {t('save')}
      </Button>
    </div>
  );
}

export default function ProfilePage() {
  const t = useTranslations('profile');
  const tFields = useTranslations('fields');
  const errorMessage = useErrorMessage();

  const { user, loading: authLoading } = useRequireAuth();
  const { data, isPending } = useProfile(!authLoading && Boolean(user));
  const saveCard = useSaveProfileCard();
  const uploadCvMutation = useUploadCv();

  // Drafts are never cleared after a save. A card is "clean" once the refetched profile matches
  // what is on screen, which it does the moment the save lands — clearing would flash the
  // pre-save values for as long as the refetch is in flight.
  const [identityDraft, setIdentityDraft] = useState<IdentityValues | null>(null);
  const [educationDraft, setEducationDraft] = useState<EducationDraft[] | null>(null);
  const [interestsDraft, setInterestsDraft] = useState<InterestsValues | null>(null);
  const [cardError, setCardError] = useState<{ card: 'identity' | 'education' | 'interests'; message: string } | null>(null);
  const [saved, setSaved] = useState<'identity' | 'education' | 'interests' | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);

  if (authLoading || !user) return null;

  const profile = data?.profile;
  const serverIdentity: IdentityValues = {
    fullName: profile?.fullName ?? '',
    jobTitle: profile?.jobTitle ?? '',
    phone: profile?.phone ?? '',
    dateOfBirth: profile?.dateOfBirth ?? '',
  };
  const serverInterests: InterestsValues = {
    hobbies: profile?.hobbies ?? [],
    interestsText: profile?.interestsText ?? '',
  };

  const identity = identityDraft ?? serverIdentity;
  const interests = interestsDraft ?? serverInterests;
  const education = educationDraft ?? toDrafts(profile?.education);
  const cv = data?.cv ?? null;

  const identityDirty = identityKey(identity) !== identityKey(serverIdentity);
  const interestsDirty = interestsKey(interests) !== interestsKey(serverInterests);

  const filled = INPUTS(profile, cv).filter(Boolean).length;

  function edited() {
    setSaved(null);
    setCardError(null);
  }

  async function save(card: 'identity' | 'interests') {
    setCardError(null);
    const payload =
      card === 'identity'
        ? ({ step: 1, fields: identity } as const)
        : ({ step: 3, fields: interests } as const);

    try {
      await saveCard.mutateAsync(payload);
      setSaved(card);
    } catch (err) {
      // A refused save keeps the draft on screen — nothing typed is thrown away.
      setCardError({
        card,
        message: `${t('saveFailed')} ${errorMessage(err instanceof Error ? err.message : 'UNKNOWN')}`,
      });
    }
  }

  async function saveEducation(rows: EducationDraft[]) {
    setCardError(null);
    // Belt and braces: the entry form refuses a bad entry before it reaches the list, so this
    // only fires for a row that was already stored in an older shape.
    const problem = cardProblem(rows);
    if (problem) {
      setCardError({
        card: 'education',
        message: tFields(problem === 'school' ? 'educationSchoolRequired' : 'educationYear'),
      });
      return;
    }
    try {
      await saveCard.mutateAsync({ step: 2, fields: { education: toRows(rows) } });
      setSaved('education');
    } catch (err) {
      setCardError({
        card: 'education',
        message: `${t('saveFailed')} ${errorMessage(err instanceof Error ? err.message : 'UNKNOWN')}`,
      });
    }
  }

  async function uploadCv(file: File) {
    setCvError(null);
    try {
      await uploadCvMutation.mutateAsync(file);
    } catch (err) {
      // A refused upload leaves the previously attached CV exactly where it was.
      setCvError(
        `${tFields('cvFailed')} ${errorMessage(err instanceof Error ? err.message : 'UNKNOWN')}`,
      );
    }
  }

  const savingStep = saveCard.isPending ? saveCard.variables?.step : undefined;

  return (
    <SplitShell rail={<AppRail user={user} />}>
      <WorkTop title={t('title')} />

      <WorkBody className={styles.body}>
        {isPending || !data ? (
          <div data-testid="profile-skeleton" aria-hidden="true" className={styles.skeleton}>
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonBlock} />
          </div>
        ) : (
          <>
            {/* Says what the page is for before it asks for anything. The old surface opened
                with four tab labels and never explained why any of them mattered. */}
            <section className={styles.intro}>
              <p className={styles.lede}>{t('lede')}</p>
              {/* A count, not a percentage, and no bar. The meter this replaced ran on
                  hardcoded weights and printed "38% filled in" — a number implying a model of
                  how much each input matters that does not exist. Counting what is filled is
                  true; ranking the one that matters most is a claim the product can actually
                  make, so it is a sentence rather than a hidden coefficient. */}
              <div className={styles.completeness}>
                <p className={styles.completenessNote}>
                  {t('inputs', { filled, total: INPUT_COUNT })}
                </p>
                {cv ? null : <p className={styles.completenessHint}>{t('inputsCv')}</p>}
              </div>
            </section>

            {/* --------------------------------------------------------------- identity */}
            <section className={styles.card} aria-labelledby="identity-heading">
              <h2 id="identity-heading" className={styles.cardTitle}>
                {t('identity.title')}
              </h2>
              <p className={styles.cardEffect}>{t('identity.effect')}</p>

              <IdentityFields
                extended
                values={identity}
                onChange={(patch) => {
                  edited();
                  setIdentityDraft({ ...identity, ...patch });
                }}
              />

              {cardError?.card === 'identity' ? (
                <p className={styles.error} role="alert">
                  {cardError.message}
                </p>
              ) : null}

              <SaveRow
                dirty={identityDirty}
                saving={savingStep === 1}
                saved={saved === 'identity'}
                onSave={() => void save('identity')}
              />
            </section>

            {/* --------------------------------------------------------------------- cv */}
            <section className={styles.card} aria-labelledby="cv-heading">
              <h2 id="cv-heading" className={styles.cardTitle}>
                {t('cv.title')}
              </h2>
              <p className={styles.cardEffect}>{t('cv.effect')}</p>

              {/* No Save under this one: `POST /uploads` repoints the account's CV itself, so
                  the upload *is* the write. */}
              <CvField
                cv={cv}
                uploading={uploadCvMutation.isPending}
                error={cvError}
                onFile={(file) => void uploadCv(file)}
                onReject={(code) => setCvError(`${tFields('cvFailed')} ${errorMessage(code)}`)}
              />
            </section>

            {/* -------------------------------------------------------------- education */}
            <section className={styles.card} aria-labelledby="education-heading">
              <h2 id="education-heading" className={styles.cardTitle}>
                {t('education.title')}
              </h2>
              <p className={styles.cardEffect}>{t('education.effect')}</p>

              {/* Each entry saves as it is confirmed, the way a list of entries behaves
                  everywhere else — so this section has no card-level Save either. */}
              <EducationFields
                rows={education}
                error={cardError?.card === 'education' ? cardError.message : null}
                saving={savingStep === 2}
                onChange={setEducationDraft}
                onCommit={(rows) => void saveEducation(rows)}
              />
              <p className={styles.outcome} role="status">
                {saved === 'education' ? t('saved') : ''}
              </p>
            </section>

            {/* -------------------------------------------------------------- interests */}
            <section className={styles.card} aria-labelledby="interests-heading">
              <h2 id="interests-heading" className={styles.cardTitle}>
                {t('interests.title')}
              </h2>
              <p className={styles.cardEffect}>{t('interests.effect')}</p>

              <InterestsFields
                extended
                values={interests}
                onChange={(patch) => {
                  edited();
                  setInterestsDraft({ ...interests, ...patch });
                }}
              />

              {cardError?.card === 'interests' ? (
                <p className={styles.error} role="alert">
                  {cardError.message}
                </p>
              ) : null}

              <SaveRow
                dirty={interestsDirty}
                saving={savingStep === 3}
                saved={saved === 'interests'}
                onSave={() => void save('interests')}
              />
            </section>
          </>
        )}
      </WorkBody>
    </SplitShell>
  );
}
