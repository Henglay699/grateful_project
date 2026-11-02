ALTER TABLE "debit_notes" ADD COLUMN "container_size" "container_size";--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "pkgs_unit" text;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "container_size" "container_size";--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "pkgs_unit" text;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD COLUMN "container_size" "container_size";--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD COLUMN "pkgs_unit" text;--> statement-breakpoint
-- "629 CTNS" → quantity "629", unit "CTNS"; values without a leading number stay as typed.
UPDATE "tax_invoices" SET "pkgs_unit" = substring("pkgs" from '^\s*[0-9][0-9.,]*\s+(.+?)\s*$'), "pkgs" = substring("pkgs" from '^\s*([0-9][0-9.,]*)\s+.+$') WHERE "pkgs" ~ '^\s*[0-9][0-9.,]*\s+\S';--> statement-breakpoint
UPDATE "tax_invoices" t SET "container_size" = (SELECT k.size FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id JOIN containers k ON k.shipment_id = d.shipment_id WHERE a.id = t.accounting_record_id ORDER BY k.sort_order LIMIT 1) WHERE t.accounting_record_id IS NOT NULL;--> statement-breakpoint
-- "629 CTNS" → quantity "629", unit "CTNS"; values without a leading number stay as typed.
UPDATE "disbursements" SET "pkgs_unit" = substring("pkgs" from '^\s*[0-9][0-9.,]*\s+(.+?)\s*$'), "pkgs" = substring("pkgs" from '^\s*([0-9][0-9.,]*)\s+.+$') WHERE "pkgs" ~ '^\s*[0-9][0-9.,]*\s+\S';--> statement-breakpoint
UPDATE "disbursements" t SET "container_size" = (SELECT k.size FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id JOIN containers k ON k.shipment_id = d.shipment_id WHERE a.id = t.accounting_record_id ORDER BY k.sort_order LIMIT 1) WHERE t.accounting_record_id IS NOT NULL;--> statement-breakpoint
-- "629 CTNS" → quantity "629", unit "CTNS"; values without a leading number stay as typed.
UPDATE "debit_notes" SET "pkgs_unit" = substring("pkgs" from '^\s*[0-9][0-9.,]*\s+(.+?)\s*$'), "pkgs" = substring("pkgs" from '^\s*([0-9][0-9.,]*)\s+.+$') WHERE "pkgs" ~ '^\s*[0-9][0-9.,]*\s+\S';--> statement-breakpoint
UPDATE "debit_notes" t SET "container_size" = (SELECT k.size FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id JOIN containers k ON k.shipment_id = d.shipment_id WHERE a.id = t.accounting_record_id ORDER BY k.sort_order LIMIT 1) WHERE t.accounting_record_id IS NOT NULL;
