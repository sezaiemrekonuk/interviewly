-- The dedup key on `uploads` was the bytes alone, globally. A second user uploading a
-- byte-identical PDF got back the *first* user's row id, which `setup.ts`'s ownership check
-- (issue #73) then refused as foreign: `POST /uploads` answered 201 and `POST /interviews`
-- answered 422 for a file the caller had just supplied. Making the PDF path usable at all
-- means one row per (owner, bytes) instead.
--
-- The bytes stay stored once regardless: `storage_key` is `uploads/<sha256>.pdf`, so both
-- rows address the same object. That is also why `delete-account.ts` must now check for a
-- sibling row before erasing the object.
--
-- Widening a unique constraint cannot fail on existing data: every row that satisfied the
-- global uniqueness satisfies the per-owner one.
ALTER TABLE "uploads" DROP CONSTRAINT IF EXISTS "uploads_sha256_key";
DROP INDEX IF EXISTS "uploads_sha256_key";

CREATE UNIQUE INDEX "uploads_user_id_sha256_key" ON "uploads" ("user_id", "sha256");
