ALTER TABLE "container_seal_plans" ALTER COLUMN "shipment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD COLUMN "booking_no" text;--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD COLUMN "port_id" uuid;--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD COLUMN "vessel_name" text;--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD COLUMN "etd" date;--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD COLUMN "size" "container_size";--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD COLUMN "liner_seal" text;--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD COLUMN "customs_seal" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "container_seal_plans" ADD CONSTRAINT "container_seal_plans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "container_seal_plans" ADD CONSTRAINT "container_seal_plans_port_id_ports_id_fk" FOREIGN KEY ("port_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_seal_plans_client_idx" ON "container_seal_plans" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "container_seal_plans" ADD CONSTRAINT "container_seal_plans_has_factory" CHECK (shipment_id IS NOT NULL OR client_id IS NOT NULL);