-- Seal Plans gets its own permissions (it used shipments'). Existing roles keep the access they
-- had to it: shipments:read → view, shipments:write → view and edit. The Customs Broker never
-- saw Seal Plans in the sidebar, so it is left out.
UPDATE "roles" SET "permissions" = array_append("permissions", 'sealplans:read')
WHERE 'shipments:read' = ANY("permissions") AND "code"::text <> 'CUSTOMS_BROKER' AND NOT ('sealplans:read' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'sealplans:write')
WHERE 'shipments:write' = ANY("permissions") AND "code"::text <> 'CUSTOMS_BROKER' AND NOT ('sealplans:write' = ANY("permissions"));--> statement-breakpoint
-- People given (or denied) shipment access one by one get the same for Seal Plans.
UPDATE "users" SET "permissions_add" = array_append("permissions_add", 'sealplans:read')
WHERE 'shipments:read' = ANY("permissions_add") AND NOT ('sealplans:read' = ANY("permissions_add"));--> statement-breakpoint
UPDATE "users" SET "permissions_add" = array_append("permissions_add", 'sealplans:write')
WHERE 'shipments:write' = ANY("permissions_add") AND NOT ('sealplans:write' = ANY("permissions_add"));--> statement-breakpoint
UPDATE "users" SET "permissions_remove" = array_append("permissions_remove", 'sealplans:read')
WHERE 'shipments:read' = ANY("permissions_remove") AND NOT ('sealplans:read' = ANY("permissions_remove"));--> statement-breakpoint
UPDATE "users" SET "permissions_remove" = array_append("permissions_remove", 'sealplans:write')
WHERE 'shipments:write' = ANY("permissions_remove") AND NOT ('sealplans:write' = ANY("permissions_remove"));
