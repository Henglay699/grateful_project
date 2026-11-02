-- Hand-written migration: things Drizzle's schema DSL does not express.

-- 1) Keep updated_at correct even for raw SQL updates.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- 2) Live cut-stock balance (rules from JR CDC MASTER LIST.xlsx):
--    imported = opening + Σ declared ; balance = qty − imported ;
--    balance_pct = balance / qty ; condition = CHECK when < 50 % (or qty = 0).
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
  SELECT cut_stock_item_id,
         sum(qty) AS qty,
         sum(round(qty * unit_price, 2)) AS value,
         sum(net_weight_kg) AS nw
  FROM cdc_lines GROUP BY cut_stock_item_id
) d ON d.cut_stock_item_id = i.id
WHERE i.deleted_at IS NULL;
--> statement-breakpoint

-- 3) Business rule enforced in the database as well as the API:
--    a CDC line may not push an item's balance below zero unless it carries an
--    override (reason + approving user). The item row is locked so two
--    declarations saved at the same moment cannot both pass the check.
CREATE OR REPLACE FUNCTION enforce_cut_stock_balance() RETURNS trigger AS $$
DECLARE
  v_qty numeric;
  v_opening numeric;
  v_declared numeric;
  v_name text;
BEGIN
  SELECT qty, opening_imported_qty, name INTO v_qty, v_opening, v_name
  FROM cut_stock_items WHERE id = NEW.cut_stock_item_id FOR UPDATE;

  SELECT COALESCE(sum(qty), 0) INTO v_declared
  FROM cdc_lines
  WHERE cut_stock_item_id = NEW.cut_stock_item_id
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF v_qty - v_opening - v_declared - NEW.qty < 0 AND NEW.override_reason IS NULL THEN
    RAISE EXCEPTION 'Declaring % of "%" exceeds the remaining balance of %', NEW.qty, v_name, v_qty - v_opening - v_declared
      USING ERRCODE = 'P0001', HINT = 'CUT_STOCK_OVER_IMPORT';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_cdc_lines_balance ON cdc_lines;
--> statement-breakpoint
CREATE TRIGGER trg_cdc_lines_balance
  BEFORE INSERT OR UPDATE OF qty, cut_stock_item_id, override_reason ON cdc_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_cut_stock_balance();
