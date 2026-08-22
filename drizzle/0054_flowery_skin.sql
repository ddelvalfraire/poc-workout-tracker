CREATE TABLE "usage_counters" (
	"user_id" text NOT NULL,
	"meter" text NOT NULL,
	"period_key" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_user_id_meter_period_key_pk" PRIMARY KEY("user_id","meter","period_key")
);
