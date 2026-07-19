ALTER TABLE "programs" ADD COLUMN "author_actor" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "hero_image_url" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "source_url" text;