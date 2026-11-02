-- CO status: Draft / Confirm / Issued → Pending / Draft / Submit / Approve (as on the shipment form).
ALTER TABLE "co_records" DROP CONSTRAINT "co_records_status";--> statement-breakpoint
UPDATE "co_records" SET "status" = CASE "status" WHEN 'CONFIRM' THEN 'SUBMIT' WHEN 'ISSUED' THEN 'APPROVE' ELSE "status" END;--> statement-breakpoint
ALTER TABLE "co_records" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "co_records" ADD CONSTRAINT "co_records_status" CHECK (status IN ('PENDING', 'DRAFT', 'SUBMIT', 'APPROVE'));
