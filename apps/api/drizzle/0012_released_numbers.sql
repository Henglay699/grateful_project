CREATE TABLE IF NOT EXISTS "released_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"from_declare_no" text,
	"released_by_id" uuid,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reassigned_to_declare_no" text,
	"reassigned_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "released_numbers" ADD CONSTRAINT "released_numbers_released_by_id_users_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "released_numbers_free_unique" ON "released_numbers" USING btree ("kind","period","seq") WHERE "released_numbers"."reassigned_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_records_dn_no_unique" ON "accounting_records" USING btree ("dn_no") WHERE "accounting_records"."dn_no" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_records_dis_no_year_unique" ON "accounting_records" USING btree ("dis_no",(extract(year from "inv_date"))) WHERE "accounting_records"."dis_no" IS NOT NULL;