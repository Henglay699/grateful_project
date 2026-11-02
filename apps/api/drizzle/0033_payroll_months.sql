CREATE TABLE IF NOT EXISTS "payroll_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" char(7) NOT NULL,
	"company" text NOT NULL,
	"client_id" uuid,
	"sheet_name" text DEFAULT '' NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"staff_count" integer NOT NULL,
	"female" integer NOT NULL,
	"male" integer NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"staff" jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"saved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_months" ADD CONSTRAINT "payroll_months_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_months" ADD CONSTRAINT "payroll_months_saved_by_id_users_id_fk" FOREIGN KEY ("saved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_months_company_period_unique" ON "payroll_months" USING btree (upper("company"),"period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_months_period_idx" ON "payroll_months" USING btree ("period");