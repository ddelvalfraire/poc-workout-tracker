ALTER TABLE "sets" ADD COLUMN "rir" integer;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "rpe" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "prescribed_rir" integer;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "prescribed_rpe" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "rpe_logging_enabled" boolean DEFAULT false NOT NULL;