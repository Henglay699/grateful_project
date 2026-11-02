ALTER TABLE "cargo_invoice_lines" ADD COLUMN "cut_stock_item_id" uuid;--> statement-breakpoint
ALTER TABLE "cargo_invoice_lines" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "cargo_invoice_lines" ADD COLUMN "override_by_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cargo_invoice_lines" ADD CONSTRAINT "cargo_invoice_lines_cut_stock_item_id_cut_stock_items_id_fk" FOREIGN KEY ("cut_stock_item_id") REFERENCES "public"."cut_stock_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cargo_invoice_lines" ADD CONSTRAINT "cargo_invoice_lines_override_by_id_users_id_fk" FOREIGN KEY ("override_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cargo_invoice_lines_item_idx" ON "cargo_invoice_lines" USING btree ("cut_stock_item_id");--> statement-breakpoint
ALTER TABLE "cargo_invoice_lines" ADD CONSTRAINT "cargo_invoice_lines_override_complete" CHECK ((override_reason IS NULL) = (override_by_id IS NULL));--> statement-breakpoint
-- The CDC balance now comes from import invoice items, not declaration CDC lines.
-- 1) Link each import invoice item to the client's master-list item its CDC No. names.
UPDATE "cargo_invoice_lines" l SET "cut_stock_item_id" = i.id
FROM "cargo_invoices" ci, "shipments" s, "cut_stock_items" i
WHERE ci.id = l.invoice_id AND s.id = ci.shipment_id AND s.direction = 'IMPORT'
  AND i.client_id = s.client_id AND i.deleted_at IS NULL
  AND l.cdc_no IS NOT NULL
  AND upper(regexp_replace(i.declare_ref, '[\s\-–—_]+', '', 'g'))
    = upper(regexp_replace(l.cdc_no, '[\s\-–—_]+', '', 'g'));--> statement-breakpoint
-- 2) imported = opening + Σ PCS of linked invoice items on shipments that are not deleted.
CREATE OR REPLACE VIEW cut_stock_balances AS
SELECT
  i.id AS item_id,
  i.client_id,
  (i.opening_imported_qty + COALESCE(d.qty, 0))::numeric(14,3) AS imported_qty,
  (i.opening_imported_value + COALESCE(d.value, 0))::numeric(14,2) AS imported_value,
  (i.opening_imported_nw + COALESCE(d.nw, 0))::numeric(14,3) AS imported_nw,
  (i.qty - i.opening_imported_qty - COALESCE(d.qty, 0))::numeric(14,3) AS balance,
  CASE WHEN i.qty = 0 THEN NULL
       ELSE round((i.qty - i.opening_imported_qty - COALESCE(d.qty, 0)) / i.qty, 4) END AS balance_pct,
  CASE WHEN i.qty = 0 OR (i.qty - i.opening_imported_qty - COALESCE(d.qty, 0)) / i.qty < 0.5
       THEN 'CHECK' ELSE 'OK' END AS condition
FROM cut_stock_items i
LEFT JOIN (
  SELECT l.cut_stock_item_id,
         sum(l.pcs) AS qty,
         sum(l.fob_amount) AS value,
         sum(l.net_weight_kg) AS nw
  FROM cargo_invoice_lines l
  JOIN cargo_invoices ci ON ci.id = l.invoice_id
  JOIN shipments s ON s.id = ci.shipment_id AND s.deleted_at IS NULL
  WHERE l.cut_stock_item_id IS NOT NULL
  GROUP BY l.cut_stock_item_id
) d ON d.cut_stock_item_id = i.id
WHERE i.deleted_at IS NULL;--> statement-breakpoint
-- 3) An invoice item may not push the balance below zero without an override (reason + approver).
CREATE OR REPLACE FUNCTION enforce_invoice_cut_stock_balance() RETURNS trigger AS $$
DECLARE
  v_qty numeric;
  v_opening numeric;
  v_used numeric;
  v_name text;
BEGIN
  IF NEW.cut_stock_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT qty, opening_imported_qty, name INTO v_qty, v_opening, v_name
  FROM cut_stock_items WHERE id = NEW.cut_stock_item_id FOR UPDATE;

  SELECT COALESCE(sum(l.pcs), 0) INTO v_used
  FROM cargo_invoice_lines l
  JOIN cargo_invoices ci ON ci.id = l.invoice_id
  JOIN shipments s ON s.id = ci.shipment_id AND s.deleted_at IS NULL
  WHERE l.cut_stock_item_id = NEW.cut_stock_item_id
    AND (TG_OP = 'INSERT' OR l.id <> NEW.id);

  IF v_qty - v_opening - v_used - NEW.pcs < 0 AND NEW.override_reason IS NULL THEN
    RAISE EXCEPTION 'Importing % of "%" exceeds the remaining balance of %', NEW.pcs, v_name, v_qty - v_opening - v_used
      USING ERRCODE = 'P0001', HINT = 'CUT_STOCK_OVER_IMPORT';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_cargo_invoice_lines_balance ON cargo_invoice_lines;--> statement-breakpoint
CREATE TRIGGER trg_cargo_invoice_lines_balance
  BEFORE INSERT OR UPDATE OF pcs, cut_stock_item_id, override_reason ON cargo_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_invoice_cut_stock_balance();
