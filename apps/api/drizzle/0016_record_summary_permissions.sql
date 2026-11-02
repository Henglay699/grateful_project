-- Record Summary gets its own permissions (it used accounting's). Existing roles keep the
-- access they had to it: accounting:write → view and edit, accounting:read → view. Operations
-- also get view and edit, since they fill in the summaries (the INV / DIS / DN numbers stay
-- the accountant's, from the Monthly Ledger).
UPDATE "roles" SET "permissions" = array_cat("permissions", ARRAY['recordsummaries:read', 'recordsummaries:write']::text[])
WHERE ('accounting:write' = ANY("permissions") OR "code" = 'OPERATOR') AND NOT ('recordsummaries:read' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'recordsummaries:read')
WHERE 'accounting:read' = ANY("permissions") AND NOT ('recordsummaries:read' = ANY("permissions"));--> statement-breakpoint
-- People given accounting access one by one keep their Record Summary access too.
UPDATE "users" SET "permissions_add" = array_cat("permissions_add", ARRAY['recordsummaries:read', 'recordsummaries:write']::text[])
WHERE 'accounting:write' = ANY("permissions_add") AND NOT ('recordsummaries:read' = ANY("permissions_add"));--> statement-breakpoint
UPDATE "users" SET "permissions_add" = array_append("permissions_add", 'recordsummaries:read')
WHERE 'accounting:read' = ANY("permissions_add") AND NOT ('recordsummaries:read' = ANY("permissions_add"));
