-- CO forms follow the MoC CO system's "New Application" list. Stored as the code used on the
-- shipping plans and CO Plans (AB, CRF…), shown as "Form AB". The old placeholders go when unused.
DELETE FROM "lookup_values" WHERE "type" = 'CO_FORM' AND "value" IN ('FORM A', 'FORM D', 'FORM E', 'GSP REX')
  AND NOT EXISTS (SELECT 1 FROM "shipments" WHERE "co_form" = "lookup_values"."value");--> statement-breakpoint
INSERT INTO "lookup_values" ("type", "value", "label", "sort_order") VALUES
  ('CO_FORM', 'A', 'Form A', 0),
  ('CO_FORM', 'ANNEX', 'Form ANNEX', 1),
  ('CO_FORM', 'AHK', 'Form AHK', 2),
  ('CO_FORM', 'AANZ', 'Form AANZ', 3),
  ('CO_FORM', 'AB', 'Form AB', 4),
  ('CO_FORM', 'AI', 'Form AI', 5),
  ('CO_FORM', 'AJ', 'Form AJ', 6),
  ('CO_FORM', 'AK', 'Form AK', 7),
  ('CO_FORM', 'CAM-UAE', 'Form CAM-UAE', 8),
  ('CO_FORM', 'CCFTA', 'Form CCFTA', 9),
  ('CO_FORM', 'CHILE', 'Form CHILE', 10),
  ('CO_FORM', 'CK', 'Form CK', 11),
  ('CO_FORM', 'D', 'Form D', 12),
  ('CO_FORM', 'DFTPI-LDC', 'Form DFTPI-LDC', 13),
  ('CO_FORM', 'E', 'Form E', 14),
  ('CO_FORM', 'KLDC', 'Form KLDC', 15),
  ('CO_FORM', 'OCL', 'Form OCL', 16),
  ('CO_FORM', 'N', 'Form N', 17),
  ('CO_FORM', 'RCEP', 'Form RCEP', 18),
  ('CO_FORM', 'S', 'Form S', 19),
  ('CO_FORM', 'SPT', 'Form SPT', 20),
  ('CO_FORM', 'CRF', 'CO Reference Form', 21)
ON CONFLICT ("type", "value") DO UPDATE SET "label" = EXCLUDED."label", "sort_order" = EXCLUDED."sort_order", "is_active" = true, "updated_at" = now();
