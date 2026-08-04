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
 * @param pages one line of extractable text per page
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
    const stream = `BT /F1 12 Tf 72 720 Td (${escapeLiteral(text)}) Tj ET`;
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
  // The MIME-only attack: text bytes, a .pdf name, and `application/pdf` on the wire.
  'renamed-text-file.pdf': () =>
    Buffer.from(`${LINE_1}\n${LINE_2}\n${LINE_3}\n`.repeat(4), 'utf8'),
};

export function fixtureBytes(name: string): Buffer {
  const build = FIXTURES[name];
  if (!build) throw new Error(`no upload fixture named ${name}`);
  return build();
}
