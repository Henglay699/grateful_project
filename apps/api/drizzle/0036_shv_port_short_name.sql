-- Ports print by their short name on billing lists: "SHV PORT" beside "PNH PORT" and "KTI".
UPDATE "ports" SET "short_name" = 'SHV PORT', "updated_at" = now() WHERE "code" = 'SHV11' AND "short_name" = 'SIHANOUKVILLE';
