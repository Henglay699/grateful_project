CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'BANK_TRANSFER', 'CHEQUE');--> statement-breakpoint
CREATE TYPE "public"."statement_kind" AS ENUM('INVOICE', 'DEBIT_NOTE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "official_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" text NOT NULL,
	"client_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"kind" "statement_kind" NOT NULL,
	"receipt_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_ref" text,
	"note" text,
	"status" "billing_doc_status" DEFAULT 'ISSUED' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_receipts_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "official_receipts_amount_positive" CHECK (amount > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "official_receipts" ADD CONSTRAINT "official_receipts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "official_receipts" ADD CONSTRAINT "official_receipts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "official_receipts_client_period_idx" ON "official_receipts" USING btree ("client_id","period_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "official_receipts_date_idx" ON "official_receipts" USING btree ("receipt_date");