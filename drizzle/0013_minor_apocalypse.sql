DROP INDEX "bodyweight_logs_user_id_idx";--> statement-breakpoint
CREATE INDEX "bodyweight_logs_user_id_weighed_at_idx" ON "bodyweight_logs" USING btree ("user_id","weighed_at" DESC NULLS LAST);