-- Saving a report's setup (Reports → Payroll → Capacity report) gets its own permission. Roles
-- that already read reports and write accounting get it (Admins, Managers, Accountants).
UPDATE "roles" SET "permissions" = array_append("permissions", 'reports:write')
WHERE 'reports:read' = ANY("permissions") AND 'accounting:write' = ANY("permissions") AND NOT ('reports:write' = ANY("permissions"));
