CREATE TABLE "program_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"position" integer NOT NULL,
	"zone_id" integer NOT NULL,
	"zone_name" varchar(40) NOT NULL,
	"planned_minutes" integer NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "program_run_steps_outcome_check" CHECK ("program_run_steps"."outcome" IN ('completed','cancelled','failed','skipped_disabled'))
);
--> statement-breakpoint
CREATE TABLE "program_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer,
	"program_name" varchar(60) NOT NULL,
	"scheduled_for" timestamp with time zone,
	"initiator" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "program_runs_status_check" CHECK ("program_runs"."status" IN ('running','completed','partial','failed','cancelled','skipped_rain_delay','missed'))
);
--> statement-breakpoint
CREATE TABLE "program_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"position" integer NOT NULL,
	"zone_id" integer NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "program_steps_program_id_position_unique" UNIQUE("program_id","position"),
	CONSTRAINT "program_steps_minutes_check" CHECK ("program_steps"."minutes" BETWEEN 1 AND 240)
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"start_times" time[] NOT NULL,
	"day_type" text NOT NULL,
	"days_of_week" integer[],
	"interval_days" integer,
	"anchor_date" date,
	"respect_rain_delay" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_day_type_check" CHECK ("programs"."day_type" IN ('days_of_week','interval'))
);
--> statement-breakpoint
CREATE TABLE "run_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "program_run_steps" ADD CONSTRAINT "program_run_steps_run_id_program_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."program_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_runs" ADD CONSTRAINT "program_runs_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_steps" ADD CONSTRAINT "program_steps_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_steps" ADD CONSTRAINT "program_steps_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_requests" ADD CONSTRAINT "run_requests_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;