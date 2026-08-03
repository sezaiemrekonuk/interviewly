/**
 * `POST /uploads` (I11, §7.2 K12). An uploaded PDF is untrusted input that reaches a parser,
 * so every dimension is bounded before anything parses it, and the declared MIME is never
 * believed on its own.
 *
 * Order is load-bearing: kind → hash → dedup short-circuit → magic bytes → page count →
 * extraction → text floor → store → row. Hashing before validation is what makes a
 * byte-identical re-upload free; a file that is already a row was already validated.
 */
import { createHash } from 'node:crypto';

import type { RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
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

// Only `kind` (a short enum) and one `file` part are ever legitimate here, so both are
// capped tightly — an untrusted multipart body otherwise gets unbounded fields/parts for free
// even with fileSize/files already bounded. `parts` is 1 field + 1 file + 1 slack: busboy's
// part counter turns out to run one ahead of files+fields (observed, not documented), so a
// legitimate `kind`+`file` request hits `LIMIT_PART_COUNT` at parts:2 and is wrongly rejected.
const parseFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 1, fieldSize: 64, parts: 3 },
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

export const createUpload: RequestHandler = async (req, res, next) => {
  try {
    const kind = kindSchema.safeParse((req.body as { kind?: unknown } | undefined)?.kind);
    if (!kind.success) throw new ApiError('VALIDATION_ERROR');

    const file = req.file;
    if (!file) throw new ApiError('VALIDATION_ERROR');
    if (file.size > MAX_BYTES) throw new ApiError('UPLOAD_TOO_LARGE');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    // `uploads.sha256` is globally `@unique` (F02, K12): the dedup key is the bytes, not
    // (bytes, kind) or (bytes, user). The same PDF sent twice is one object; whoever
    // references it records the role it played.
    const existing = await prisma.upload.findUnique({ where: { sha256 } });
    if (existing) {
      res.status(201).json({ uploadId: existing.id });
      return;
    }

    // The declared MIME is attacker-controlled; the leading bytes are what the file is.
    if (file.mimetype !== 'application/pdf' || !file.buffer.subarray(0, 5).equals(PDF_MAGIC)) {
      throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
    }

    // Structure only — page text is not touched until the page count is known to be sane.
    // unpdf rejects a Node `Buffer` outright (it wants a bare `Uint8Array`), so the bytes are
    // rewrapped view-only — no copy — before the file is ever handed to it.
    const bytes = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);
    const pdf = await getDocumentProxy(bytes).catch(() => {
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

    // upsert, not create: two identical uploads racing past the findUnique above would make
    // the second one a P2002 on the unique sha256 rather than the dedup hit it should be.
    const row = await prisma.upload.upsert({
      where: { sha256 },
      update: {},
      create: {
        user_id: req.user!.id,
        kind: kind.data,
        storage_key: storageKey,
        mime: file.mimetype,
        size_bytes: file.size,
        sha256,
      },
    });

    res.status(201).json({ uploadId: row.id });
  } catch (err) {
    next(err);
  }
};
