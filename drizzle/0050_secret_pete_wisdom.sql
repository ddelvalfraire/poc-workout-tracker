CREATE TABLE "entitlement_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tier" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"reason" text NOT NULL,
	"actor_id" text,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"revoked_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_grants_window_ck" CHECK ("entitlement_grants"."ends_at" is null or "entitlement_grants"."ends_at" > "entitlement_grants"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "entitlements_current" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"source" text,
	"expires_at" timestamp with time zone,
	"grant_id" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements_current" ADD CONSTRAINT "entitlements_current_grant_id_entitlement_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."entitlement_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_grants_user_idx" ON "entitlement_grants" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_source_ref_live_idx" ON "entitlement_grants" USING btree ("source","source_ref") WHERE "entitlement_grants"."source_ref" is not null and "entitlement_grants"."status" = 'active';