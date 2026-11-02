CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REUSE', 'OVERRIDE', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."billing_doc_status" AS ENUM('DRAFT', 'ISSUED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."chea_status" AS ENUM('UNPAID', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."clearance_status" AS ENUM('PENDING', 'IN_PROGRESS', 'CLEARED', 'EXCEPTION');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('ACTIVE', 'ONBOARDING', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."container_size" AS ENUM('20GP', '40GP', '40HQ', '45HQ');--> statement-breakpoint
CREATE TYPE "public"."credit_note_ref_type" AS ENUM('HOUSE_BILL', 'BILL_NO', 'HAWB_NO');--> statement-breakpoint
CREATE TYPE "public"."cut_stock_category" AS ENUM('MACHINERY_EQUIPMENT', 'RAW_MATERIAL', 'ACCESSORY');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('IMPORT', 'EXPORT');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('BILL_OF_LADING', 'CUSTOMS_DECLARATION', 'CERTIFICATE_OF_ORIGIN', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'CONTRACT', 'POLICY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."follow_up_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('OPEN', 'AWAITING_REPLY', 'IN_REVIEW', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."load_type" AS ENUM('FCL', 'LCL', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."lookup_type" AS ENUM('QUANTITY_UNIT', 'MATERIAL', 'CO_FORM', 'BROKER', 'DEPARTMENT', 'CHARGE');--> statement-breakpoint
CREATE TYPE "public"."port_kind" AS ENUM('SEA', 'DRY', 'AIR', 'LAND', 'RAIL');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."role_code" AS ENUM('ADMIN', 'MANAGER', 'OPERATOR', 'ACCOUNTANT', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('COMPLETED', 'IN_PROGRESS', 'PENDING', 'EXCEPTION');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('ACTIVE', 'ON_LEAVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."transport_mode" AS ENUM('SEA', 'AIR', 'ROAD', 'RAIL');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "role_code" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_title" text,
	"department" text,
	"phone" text,
	"status" "staff_status" DEFAULT 'ACTIVE' NOT NULL,
	"joined_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"avatar_url" text,
	"role_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"legal_name_km" text,
	"country_iso2" char(2) NOT NULL,
	"address" text,
	"vattin" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"commission_usd" numeric(14, 2) DEFAULT '50.00' NOT NULL,
	"status" "client_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "clients_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"name" text NOT NULL,
	"address" text,
	"country_iso2" char(2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "countries" (
	"iso2" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	CONSTRAINT "countries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_date" date NOT NULL,
	"usd_to_khr" numeric(14, 4) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_effective_date_unique" UNIQUE("effective_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forwarders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forwarders_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lookup_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "lookup_type" NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "number_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"customs_port_no" text,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"kind" "port_kind" NOT NULL,
	"country_iso2" char(2) DEFAULT 'KH' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ports_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cargo_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"po_no" text,
	"style_no" text,
	"hts_code" text,
	"pcs" numeric(14, 3) DEFAULT '0' NOT NULL,
	"ctns" numeric(14, 3) DEFAULT '0' NOT NULL,
	"cbm" numeric(14, 3) DEFAULT '0' NOT NULL,
	"net_weight_kg" numeric(14, 3) DEFAULT '0' NOT NULL,
	"gross_weight_kg" numeric(14, 3) DEFAULT '0' NOT NULL,
	"fob_unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"fob_amount" numeric(16, 2) GENERATED ALWAYS AS (round(pcs * fob_unit_price, 2)) STORED,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargo_invoice_lines_non_negative" CHECK (pcs >= 0 AND ctns >= 0 AND cbm >= 0 AND fob_unit_price >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cargo_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" date,
	"description" text,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cdc_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"declaration_id" uuid NOT NULL,
	"cut_stock_item_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"net_weight_kg" numeric(14, 3) DEFAULT '0' NOT NULL,
	"override_reason" text,
	"override_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cdc_lines_qty_positive" CHECK (qty > 0),
	CONSTRAINT "cdc_lines_override_complete" CHECK ((override_reason IS NULL) = (override_by_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"container_no" text NOT NULL,
	"size" "container_size",
	"liner_seal" text,
	"customs_seal" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customs_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"declare_no" text NOT NULL,
	"declare_date" date NOT NULL,
	"port_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_declarations_declare_no_unique" UNIQUE("declare_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cut_stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"declare_ref" text NOT NULL,
	"category" "cut_stock_category" NOT NULL,
	"name" text NOT NULL,
	"new_or_used" text,
	"unit" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"remarks" text,
	"opening_imported_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"opening_imported_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"opening_imported_nw" numeric(14, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cut_stock_items_qty_non_negative" CHECK (qty >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"client_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"transport_mode" "transport_mode" NOT NULL,
	"load_type" "load_type" NOT NULL,
	"status" "shipment_status" DEFAULT 'PENDING' NOT NULL,
	"clearance_status" "clearance_status" DEFAULT 'PENDING' NOT NULL,
	"shipper_name" text,
	"consignee_id" uuid,
	"forwarder_id" uuid,
	"broker" text,
	"clearance_port_id" uuid,
	"origin_country_iso2" char(2),
	"destination_country_iso2" char(2),
	"etd_port" text,
	"quantity" numeric(14, 3),
	"quantity_unit" text,
	"material" text,
	"booking_no" text,
	"hbl_no" text,
	"vessel_name" text,
	"voyage_no" text,
	"crd" date,
	"etd" date,
	"atd" date,
	"eta" date,
	"ata" date,
	"arrive_fty" date,
	"thc_hbl_no" text,
	"thc_hbl_date" date,
	"thc_hbl_amount" numeric(14, 2),
	"co_form" text,
	"co_number" text,
	"co_status" text,
	"remark" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shipments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"declaration_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"port_id" uuid,
	"inv_no" text,
	"dis_no" text,
	"dn_no" text,
	"inv_date" date NOT NULL,
	"exchange_rate" numeric(14, 4) NOT NULL,
	"clear_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"thc" numeric(14, 2) DEFAULT '0' NOT NULL,
	"other_pay" numeric(14, 2) DEFAULT '0' NOT NULL,
	"commission" numeric(14, 2) DEFAULT '0' NOT NULL,
	"inv_revenue" numeric(14, 2) DEFAULT '0' NOT NULL,
	"dis_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(14, 2) DEFAULT '0' NOT NULL,
	"dn_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_profit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"chea_status" "chea_status" DEFAULT 'UNPAID' NOT NULL,
	"mark" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_records_declaration_id_unique" UNIQUE("declaration_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mark" text,
	"credit_note_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accounting_record_id" uuid,
	"client_id" uuid NOT NULL,
	"status" "billing_doc_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cn_no" text NOT NULL,
	"cn_date" date NOT NULL,
	"bill_to" text NOT NULL,
	"address" text,
	"shipper" text,
	"port_id" uuid,
	"container_no" text,
	"ref_type" "credit_note_ref_type",
	"ref_no" text,
	"quantity_text" text,
	"gross_weight_kg" numeric(14, 3),
	"cbm" numeric(14, 3),
	"declare_no" text,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "credit_notes_cn_no_unique" UNIQUE("cn_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "debit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mark" text,
	"debit_note_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "debit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accounting_record_id" uuid,
	"client_id" uuid NOT NULL,
	"status" "billing_doc_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dn_no" text NOT NULL,
	"dn_date" date NOT NULL,
	"bill_to" text NOT NULL,
	"reference" text,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "debit_notes_dn_no_unique" UNIQUE("dn_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disbursement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mark" text,
	"disbursement_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accounting_record_id" uuid,
	"client_id" uuid NOT NULL,
	"status" "billing_doc_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dis_no" text NOT NULL,
	"dis_date" date NOT NULL,
	"exchange_rate" numeric(14, 4) NOT NULL,
	"customer_name_en" text NOT NULL,
	"customer_name_km" text,
	"customer_address" text,
	"customer_vattin" text,
	"reference" text,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_khr" numeric(16, 0) DEFAULT '0' NOT NULL,
	CONSTRAINT "disbursements_dis_no_unique" UNIQUE("dis_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "record_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accounting_record_id" uuid,
	"client_id" uuid NOT NULL,
	"status" "billing_doc_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"direction" "direction" NOT NULL,
	"transport_mode" "transport_mode" NOT NULL,
	"load_type" "load_type" NOT NULL,
	"inv_no" text,
	"dis_no" text,
	"dn_no" text,
	"forwarder_id" uuid,
	"port_id" uuid,
	"declare_no" text,
	"summary_date" date NOT NULL,
	"quantity_text" text,
	"bl_no" text,
	"container_no" text,
	"container_size" "container_size",
	"gross_weight_kg" numeric(14, 3),
	"cbm" numeric(14, 3),
	"total" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "record_summary_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mark" text,
	"record_summary_id" uuid NOT NULL,
	CONSTRAINT "record_summary_lines_qty" CHECK (qty >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mark" text,
	"tax_invoice_id" uuid NOT NULL,
	"vat" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accounting_record_id" uuid,
	"client_id" uuid NOT NULL,
	"status" "billing_doc_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" date NOT NULL,
	"exchange_rate" numeric(14, 4) NOT NULL,
	"customer_name_en" text NOT NULL,
	"customer_name_km" text,
	"customer_address" text,
	"customer_vattin" text,
	"pol" text,
	"pod" text,
	"container_no" text,
	"volume_cbm" numeric(14, 3),
	"gross_weight_kg" numeric(14, 3),
	"shipper" text,
	"consignee" text,
	"hbl" text,
	"pkgs" text,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal_khr" numeric(16, 0) DEFAULT '0' NOT NULL,
	"vat_khr" numeric(16, 0) DEFAULT '0' NOT NULL,
	"total_khr" numeric(16, 0) DEFAULT '0' NOT NULL,
	CONSTRAINT "tax_invoices_invoice_no_unique" UNIQUE("invoice_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"cells" jsonb NOT NULL,
	"amounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quotation_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"doc_title" text NOT NULL,
	"columns" jsonb NOT NULL,
	"default_rows" jsonb NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_no" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_version_id" uuid,
	"template_key" text NOT NULL,
	"client_id" uuid,
	"to_name" text NOT NULL,
	"attn" text,
	"quote_date" date NOT NULL,
	"payment_term_days" integer,
	"late_penalty_pct_per_day" numeric(6, 3),
	"notes" text,
	"status" "quotation_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"category" "document_category" DEFAULT 'OTHER' NOT NULL,
	"status_label" text,
	"shipment_id" uuid,
	"client_id" uuid,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"subject" text NOT NULL,
	"notes" text,
	"client_id" uuid,
	"shipment_id" uuid,
	"assignee_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"priority" "follow_up_priority" DEFAULT 'MEDIUM' NOT NULL,
	"status" "follow_up_status" DEFAULT 'OPEN' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" "audit_action" NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_country_iso2_countries_iso2_fk" FOREIGN KEY ("country_iso2") REFERENCES "public"."countries"("iso2") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consignees" ADD CONSTRAINT "consignees_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consignees" ADD CONSTRAINT "consignees_country_iso2_countries_iso2_fk" FOREIGN KEY ("country_iso2") REFERENCES "public"."countries"("iso2") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ports" ADD CONSTRAINT "ports_country_iso2_countries_iso2_fk" FOREIGN KEY ("country_iso2") REFERENCES "public"."countries"("iso2") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cargo_invoice_lines" ADD CONSTRAINT "cargo_invoice_lines_invoice_id_cargo_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."cargo_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cargo_invoices" ADD CONSTRAINT "cargo_invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cdc_lines" ADD CONSTRAINT "cdc_lines_declaration_id_customs_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."customs_declarations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cdc_lines" ADD CONSTRAINT "cdc_lines_cut_stock_item_id_cut_stock_items_id_fk" FOREIGN KEY ("cut_stock_item_id") REFERENCES "public"."cut_stock_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cdc_lines" ADD CONSTRAINT "cdc_lines_override_by_id_users_id_fk" FOREIGN KEY ("override_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cdc_lines" ADD CONSTRAINT "cdc_lines_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "containers" ADD CONSTRAINT "containers_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_port_id_ports_id_fk" FOREIGN KEY ("port_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cut_stock_items" ADD CONSTRAINT "cut_stock_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_consignee_id_consignees_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."consignees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_forwarder_id_forwarders_id_fk" FOREIGN KEY ("forwarder_id") REFERENCES "public"."forwarders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_clearance_port_id_ports_id_fk" FOREIGN KEY ("clearance_port_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_country_iso2_countries_iso2_fk" FOREIGN KEY ("origin_country_iso2") REFERENCES "public"."countries"("iso2") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_country_iso2_countries_iso2_fk" FOREIGN KEY ("destination_country_iso2") REFERENCES "public"."countries"("iso2") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_records" ADD CONSTRAINT "accounting_records_declaration_id_customs_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."customs_declarations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_records" ADD CONSTRAINT "accounting_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_records" ADD CONSTRAINT "accounting_records_port_id_ports_id_fk" FOREIGN KEY ("port_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_records" ADD CONSTRAINT "accounting_records_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_records" ADD CONSTRAINT "accounting_records_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_accounting_record_id_accounting_records_id_fk" FOREIGN KEY ("accounting_record_id") REFERENCES "public"."accounting_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_port_id_ports_id_fk" FOREIGN KEY ("port_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "debit_note_lines" ADD CONSTRAINT "debit_note_lines_debit_note_id_debit_notes_id_fk" FOREIGN KEY ("debit_note_id") REFERENCES "public"."debit_notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_accounting_record_id_accounting_records_id_fk" FOREIGN KEY ("accounting_record_id") REFERENCES "public"."accounting_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disbursement_lines" ADD CONSTRAINT "disbursement_lines_disbursement_id_disbursements_id_fk" FOREIGN KEY ("disbursement_id") REFERENCES "public"."disbursements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_accounting_record_id_accounting_records_id_fk" FOREIGN KEY ("accounting_record_id") REFERENCES "public"."accounting_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summaries" ADD CONSTRAINT "record_summaries_accounting_record_id_accounting_records_id_fk" FOREIGN KEY ("accounting_record_id") REFERENCES "public"."accounting_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summaries" ADD CONSTRAINT "record_summaries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summaries" ADD CONSTRAINT "record_summaries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summaries" ADD CONSTRAINT "record_summaries_forwarder_id_forwarders_id_fk" FOREIGN KEY ("forwarder_id") REFERENCES "public"."forwarders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summaries" ADD CONSTRAINT "record_summaries_port_id_ports_id_fk" FOREIGN KEY ("port_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_summary_lines" ADD CONSTRAINT "record_summary_lines_record_summary_id_record_summaries_id_fk" FOREIGN KEY ("record_summary_id") REFERENCES "public"."record_summaries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_tax_invoice_id_tax_invoices_id_fk" FOREIGN KEY ("tax_invoice_id") REFERENCES "public"."tax_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_accounting_record_id_accounting_records_id_fk" FOREIGN KEY ("accounting_record_id") REFERENCES "public"."accounting_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotations" ADD CONSTRAINT "quotations_previous_version_id_quotations_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotations" ADD CONSTRAINT "quotations_template_key_quotation_templates_key_fk" FOREIGN KEY ("template_key") REFERENCES "public"."quotation_templates"("key") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotations" ADD CONSTRAINT "quotations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_name_unique" ON "clients" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consignees_client_idx" ON "consignees" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consignees_name_unique" ON "consignees" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forwarders_name_unique" ON "forwarders" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lookup_values_type_value_unique" ON "lookup_values" USING btree ("type","value");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ports_name_unique" ON "ports" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cargo_invoice_lines_invoice_idx" ON "cargo_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cargo_invoice_lines_invoice_line_unique" ON "cargo_invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cargo_invoices_invoice_no_unique" ON "cargo_invoices" USING btree (upper("invoice_no"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cargo_invoices_shipment_idx" ON "cargo_invoices" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cdc_lines_declaration_idx" ON "cdc_lines" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cdc_lines_item_idx" ON "cdc_lines" USING btree ("cut_stock_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "containers_shipment_idx" ON "containers" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "containers_no_idx" ON "containers" USING btree ("container_no");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "containers_shipment_no_unique" ON "containers" USING btree ("shipment_id","container_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customs_declarations_shipment_idx" ON "customs_declarations" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customs_declarations_date_idx" ON "customs_declarations" USING btree ("declare_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cut_stock_items_client_ref_unique" ON "cut_stock_items" USING btree ("client_id","declare_ref");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cut_stock_items_client_name_unique" ON "cut_stock_items" USING btree ("client_id",upper("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cut_stock_items_client_idx" ON "cut_stock_items" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_client_status_eta_dir_idx" ON "shipments" USING btree ("client_id","status","eta","direction");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_eta_idx" ON "shipments" USING btree ("eta");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_direction_eta_idx" ON "shipments" USING btree ("direction","eta");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_forwarder_idx" ON "shipments" USING btree ("forwarder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_clearance_port_idx" ON "shipments" USING btree ("clearance_port_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_hbl_idx" ON "shipments" USING btree ("hbl_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_active_idx" ON "shipments" USING btree ("eta") WHERE "shipments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_records_client_date_idx" ON "accounting_records" USING btree ("client_id","inv_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_records_inv_date_idx" ON "accounting_records" USING btree ("inv_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_records_inv_no_unique" ON "accounting_records" USING btree ("inv_no") WHERE "accounting_records"."inv_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_note_lines_doc_idx" ON "credit_note_lines" USING btree ("credit_note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "debit_note_lines_doc_idx" ON "debit_note_lines" USING btree ("debit_note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disbursement_lines_doc_idx" ON "disbursement_lines" USING btree ("disbursement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_summary_lines_doc_idx" ON "record_summary_lines" USING btree ("record_summary_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_invoice_lines_doc_idx" ON "tax_invoice_lines" USING btree ("tax_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotation_lines_quotation_idx" ON "quotation_lines" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotations_no_version_unique" ON "quotations" USING btree ("quote_no","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotations_client_idx" ON "quotations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_shipment_idx" ON "documents" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_client_idx" ON "documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_category_idx" ON "documents" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "follow_ups_reference_unique" ON "follow_ups" USING btree ("reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_ups_open_due_idx" ON "follow_ups" USING btree ("due_at") WHERE "follow_ups"."status" <> 'DONE' AND "follow_ups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_ups_assignee_idx" ON "follow_ups" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_idx" ON "audit_log" USING btree ("user_id");