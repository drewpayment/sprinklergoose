CREATE TABLE "weather_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"rain_lookback_mm" double precision DEFAULT 6 NOT NULL,
	"forecast_probability" integer DEFAULT 70 NOT NULL,
	"forecast_lookahead_mm" double precision DEFAULT 4 NOT NULL,
	"freeze_temp_c" double precision DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_settings_id_check" CHECK ("weather_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "program_runs" DROP CONSTRAINT "program_runs_status_check";--> statement-breakpoint
ALTER TABLE "program_runs" ADD CONSTRAINT "program_runs_status_check" CHECK ("program_runs"."status" IN ('running','completed','partial','failed','cancelled','skipped_rain_delay','skipped_weather','missed'));--> statement-breakpoint
INSERT INTO "weather_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;