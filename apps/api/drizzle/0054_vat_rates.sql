CREATE TABLE IF NOT EXISTS "vat_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_date" date NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_rates_effective_date_unique" UNIQUE("effective_date")
);
--> statement-breakpoint
ALTER TABLE "accounting_records" ADD COLUMN "vat_rate" numeric(5, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "vat_rate" numeric(5, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "record_summaries" ADD COLUMN "vat_rate" numeric(5, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD COLUMN "vat_rate" numeric(5, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vat_rates" ADD CONSTRAINT "vat_rates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
