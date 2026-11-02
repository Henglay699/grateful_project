ALTER TYPE "public"."role_code" ADD VALUE 'CUSTOMS_BROKER';--> statement-breakpoint
-- Credit Noted gets its own permissions. Existing roles keep the access they had to it
-- (Admin, Manager and Accountant could edit it; Viewer could read it). The new Customs
-- Broker role row itself is added after migrating (see db/migrate.ts), because a new enum
-- value can't be used in the same transaction that adds it.
UPDATE "roles" SET "permissions" = array_cat("permissions", ARRAY['creditnotes:read', 'creditnotes:write']::text[])
WHERE "code" IN ('ADMIN', 'MANAGER', 'ACCOUNTANT') AND NOT ('creditnotes:read' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'creditnotes:read')
WHERE "code" = 'VIEWER' AND NOT ('creditnotes:read' = ANY("permissions"));
