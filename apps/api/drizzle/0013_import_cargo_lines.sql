ALTER TABLE "cargo_invoice_lines" ADD COLUMN "material" text;--> statement-breakpoint
ALTER TABLE "cargo_invoice_lines" ADD COLUMN "cdc_no" text;--> statement-breakpoint
ALTER TABLE "cargo_invoice_lines" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "cargo_invoices" ADD COLUMN "packages" numeric(14, 3);