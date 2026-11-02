CREATE TYPE "public"."credit_note_review" AS ENUM('UNCHECKED', 'CHECKED', 'REVISED');--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "review_status" "credit_note_review" DEFAULT 'UNCHECKED' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
