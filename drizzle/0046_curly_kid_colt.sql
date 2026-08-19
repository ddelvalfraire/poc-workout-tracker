CREATE TABLE "consent_current" (
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"document_id" uuid,
	"event_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "consent_current_user_id_purpose_pk" PRIMARY KEY("user_id","purpose")
);
--> statement-breakpoint
CREATE TABLE "consent_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text NOT NULL,
	"version" integer NOT NULL,
	"content_md" text NOT NULL,
	"content_sha256" text NOT NULL,
	"is_material" boolean DEFAULT true NOT NULL,
	"effective_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_downstream_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"processor" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"action" text NOT NULL,
	"document_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_truncated" text,
	"user_agent" text,
	"presentation" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_current" ADD CONSTRAINT "consent_current_document_id_consent_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."consent_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_current" ADD CONSTRAINT "consent_current_event_id_consent_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."consent_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_downstream_actions" ADD CONSTRAINT "consent_downstream_actions_event_id_consent_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."consent_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_document_id_consent_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."consent_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_documents_type_version_idx" ON "consent_documents" USING btree ("doc_type","version");--> statement-breakpoint
CREATE INDEX "consent_downstream_status_idx" ON "consent_downstream_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consent_events_user_purpose_idx" ON "consent_events" USING btree ("user_id","purpose","occurred_at" DESC NULLS LAST);