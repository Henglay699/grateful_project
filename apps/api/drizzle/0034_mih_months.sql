CREATE TABLE IF NOT EXISTS "mih_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" char(7) NOT NULL,
	"client_id" uuid NOT NULL,
	"employees" integer NOT NULL,
	"female" integer NOT NULL,
	"salary" numeric(14, 2) NOT NULL,
	"export_qty" numeric(16, 2) NOT NULL,
	"export_value" numeric(14, 2) NOT NULL,
	"data" jsonb NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"saved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mih_months" ADD CONSTRAINT "mih_months_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mih_months" ADD CONSTRAINT "mih_months_saved_by_id_users_id_fk" FOREIGN KEY ("saved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mih_months_client_period_unique" ON "mih_months" USING btree ("client_id","period");