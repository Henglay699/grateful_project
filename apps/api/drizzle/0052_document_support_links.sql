ALTER TABLE "documents" ADD COLUMN "credit_note_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "record_summary_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_record_summary_id_record_summaries_id_fk" FOREIGN KEY ("record_summary_id") REFERENCES "public"."record_summaries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_credit_note_idx" ON "documents" USING btree ("credit_note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_record_summary_idx" ON "documents" USING btree ("record_summary_id");