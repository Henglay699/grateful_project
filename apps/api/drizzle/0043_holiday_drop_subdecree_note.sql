-- Drop the "Sub-Decree No. 167 (18 Sep 2025)" note seeded on the 2026 holidays.
UPDATE "public_holidays" SET "note" = NULL WHERE "note" = 'Sub-Decree No. 167 (18 Sep 2025)';
