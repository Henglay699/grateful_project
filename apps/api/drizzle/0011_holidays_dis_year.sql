CREATE TABLE IF NOT EXISTS "public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_holidays_holiday_date_unique" UNIQUE("holiday_date")
);
--> statement-breakpoint
ALTER TABLE "disbursements" DROP CONSTRAINT "disbursements_dis_no_unique";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "disbursements_dis_no_year_unique" ON "disbursements" USING btree ("dis_no",(extract(year from "dis_date")));--> statement-breakpoint
-- Cambodian public holidays. 2026: Sub-Decree No. 167 of 18 Sep 2025. 2027: dates confirmed in
-- the press (Pchum Ben, Independence Day, Water Festival) plus the usual fixed dates, marked
-- provisional; Visak Bochea and the Royal Ploughing Ceremony (lunar) are not yet published.
INSERT INTO "public_holidays" ("holiday_date", "name", "note") VALUES
('2026-01-01', 'International New Year''s Day', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-01-07', 'Victory over Genocide Day', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-03-08', 'International Women''s Day', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-04-14', 'Khmer New Year', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-04-15', 'Khmer New Year', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-04-16', 'Khmer New Year', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-05-01', 'International Labour Day & Visak Bochea Day', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-05-05', 'Royal Ploughing Ceremony', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-05-14', 'King Norodom Sihamoni''s Birthday', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-06-18', 'Queen Mother Norodom Monineath Sihanouk''s Birthday', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-09-24', 'Constitution Day', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-10-10', 'Pchum Ben Festival', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-10-11', 'Pchum Ben Festival', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-10-12', 'Pchum Ben Festival', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-10-15', 'Commemoration Day of King Father Norodom Sihanouk', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-10-29', 'Coronation Day of King Norodom Sihamoni', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-11-09', 'Independence Day', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-11-23', 'Water Festival', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-11-24', 'Water Festival', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-11-25', 'Water Festival', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2026-12-29', 'Peace Day', 'Sub-Decree No. 167 (18 Sep 2025)'),
('2027-01-01', 'International New Year''s Day', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-01-07', 'Victory over Genocide Day', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-03-08', 'International Women''s Day', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-04-14', 'Khmer New Year', 'Provisional: check the exact Khmer New Year days in the 2027 sub-decree'),
('2027-04-15', 'Khmer New Year', 'Provisional: check the exact Khmer New Year days in the 2027 sub-decree'),
('2027-04-16', 'Khmer New Year', 'Provisional: check the exact Khmer New Year days in the 2027 sub-decree'),
('2027-05-01', 'International Labour Day', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-05-14', 'King Norodom Sihamoni''s Birthday', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-06-18', 'Queen Mother Norodom Monineath Sihanouk''s Birthday', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-09-24', 'Constitution Day', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-09-29', 'Pchum Ben Festival', NULL),
('2027-09-30', 'Pchum Ben Festival', NULL),
('2027-10-01', 'Pchum Ben Festival', NULL),
('2027-10-15', 'Commemoration Day of King Father Norodom Sihanouk', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-10-29', 'Coronation Day of King Norodom Sihamoni', 'Provisional: usual fixed date; check against the 2027 sub-decree'),
('2027-11-09', 'Independence Day', NULL),
('2027-11-12', 'Water Festival', NULL),
('2027-11-13', 'Water Festival', NULL),
('2027-11-14', 'Water Festival', NULL),
('2027-12-29', 'Peace Day', 'Provisional: usual fixed date; check against the 2027 sub-decree')
ON CONFLICT ("holiday_date") DO NOTHING;
