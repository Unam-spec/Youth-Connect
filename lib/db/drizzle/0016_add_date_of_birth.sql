ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "date_of_birth" date;
ALTER TABLE "visitors" ADD COLUMN IF NOT EXISTS "date_of_birth" date;
