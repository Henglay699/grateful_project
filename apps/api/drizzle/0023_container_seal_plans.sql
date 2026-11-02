CREATE TABLE IF NOT EXISTS "container_seal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"container_no" text NOT NULL,
	"carrier" text,
	"destination" text,
	"tare_weight_kg" numeric(14, 3),
	"truck_by" text,
	"driver_phone" text,
	"truck_no" text,
	"deliver_to" text,
	"loading_date" date,
	"depot" text,
	"other" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "container_seal_plans" ADD CONSTRAINT "container_seal_plans_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "container_seal_plans" ADD CONSTRAINT "container_seal_plans_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "container_seal_plans_shipment_no_unique" ON "container_seal_plans" USING btree ("shipment_id","container_no");