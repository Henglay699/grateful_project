CREATE TABLE IF NOT EXISTS "record_summary_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_summary_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" "credit_note_review" NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summary_messages" ADD CONSTRAINT "record_summary_messages_record_summary_id_record_summaries_id_fk" FOREIGN KEY ("record_summary_id") REFERENCES "public"."record_summaries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summary_messages" ADD CONSTRAINT "record_summary_messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summary_messages" ADD CONSTRAINT "record_summary_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_summary_messages_recipient_idx" ON "record_summary_messages" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_summary_messages_summary_idx" ON "record_summary_messages" USING btree ("record_summary_id");