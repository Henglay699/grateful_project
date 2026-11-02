-- Cambodian ports print by their short name on the Tax Invoice, Disbursement and Debit Note
-- ("SHV PORT", "PNH PORT", "KTI"…); new documents take it from ports.short_name.
UPDATE "tax_invoices" t SET "pol" = p."short_name" FROM "ports" p WHERE t."pol" = p."name";--> statement-breakpoint
UPDATE "tax_invoices" t SET "pod" = p."short_name" FROM "ports" p WHERE t."pod" = p."name";--> statement-breakpoint
UPDATE "disbursements" t SET "pol" = p."short_name" FROM "ports" p WHERE t."pol" = p."name";--> statement-breakpoint
UPDATE "disbursements" t SET "pod" = p."short_name" FROM "ports" p WHERE t."pod" = p."name";--> statement-breakpoint
UPDATE "debit_notes" t SET "pol" = p."short_name" FROM "ports" p WHERE t."pol" = p."name";--> statement-breakpoint
UPDATE "debit_notes" t SET "pod" = p."short_name" FROM "ports" p WHERE t."pod" = p."name";
