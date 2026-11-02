ALTER TABLE "record_summaries" ADD COLUMN "review_status" "credit_note_review" DEFAULT 'UNCHECKED' NOT NULL;--> statement-breakpoint
ALTER TABLE "record_summaries" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "record_summaries" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "record_summaries" ADD COLUMN "review_note" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summaries" ADD CONSTRAINT "record_summaries_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
