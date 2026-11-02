-- CO: the certificate of origin and GSP cost breakdown of an export invoice.
CREATE TABLE IF NOT EXISTS "co_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"form" text,
	"co_no" text,
	"co_date" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"remark" text,
	"breakdown" jsonb,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "co_records_invoice_id_unique" UNIQUE("invoice_id"),
	CONSTRAINT "co_records_status" CHECK (status IN ('DRAFT', 'CONFIRM', 'ISSUED'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "co_records" ADD CONSTRAINT "co_records_invoice_id_cargo_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."cargo_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "co_records" ADD CONSTRAINT "co_records_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
