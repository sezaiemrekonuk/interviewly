/**
 * What a filename survives on the way from a file picker into a database column.
 *
 * The multipart half of this cannot be asserted here: whether the `filename=` parameter is
 * read as UTF-8 is busboy's, and it is set by `defParamCharset` on the multer config next to
 * this function. What *is* assertable is the second half of the same bug — a decomposed name
 * that renders correctly and compares as something else — and the cap that used to be able to
 * cut a letter away from its own accent.
 */
import { describe, expect, it } from 'vitest';

const { safeFilename } = await import('./uploads');

/** How Apple's filesystems hand `türkçe` over: base letters plus combining marks. */
const DECOMPOSED = 'fatih-tu\u0308rkc\u0327e-cv.pdf';

describe('safeFilename', () => {
  it('composes a decomposed name', () => {
    expect(DECOMPOSED).not.toBe('fatih-türkçe-cv.pdf');
    expect(safeFilename(DECOMPOSED)).toBe('fatih-türkçe-cv.pdf');
  });

  it('leaves an already-composed name alone', () => {
    expect(safeFilename('fatih-türkçe-cv.pdf')).toBe('fatih-türkçe-cv.pdf');
  });

  // The cap counts code units, so a decomposed name could be cut between a letter and the mark
  // that belongs to it — the accent then lands on whatever character precedes the cut.
  it('does not leave a combining mark orphaned at the cap', () => {
    const long = `${'a'.repeat(119)}u\u0308.pdf`;

    const name = safeFilename(long) as string;
    expect(name).toHaveLength(120);
    expect(name.endsWith('ü')).toBe(true);
    expect(name).not.toMatch(/[\u0300-\u036f]/);
  });

  it('keeps dropping directory parts and control characters', () => {
    expect(safeFilename('C:\\Users\\deniz\\cv.pdf')).toBe('cv.pdf');
    expect(safeFilename('/tmp/özgeçmiş.pdf')).toBe('özgeçmiş.pdf');
    expect(safeFilename('cv\u0000\u001f.pdf')).toBe('cv.pdf');
  });

  it('answers null for a name that is nothing once cleaned', () => {
    expect(safeFilename(undefined)).toBeNull();
    expect(safeFilename('')).toBeNull();
    expect(safeFilename('   ')).toBeNull();
    expect(safeFilename('\u0000')).toBeNull();
  });
});
