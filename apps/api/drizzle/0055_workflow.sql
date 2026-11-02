ALTER TYPE "public"."document_category" ADD VALUE 'CUSTOMS_PERMIT';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'ARRIVAL_NOTICE';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'DELIVERY_ORDER';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'AUTHORIZATION_LETTER';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'BOOKING_FORM';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'WAREHOUSE_CHECKLIST';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'VENDOR_INVOICE';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'BROKER_ID';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'PATENT_VAT';--> statement-breakpoint
ALTER TYPE "public"."role_code" ADD VALUE 'CEO';--> statement-breakpoint
ALTER TYPE "public"."role_code" ADD VALUE 'OPERATION_MANAGER';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broker_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text NOT NULL,
	"company_vattin" text,
	"grantee_name" text NOT NULL,
	"grantee_id_no" text,
	"grantee_phone" text,
	"agent_name" text NOT NULL,
	"agent_id_no" text,
	"agent_phone" text,
	"card_no" text,
	"card_expiry" date,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text,
	"issued_on" date,
	"valid_until" date,
	"notes" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_signatories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"passport_no" text,
	"title" text,
	"title_km" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customs_permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"permit_no" text NOT NULL,
	"issue_date" date,
	"valid_from" date,
	"valid_until" date,
	"office" text,
	"remark" text,
	"document_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipment_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"override_reason" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"vendor_name" text NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" date,
	"description" text,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(14, 2) DEFAULT '0' NOT NULL,
	"billed_cbm" numeric(14, 3),
	"billed_gross_weight_kg" numeric(14, 3),
	"due_date" date,
	"paid_on" date,
	"payment_ref" text,
	"document_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cdc_valid_until" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cdc_extension_letter_no" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cdc_customs_note_date" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "company_phone" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "workflow_stage" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "stage_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "booked_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "booked_gross_weight_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "booked_cbm" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "measured_cbm" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "measured_gross_weight_kg" numeric(14, 3);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_authorizations" ADD CONSTRAINT "client_authorizations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_authorizations" ADD CONSTRAINT "client_authorizations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_signatories" ADD CONSTRAINT "client_signatories_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customs_permits" ADD CONSTRAINT "customs_permits_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customs_permits" ADD CONSTRAINT "customs_permits_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customs_permits" ADD CONSTRAINT "customs_permits_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipment_stage_history" ADD CONSTRAINT "shipment_stage_history_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipment_stage_history" ADD CONSTRAINT "shipment_stage_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_authorizations_client_idx" ON "client_authorizations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_signatories_client_idx" ON "client_signatories" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customs_permits_shipment_idx" ON "customs_permits" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customs_permits_valid_until_idx" ON "customs_permits" USING btree ("valid_until") WHERE "customs_permits"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_stage_history_shipment_idx" ON "shipment_stage_history" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_invoices_shipment_idx" ON "vendor_invoices" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_workflow_stage_idx" ON "shipments" USING btree ("workflow_stage");--> statement-breakpoint
-- New permissions for existing roles (role codes compared as text: new enum values can't be used
-- in the transaction that adds them; the CEO and Operation Manager rows are added by migrate.ts).
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['customs:read', 'customs:write', 'workflow:approve', 'finance:approve']::text[]))
WHERE "code"::text IN ('ADMIN', 'MANAGER');--> statement-breakpoint
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['customs:read']::text[]))
WHERE "code"::text IN ('OPERATOR', 'ACCOUNTANT', 'VIEWER');--> statement-breakpoint
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['dashboard:read', 'clients:read', 'cutstock:read', 'documents:read', 'documents:write', 'followups:read', 'followups:write', 'customs:read', 'customs:write']::text[]))
WHERE "code"::text = 'CUSTOMS_BROKER';--> statement-breakpoint
-- The broker details that were written into the import letter generator.
INSERT INTO "broker_agents" ("company", "company_vattin", "grantee_name", "grantee_id_no", "grantee_phone", "agent_name", "agent_id_no", "agent_phone", "card_no", "card_expiry", "is_default")
SELECT 'GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.', 'K008-902404873', 'យឹម ជៀវសៀ', '021114299', '098 484 414', 'សៀ សុខជា', '020466170 (02)', '086 347 078', 'CB CARD #1132', '2028-03-31', true
WHERE NOT EXISTS (SELECT 1 FROM "broker_agents");--> statement-breakpoint
-- JR Apparel's letter details, previously in code.
UPDATE "clients" SET "company_phone" = coalesce("company_phone", '077 777 469'),
  "cdc_extension_letter_no" = coalesce("cdc_extension_letter_no", '1343/26'),
  "cdc_customs_note_date" = coalesce("cdc_customs_note_date", '2026-05-22')
WHERE upper("code") = 'JR';--> statement-breakpoint
INSERT INTO "client_signatories" ("client_id", "name", "passport_no", "title", "title_km", "is_default")
SELECT c."id", 'LIN LEE BI JEN', '353387543', 'GENERAL MANAGER', 'ជ.នាយកក្រុមហ៊ុន JR APPAREL', true
FROM "clients" c WHERE upper(c."code") = 'JR'
  AND NOT EXISTS (SELECT 1 FROM "client_signatories" s WHERE s."client_id" = c."id");--> statement-breakpoint
-- Place existing shipments in the workflow from what they already record.
UPDATE "shipments" s SET
  "workflow_stage" = CASE
    WHEN s."status" = 'COMPLETED' AND EXISTS (
      SELECT 1 FROM "customs_declarations" d JOIN "accounting_records" a ON a."declaration_id" = d."id"
      WHERE d."shipment_id" = s."id") THEN 'CLOSED'
    WHEN s."status" = 'COMPLETED' THEN 'BILLING'
    WHEN s."status" = 'IN_PROGRESS' AND s."direction" = 'IMPORT' THEN 'CLEARANCE'
    WHEN s."status" = 'IN_PROGRESS' THEN 'CFS_DELIVERY'
    ELSE NULL
  END,
  "stage_changed_at" = s."updated_at"
WHERE s."workflow_stage" IS NULL;
