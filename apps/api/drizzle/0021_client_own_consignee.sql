-- Each client's own consignee is named as its legal name (imports default to it).
-- Link an unlinked consignee of that name, then add the ones still missing.
UPDATE "consignees" c SET "client_id" = cl."id"
FROM "clients" cl
WHERE c."client_id" IS NULL AND cl."deleted_at" IS NULL
  AND coalesce(trim(cl."legal_name"), '') <> ''
  AND lower(c."name") = lower(trim(cl."legal_name"));--> statement-breakpoint
INSERT INTO "consignees" ("client_id", "name", "country_iso2")
SELECT DISTINCT ON (lower(trim(cl."legal_name"))) cl."id", trim(cl."legal_name"),
       (SELECT "iso2" FROM "countries" WHERE "iso2" = 'KH')
FROM "clients" cl
WHERE cl."deleted_at" IS NULL AND coalesce(trim(cl."legal_name"), '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "consignees" c WHERE lower(c."name") = lower(trim(cl."legal_name")))
ORDER BY lower(trim(cl."legal_name")), cl."created_at";
