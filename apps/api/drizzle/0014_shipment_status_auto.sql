ALTER TABLE "public"."shipments" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."shipments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
-- The status is now worked out, not chosen (no more Exception): apply the rule to every shipment.
UPDATE "shipments" s SET "status" = CASE
    WHEN (s.direction = 'IMPORT' AND s.arrive_fty IS NOT NULL)
      OR (s.direction = 'EXPORT' AND s.atd IS NOT NULL) THEN 'COMPLETED'
    WHEN EXISTS (SELECT 1 FROM customs_declarations d WHERE d.shipment_id = s.id) THEN 'IN_PROGRESS'
    ELSE 'PENDING'
  END;--> statement-breakpoint
DROP TYPE "public"."shipment_status";--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('COMPLETED', 'IN_PROGRESS', 'PENDING');--> statement-breakpoint
ALTER TABLE "public"."shipments" ALTER COLUMN "status" SET DATA TYPE "public"."shipment_status" USING "status"::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "public"."shipments" ALTER COLUMN "status" SET DEFAULT 'PENDING';
