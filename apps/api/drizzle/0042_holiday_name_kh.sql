ALTER TABLE "public_holidays" ADD COLUMN "name_kh" text;--> statement-breakpoint
-- Khmer names for the seeded holidays, as worded in the sub-decree; matched on the English name
-- so every year gets them. Holidays added by hand keep an empty Khmer name until edited.
UPDATE "public_holidays" AS h SET "name_kh" = k.kh
FROM (VALUES
  ('International New Year''s Day', 'ទិវាចូលឆ្នាំសកល'),
  ('Victory over Genocide Day', 'ទិវាជ័យជម្នះលើរបបប្រល័យពូជសាសន៍'),
  ('International Women''s Day', 'ទិវាអន្តរជាតិនារី'),
  ('Khmer New Year', 'ពិធីបុណ្យចូលឆ្នាំថ្មីប្រពៃណីជាតិ'),
  ('International Labour Day & Visak Bochea Day', 'ទិវាពលកម្មអន្តរជាតិ និងពិធីបុណ្យវិសាខបូជា'),
  ('International Labour Day', 'ទិវាពលកម្មអន្តរជាតិ'),
  ('Royal Ploughing Ceremony', 'ព្រះរាជពិធីច្រត់ព្រះនង្គ័ល'),
  ('King Norodom Sihamoni''s Birthday', 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្ម ព្រះករុណា ព្រះបាទសម្តេចព្រះបរមនាថ នរោត្តម សីហមុនី'),
  ('Queen Mother Norodom Monineath Sihanouk''s Birthday', 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្ម សម្តេចព្រះមហាក្សត្រី ព្រះវររាជមាតា នរោត្តម មុនិនាថ សីហនុ'),
  ('Constitution Day', 'ទិវាប្រកាសរដ្ឋធម្មនុញ្ញ'),
  ('Pchum Ben Festival', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ'),
  ('Commemoration Day of King Father Norodom Sihanouk', 'ទិវាប្រារព្ធពិធីគោរពព្រះវិញ្ញាណក្ខន្ធ ព្រះករុណា ព្រះបាទសម្តេចព្រះ នរោត្តម សីហនុ ព្រះបរមរតនកោដ្ឋ'),
  ('Coronation Day of King Norodom Sihamoni', 'ព្រះរាជពិធីគ្រងព្រះបរមរាជសម្បត្តិ ព្រះករុណា ព្រះបាទសម្តេចព្រះបរមនាថ នរោត្តម សីហមុនី'),
  ('Independence Day', 'ពិធីបុណ្យឯករាជ្យជាតិ'),
  ('Water Festival', 'ព្រះរាជពិធីបុណ្យអុំទូក បណ្តែតប្រទីប និងសំពះព្រះខែ អកអំបុក'),
  ('Peace Day', 'ទិវាសន្តិភាពនៅកម្ពុជា')
) AS k(en, kh)
WHERE h."name" = k.en AND h."name_kh" IS NULL;
