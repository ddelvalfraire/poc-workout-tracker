CREATE TABLE "workout_drafts" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_drafts_user_id_key_pk" PRIMARY KEY("user_id","key")
);
