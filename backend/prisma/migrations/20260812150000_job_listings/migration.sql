CREATE TABLE "job_listings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "external_job_id" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "job_company" TEXT NOT NULL,
    "job_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_listings_user_id_external_job_id_key" ON "job_listings"("user_id", "external_job_id");

ALTER TABLE "job_listings" ADD CONSTRAINT "job_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
