-- The uploader's own filename, for display on the profile screen (issue 75): "cv.pdf" beside
-- the CV instead of a size and a date. Nullable, per the F02 migration protocol — every row
-- written before this column existed has no name to recover, and the screen falls back to
-- describing the file by its facts.
--
-- Display only. `storage_key` stays the content-addressed `uploads/<sha256>.pdf`, so a
-- crafted filename can never steer where bytes are written or read.
ALTER TABLE "uploads" ADD COLUMN "filename" TEXT;
