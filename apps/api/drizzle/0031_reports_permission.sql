-- Reports (Payroll, MIH, Import & Export) gets its own permission: payroll is staff salaries.
-- Existing roles that read accounting get it, except Viewers; Operations and the Customs Broker
-- never had accounting, so they are left out.
UPDATE "roles" SET "permissions" = array_append("permissions", 'reports:read')
WHERE 'accounting:read' = ANY("permissions") AND "code" <> 'VIEWER' AND NOT ('reports:read' = ANY("permissions"));
