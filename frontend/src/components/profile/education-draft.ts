import type { EducationRow } from '../../lib/query';

/**
 * One entry as the form holds it: every field a string, because an empty year input is `''`
 * and a draft that stores `NaN` for "not typed yet" cannot tell empty from wrong.
 */
export interface EducationDraft {
  school: string;
  degree: string;
  field: string;
  startYear: string;
  endYear: string;
  grade: string;
  description: string;
}

export const EMPTY_ROW: EducationDraft = {
  school: '',
  degree: '',
  field: '',
  startYear: '',
  endYear: '',
  grade: '',
  description: '',
};

/** A06 caps the stored list at 5; the form stops offering a sixth rather than being refused one. */
export const MAX_EDUCATION_ROWS = 5;

const EARLIEST_YEAR = 1900;
const LATEST_YEAR = 2100;

const str = (value: string | undefined) => value ?? '';
const year = (value: number | undefined) => (value === undefined ? '' : String(value));

/**
 * The stored entries as drafts. Returns an empty list when there are none — the screen shows
 * its empty state and an add button, not a blank form nobody asked for.
 *
 * `graduationYear` is the pre-`endYear` shape; it is read as the end year so an entry saved
 * before the entry form existed opens with its year in the right box.
 */
export function toDrafts(rows: EducationRow[] | undefined): EducationDraft[] {
  return (rows ?? []).map((row) => ({
    school: str(row.school),
    degree: str(row.degree),
    field: str(row.field),
    startYear: year(row.startYear),
    endYear: year(row.endYear ?? row.graduationYear),
    grade: str(row.grade),
    description: str(row.description),
  }));
}

/**
 * Why this entry cannot be saved, or `null`. School is the only required field — same as
 * LinkedIn, and for the same reason: someone who knows where they studied but not which year
 * to call the end should be able to record it.
 */
export type EntryProblem = 'school' | 'year' | 'order';

export function entryProblem(row: EducationDraft): EntryProblem | null {
  if (!row.school.trim()) return 'school';

  for (const value of [row.startYear, row.endYear]) {
    if (!value) continue;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < EARLIEST_YEAR || parsed > LATEST_YEAR) return 'year';
  }

  // Only when both are present: an entry with just an end year is an ordinary "graduated in".
  if (row.startYear && row.endYear && Number(row.startYear) > Number(row.endYear)) return 'order';

  return null;
}

/** The first problem across the whole list, which is what a card-level save reports. */
export function cardProblem(rows: EducationDraft[]): EntryProblem | null {
  for (const row of rows) {
    const problem = entryProblem(row);
    if (problem) return problem;
  }
  return null;
}

/** One entry, ready to send: blanks dropped rather than stored as `''`, years coerced. */
export function toRow(row: EducationDraft): EducationRow {
  const trimmed = {
    school: row.school.trim(),
    degree: row.degree.trim(),
    field: row.field.trim(),
    grade: row.grade.trim(),
    description: row.description.trim(),
  };

  return {
    school: trimmed.school,
    ...(trimmed.degree ? { degree: trimmed.degree } : {}),
    ...(trimmed.field ? { field: trimmed.field } : {}),
    ...(row.startYear ? { startYear: Number(row.startYear) } : {}),
    ...(row.endYear ? { endYear: Number(row.endYear) } : {}),
    ...(trimmed.grade ? { grade: trimmed.grade } : {}),
    ...(trimmed.description ? { description: trimmed.description } : {}),
  };
}

/** The sendable list. Call only once `cardProblem` is null. */
export function toRows(rows: EducationDraft[]): EducationRow[] {
  return rows.filter((row) => row.school.trim()).map(toRow);
}
