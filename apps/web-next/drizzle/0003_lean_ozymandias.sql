ALTER TABLE "run_requests" ALTER COLUMN "program_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "run_requests" ADD COLUMN "steps" jsonb;--> statement-breakpoint
ALTER TABLE "run_requests" ADD CONSTRAINT "run_requests_target" CHECK (("run_requests"."program_id" IS NOT NULL AND "run_requests"."steps" IS NULL) OR ("run_requests"."program_id" IS NULL AND "run_requests"."steps" IS NOT NULL));