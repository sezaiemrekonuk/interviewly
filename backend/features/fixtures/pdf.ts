/**
 * The `upload.feature` fixtures, built rather than committed.
 *
 * A 10 MB binary in git is paid for by every clone forever, and a hand-made PDF is opaque to
 * review — the interesting property of each fixture (page count, extractable characters, byte
 * size, "not a PDF at all") is what the assertions are about, so it is expressed as code.
 * `buildPdf` emits an uncompressed PDF 1.4 with a real xref table, which pdf.js (via unpdf)
 * parses and extracts text from like any other file.
 */
import { Buffer } from 'node:buffer';

const LINE_1 =
  'Backend Engineer, remote. You will design and operate PostgreSQL-backed services, own '
  + 'deployments end to end, and review the work of two other engineers on the platform team.';
const LINE_2 =
  'Requirements: five years of TypeScript, strong SQL, and experience running Redis and '
  + 'message queues in production. Nice to have: Prisma, Docker Compose, OpenTelemetry.';
const LINE_3 =
  'We interview in three stages: a screening call, a systems discussion, and a paid work '
  + 'sample. Compensation is published in the offer letter and reviewed every twelve months.';

const ALT_1 =
  'Data Engineer, hybrid. You will build ingestion pipelines, model warehouse tables, and '
  + 'keep the nightly batch inside its window as volume grows quarter over quarter.';
const ALT_2 =
  'Requirements: Python, dbt, and Airflow in production, plus enough Postgres to explain a '
  + 'query plan. We pair on design and expect written proposals before large changes.';
const ALT_3 =
  'The team is four engineers and one analyst. We ship on Tuesdays, keep a written runbook '
  + 'for every pipeline, and rotate the on-call pager weekly so nobody carries it twice.';

/** `(`, `)` and `\` are the only bytes that need escaping inside a PDF literal string. */
function escapeLiteral(text: string): string {
  return text.replace(/([\\()])/g, '\\$1');
}

/**
 * A page is 612pt wide with a 72pt margin, and 12pt Helvetica averages ~6pt per glyph — so
 * roughly 90 characters reach the right edge. Everything past it is off the MediaBox, and
 * pdf.js drops it: a single 700-character `Tj` extracts as ~95 characters, silently. Text is
 * therefore laid out as wrapped lines, which is also what makes a page's character count in
 * `FIXTURES` mean what it says.
 */
const CHARS_PER_LINE = 90;
/** 720pt down to 72pt at 14pt leading — the last line that is still on the page. */
const LINES_PER_PAGE = 47;

function wrap(text: string): string[] {
  const lines: string[] = [];
  for (let at = 0; at < text.length; at += CHARS_PER_LINE) {
    lines.push(text.slice(at, at + CHARS_PER_LINE));
  }
  if (lines.length > LINES_PER_PAGE) {
    throw new Error(
      `page holds ${LINES_PER_PAGE} lines (${LINES_PER_PAGE * CHARS_PER_LINE} chars); `
      + `got ${text.length} — split it across more pages, the overflow would not extract`,
    );
  }
  return lines;
}

/**
 * @param pages the extractable text of each page, wrapped onto lines by `wrap`
 * @param padBytes filler inserted as a header comment — legal anywhere, and the only way to
 *   grow a file past a size limit without also growing what the parser has to understand
 */
export function buildPdf(pages: string[], padBytes = 0): Buffer {
  const n = pages.length;
  const fontId = 3 + 2 * n;
  const bodies: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${n} >>`,
    [fontId]: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };

  pages.forEach((text, i) => {
    bodies[3 + i] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${3 + n + i} 0 R >>`;
    // One `Td` sets the first baseline, then each subsequent `0 -14 Td` steps down a line.
    const body = wrap(text)
      .map((line) => `(${escapeLiteral(line)}) Tj 0 -14 Td`)
      .join(' ');
    const stream = `BT /F1 12 Tf 72 720 Td ${body} ET`;
    bodies[3 + n + i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  if (padBytes > 0) out += `%${'P'.repeat(padBytes)}\n`;

  const offsets: number[] = [];
  for (let id = 1; id <= fontId; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${bodies[id]}\nendobj\n`;
  }

  const xrefOffset = out.length;
  out += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // latin1: every byte above is ASCII, so this is a 1:1 char→byte mapping and the xref
  // offsets computed from string lengths are the real byte offsets.
  return Buffer.from(out, 'latin1');
}

const CV_SENTENCE =
  'Delivered and operated TypeScript services backed by PostgreSQL and Redis, owned the '
  + 'deployment pipeline end to end, and mentored two engineers on the platform team. ';

/**
 * A CV whose extractable text overshoots the 12 000-character prompt ceiling, so @AC-32 can
 * assert that `POST /uploads` truncates it rather than rejecting the file. 4 000 characters a
 * page keeps every page inside `LINES_PER_PAGE` and the whole thing well under the 30-page cap.
 */
const CHARS_PER_CV_PAGE = 4_000;

function longCvPages(totalChars: number): string[] {
  const pages: string[] = [];
  for (let written = 0; written < totalChars; written += CHARS_PER_CV_PAGE) {
    const size = Math.min(CHARS_PER_CV_PAGE, totalChars - written);
    pages.push(CV_SENTENCE.repeat(Math.ceil(size / CV_SENTENCE.length)).slice(0, size));
  }
  return pages;
}

const FIXTURES: Record<string, () => Buffer> = {
  // 3 pages, ~480 extractable characters — comfortably over the 200-character floor.
  'valid-3-page-listing.pdf': () => buildPdf([LINE_1, LINE_2, LINE_3]),
  // A different valid PDF: a second sha256, so dedup must NOT collapse it into the first.
  'another-valid-listing.pdf': () => buildPdf([ALT_1, ALT_2, ALT_3]),
  // What a scan looks like to a text extractor with no OCR: a page with almost nothing on it.
  'scanned-short-text.pdf': () => buildPdf(['Scan']),
  'pdf-31-pages.pdf': () => buildPdf(Array.from({ length: 31 }, (_, i) => `${LINE_1} Page ${i + 1}.`)),
  // Valid PDF, over the limit by ~1 MB. Rejected on size before anything parses it.
  'pdf-over-10mb.pdf': () => buildPdf([LINE_1], 11 * 1024 * 1024),
  'cv-20000-chars.pdf': () => buildPdf(longCvPages(20_000)),
  // The MIME-only attack: text bytes, a .pdf name, and `application/pdf` on the wire.
  'renamed-text-file.pdf': () =>
    Buffer.from(`${LINE_1}\n${LINE_2}\n${LINE_3}\n`.repeat(4), 'utf8'),
};

/**
 * A listing PDF nobody has uploaded before, for the issue #73 ownership scenarios.
 *
 * They cannot use `FIXTURES`: `uploads.sha256` is globally unique and the dedup short-circuit
 * is not scoped per user, so a shared fixture hands the second uploader the FIRST uploader's
 * row — which is exactly the ownership the scenarios are trying to establish, quietly
 * inverted. The nonce makes the bytes, and so the row, this scenario's own. Long enough for
 * the 200-character floor whichever `kind` it is uploaded as.
 */
export function uniqueListingBytes(nonce: string): Buffer {
  return buildPdf([`${LINE_1} Reference: ${nonce}.`, LINE_2, LINE_3]);
}

export function fixtureBytes(name: string): Buffer {
  const build = FIXTURES[name];
  if (!build) throw new Error(`no upload fixture named ${name}`);
  return build();
}
