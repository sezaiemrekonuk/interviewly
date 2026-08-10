/**
 * `POST /uploads` (I11, §7.2 K12). An uploaded PDF is untrusted input that reaches a parser,
 * so every dimension is bounded before anything parses it, and the declared MIME is never
 * believed on its own.
 *
 * Order is load-bearing: kind → hash → magic bytes → page count → extraction → text floor →
 * store → row. Every upload walks the whole pipeline: the extracted text is the response, not
 * a side effect, so a deduped file that skipped extraction would answer with no text at all.
 * Dedup still happens, one step later — the `upsert` on the unique `sha256` resolves a repeat
 * to the same row and `storage.put` rewrites the same key with the same bytes.
 *
 * A `cv` does one more thing before it answers (A06 @AC-32): it attaches itself to the
 * account. `users.cv_upload_id` is repointed and the extracted text is cached on
 * `users.profile.cv_text`, which is where `interview/profile.ts`'s `mergeProfile` lifts it
 * from when it snapshots a candidate. Without that write the id lives and dies in the
 * uploader's memory and the CV never reaches a single question (issue 62).
 */
import { createHash } from 'node:crypto';

import { MAX_BLOCK_CHARS } from '@interviewly/ai';
import type { Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { storage } from '../../src/lib/storage';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 30;
const MIN_TEXT_CHARS = 200;
const PDF_MAGIC = Buffer.from('%PDF-');
// Multipart framing (boundaries, part headers, the `kind` field) sits on top of the file
// bytes. Without this slack a file of exactly MAX_BYTES — which is legal — would be refused
// by the Content-Length pre-check below.
const MULTIPART_SLACK = 4096;

const kindSchema = z.enum(['listing', 'cv']);

/**
 * multer has taken `defParamCharset` since 2.x (`multer/index.js` defaults it to `latin1`) and
 * `@types/multer` has never declared it. Augmented rather than cast: an `as Options` on the
 * config below would take the whole object out of the type checker to smuggle one key in.
 */
declare module 'multer' {
  interface Options {
    /** busboy's charset for header parameters — the `filename=` in Content-Disposition. */
    defParamCharset?: string;
  }
}

const MAX_FILENAME_CHARS = 120;

/**
 * The uploader's filename, made safe to store and show. It is attacker-controlled and it is
 * never used to address anything — `storage_key` is `uploads/<sha256>.pdf` — so this is about
 * what lands in a database column and on a screen, not about path traversal.
 *
 * Directory parts are dropped (browsers send a bare name, a scripted client need not),
 * control characters go because they wreck a log line and a table cell alike, and the whole
 * thing is capped. An empty result is `null`: no name is honest, `""` is not.
 *
 * Composed to NFC on the way through. Apple's filesystems hand over decomposed names —
 * `türkçe` arrives as `tu` + U+0308 + `rkc` + U+0327 + `e` — which renders correctly but is a
 * different string to every comparison, and which the cap below can cut between a letter and
 * the mark that belongs to it, orphaning an accent onto whatever precedes it.
 */
export function safeFilename(raw: string | undefined): string | null {
  if (!raw) return null;
  const base = (raw.split(/[\\/]/).pop() ?? '').normalize('NFC');
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, MAX_FILENAME_CHARS) : null;
}

// Only `kind` (a short enum) and one `file` part are ever legitimate here, so both are
// capped tightly — an untrusted multipart body otherwise gets unbounded fields/parts for free
// even with fileSize/files already bounded. `parts` is 1 field + 1 file + 1 slack: busboy's
// part counter turns out to run one ahead of files+fields (observed, not documented), so a
// legitimate `kind`+`file` request hits `LIMIT_PART_COUNT` at parts:2 and is wrongly rejected.
const parseFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 1, fieldSize: 64, parts: 3 },
  // multer defaults this to `latin1` (`multer/index.js`), which is wrong for every filename
  // that is not ASCII: the browser sends the `filename=` parameter as UTF-8, so each of those
  // bytes came back as its own Latin-1 character and `fatih-türkçe-cv.pdf` was stored, and
  // shown, as `fatih-tuÌrkcÌ§e-cv.pdf`. Nothing downstream can undo that — by then the
  // original bytes are gone — so it has to be right where the header is parsed.
  defParamCharset: 'utf8',
}).single('file');

/**
 * Content-Length is the cheap path: an honest oversized upload is refused before a byte is
 * buffered. multer's own limit stays as the backstop for a client that lies about its length
 * or streams chunked, and both map to the same code.
 */
export const uploadMiddleware: RequestHandler = (req, res, next) => {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BYTES + MULTIPART_SLACK) {
    next(new ApiError('UPLOAD_TOO_LARGE'));
    return;
  }

  parseFile(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      next(new ApiError(err.code === 'LIMIT_FILE_SIZE' ? 'UPLOAD_TOO_LARGE' : 'VALIDATION_ERROR'));
      return;
    }
    next(err);
  });
};

/**
 * The `cv` half of A06 @AC-32, in one transaction with the row it points at: a user whose
 * `cv_upload_id` moved but whose `cv_text` did not would hand the next interview the previous
 * CV's text, which is worse than having none.
 *
 * Truncated at the prompt builder's own ceiling rather than left whole — the builder would
 * cut it to the same 12 000 characters on the way into `<candidate_cv>`, so storing more only
 * grows every `GET /me/profile` and every `candidate_profile` snapshot for text no model will
 * ever read. `profile` is merged, never replaced: a CV uploaded on step 2 must not erase the
 * name saved on step 1 (A06 non-negotiable).
 */
async function attachCv(
  tx: Prisma.TransactionClient,
  userId: string,
  uploadId: string,
  text: string,
  traceId: string | undefined,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length > MAX_BLOCK_CHARS) {
    // Field lengths only — A06 non-negotiable: no profile *value* in a log line.
    logger.info({ userId, traceId, chars: trimmed.length, kept: MAX_BLOCK_CHARS }, 'CV_TRUNCATED');
  }

  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { profile: true } });
  const current = (user.profile as Record<string, unknown> | null) ?? {};

  await tx.user.update({
    where: { id: userId },
    data: {
      cv_upload_id: uploadId,
      profile: { ...current, cv_text: trimmed.slice(0, MAX_BLOCK_CHARS) },
    },
  });
}

export const createUpload: RequestHandler = async (req, res, next) => {
  try {
    const kind = kindSchema.safeParse((req.body as { kind?: unknown } | undefined)?.kind);
    if (!kind.success) throw new ApiError('VALIDATION_ERROR');
    const isCv = kind.data === 'cv';

    const file = req.file;
    if (!file) throw new ApiError('VALIDATION_ERROR');
    if (file.size > MAX_BYTES) throw new ApiError('UPLOAD_TOO_LARGE');

    const filename = safeFilename(file.originalname);

    // The dedup key is (owner, bytes): `uploads` is `@@unique([user_id, sha256])`. The same
    // PDF sent twice by one user is one row; sent by two users it is two rows over one stored
    // object, because a row an interview points at has to belong to whoever made the interview.
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    // The declared MIME is attacker-controlled; the leading bytes are what the file is.
    if (file.mimetype !== 'application/pdf' || !file.buffer.subarray(0, 5).equals(PDF_MAGIC)) {
      throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
    }

    // Structure only — page text is not touched until the page count is known to be sane.
    // unpdf rejects a Node `Buffer` outright (it wants a bare `Uint8Array`), so the bytes are
    // rewrapped view-only — no copy — before the file is ever handed to it.
    const bytes = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);
    const pdf = await getDocumentProxy(bytes).catch(() => {
      logger.info({ userId: req.user!.id, traceId: req.traceId }, 'UPLOAD_INVALID_FORMAT');
      throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
    });
    if (pdf.numPages > MAX_PAGES) throw new ApiError('UPLOAD_TOO_MANY_PAGES');

    // unpdf, no OCR (K12): a scan with no text layer is rejected, not transcribed.
    const { text } = await extractText(pdf, { mergePages: true });
    if (text.replace(/\s+/g, ' ').trim().length < MIN_TEXT_CHARS) {
      throw new ApiError('PDF_TEXT_TOO_SHORT');
    }

    const storageKey = `uploads/${sha256}.pdf`;
    await storage.put(storageKey, file.buffer, file.mimetype);

    const row = await prisma.$transaction(async (tx) => {
      // upsert, not create: one user sending the same bytes twice — concurrently or a week
      // apart — must resolve to the one row rather than a P2002 on the unique key.
      const upload = await tx.upload.upsert({
        where: { user_id_sha256: { user_id: req.user!.id, sha256 } },
        update: {
          // Re-uploading the same bytes under a new name renames what the profile shows.
          // The row is still one object — only the label the owner recognises it by moves.
          ...(filename ? { filename } : {}),
        },
        create: {
          user_id: req.user!.id,
          kind: kind.data,
          storage_key: storageKey,
          mime: file.mimetype,
          size_bytes: file.size,
          sha256,
          filename,
        },
      });

      if (isCv) await attachCv(tx, req.user!.id, upload.id, text, req.traceId);
      return upload;
    });

    // The only line this endpoint emitted before was the rare CV_TRUNCATED, so a successful
    // upload left no trace at all and "did my CV go through?" had no answer in the logs.
    // Sizes and kind only — never the extracted text (A06 non-negotiable).
    logger.info(
      {
        userId: req.user!.id,
        traceId: req.traceId,
        uploadId: row.id,
        kind: kind.data,
        bytes: file.size,
      },
      'UPLOAD_STORED',
    );

    // A `listing` answers with its own text: `POST /interviews` stores `job_text` NOT NULL and
    // every question is written from it, so an upload that returned only an id left the setup
    // form asking the candidate to paste what the server had already parsed. Truncated at the
    // prompt builder's ceiling — it would cut the block there anyway. A `cv` keeps its text
    // server-side: `attachCv` has already cached it and the uploader never needs it back.
    res
      .status(201)
      .json({ uploadId: row.id, ...(isCv ? {} : { text: text.trim().slice(0, MAX_BLOCK_CHARS) }) });
  } catch (err) {
    next(err);
  }
};
