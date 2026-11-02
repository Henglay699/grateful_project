ALTER TABLE "debit_notes" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "pol" text;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "pod" text;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "container_no" text;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "volume_cbm" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "gross_weight_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "shipper" text;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "consignee" text;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "hbl" text;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "pkgs" text;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "pol" text;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "pod" text;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "container_no" text;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "volume_cbm" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "gross_weight_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "shipper" text;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "consignee" text;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "hbl" text;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "pkgs" text;