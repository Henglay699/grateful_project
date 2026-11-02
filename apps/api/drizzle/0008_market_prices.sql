CREATE TABLE IF NOT EXISTS "fuel_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"gasoline_92" numeric(16, 0) NOT NULL,
	"gasoil_50ppm" numeric(16, 0) NOT NULL,
	"source_link" text,
	"source" text DEFAULT 'MEF' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_prices_start_date_unique" UNIQUE("start_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metal_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"price_date" date NOT NULL,
	"usd_per_oz" numeric(14, 4) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "metal_prices_symbol_date_unique" ON "metal_prices" USING btree ("symbol","price_date");--> statement-breakpoint
-- Keep updated_at correct for the new tables too (0001 only covered the tables that existed then).
CREATE TRIGGER trg_fuel_prices_updated_at BEFORE UPDATE ON "fuel_prices" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_metal_prices_updated_at BEFORE UPDATE ON "metal_prices" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
